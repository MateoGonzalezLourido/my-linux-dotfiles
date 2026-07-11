// widget/display/service.ts
// Cola reactiva de gestión de pantallas compartida por QuickSettings (acceso
// rápido) y la sección Pantalla de Ajustes. Fuente única de verdad: estado de
// monitores (poller ref-counted), applyPatch en vivo, persistencia en
// display.json (monitors + global) y scheduler de luz nocturna por reloj.
import { createState } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { buildMonitorRule, monitorNeedsUpdate } from "./modes"
import type { MonitorPref } from "./modes"
import { activeRule } from "./schedule"
import type { NightRule } from "./schedule"
import { parseModetestCaps, parseEdidHdr } from "./caps"
import {
  brightness,
  nightLightActive, setNightLightActive,
  nightLightTemp, setNightLightTemp,
} from "../state"

const DISPLAY_CONFIG_PATH = `${GLib.get_user_config_dir()}/gigios/display.json`

export interface GlobalDisplay {
  vrrMode: number             // 0 off, 1 on, 2 solo fullscreen
  allowTearing: boolean
  nightRulesEnabled: boolean  // ¿programación por horas activada?
  nightRules: NightRule[]     // reglas hora→temperatura
}

interface DisplayConfig {
  brightness: number
  nightLightActive: boolean
  nightLightTemp: number
  monitors: Record<string, MonitorPref>
  global: GlobalDisplay
}

const DEFAULT_GLOBAL: GlobalDisplay = {
  vrrMode: 0, allowTearing: false,
  nightRulesEnabled: false, nightRules: [],
}

export function loadDisplayConfig(): DisplayConfig {
  try {
    const [ok, content] = GLib.file_get_contents(DISPLAY_CONFIG_PATH)
    if (ok) {
      const c = JSON.parse(new TextDecoder().decode(content))
      const g = c.global ?? {}
      return {
        brightness: c.brightness ?? 0.5,
        nightLightActive: c.nightLightActive ?? false,
        nightLightTemp: c.nightLightTemp ?? 4500,
        monitors: c.monitors ?? {},
        global: {
          ...DEFAULT_GLOBAL, ...g,
          nightRulesEnabled: !!g.nightRulesEnabled,
          nightRules: Array.isArray(g.nightRules) ? g.nightRules : [],
        },
      }
    }
  } catch (e) { /* fichero ausente o corrupto → defaults */ }
  return { brightness: 0.5, nightLightActive: false, nightLightTemp: 4500, monitors: {}, global: { ...DEFAULT_GLOBAL } }
}

const config = loadDisplayConfig()

// Preferencias de monitor persistidas, clave = description (estable entre
// reconexiones/arranques, a diferencia de "HDMI-A-1").
export const monitorPrefs: Record<string, MonitorPref> = config.monitors

// Estado global reactivo
export const [globalVrrMode, setGlobalVrrMode] = createState(config.global.vrrMode)
export const [allowTearing, setAllowTearing] = createState(config.global.allowTearing)
export const [nightRules, setNightRules] = createState<NightRule[]>(config.global.nightRules)
export const [nightRulesEnabled, setNightRulesEnabledState] = createState(config.global.nightRulesEnabled)

// Guardado debounced (2 s): brightness.subscribe dispara a menudo, no queremos
// escribir el archivo en cada tick.
let saveTimeout: number | null = null
export function saveDisplayConfig() {
  if (saveTimeout !== null) GLib.source_remove(saveTimeout)
  saveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    try {
      const dir = GLib.path_get_dirname(DISPLAY_CONFIG_PATH)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) execAsync(["mkdir", "-p", dir]).catch(() => {})
      const out: DisplayConfig = {
        brightness: brightness.get(),
        nightLightActive: nightLightActive.get(),
        nightLightTemp: nightLightTemp.get(),
        monitors: monitorPrefs,
        global: {
          vrrMode: globalVrrMode.get(),
          allowTearing: allowTearing.get(),
          nightRulesEnabled: nightRulesEnabled.get(),
          nightRules: nightRules.get(),
        },
      }
      GLib.file_set_contents(DISPLAY_CONFIG_PATH, JSON.stringify(out))
    } catch (e) { /* no-op */ }
    saveTimeout = null
    return GLib.SOURCE_REMOVE
  })
}

export function saveMonitorPref(description: string, pref: MonitorPref) {
  if (!description) return
  monitorPrefs[description] = pref
  saveDisplayConfig()
}

// ── Poller de monitores (ref-counted) ────────────────────────────────────────
export const [monitors, setMonitors] = createState<any[]>([])
let lastSig = ""

export function refreshMonitors() {
  execAsync(["hyprctl", "monitors", "all", "-j"]).then(out => {
    let list: any[] = []
    try { list = JSON.parse(out) } catch { return }
    const sig = list.map((m: any) =>
      `${m.name}|${m.width}x${m.height}@${Math.round(m.refreshRate)}|${m.scale}|${m.vrr}|${m.disabled}|${m.mirrorOf}|${m.focused}|${m.transform}|${(m.availableModes || []).join(",")}`
    ).join(";")
    if (sig !== lastSig) { lastSig = sig; setMonitors(list) }
  }).catch(() => {})
}

// ── Capacidades por monitor (para ocultar ajustes no soportados) ──────────────
// Clave = nombre de conector (eDP-1, HDMI-A-1…). Vacío hasta que detectCaps()
// termine; los ajustes inciertos se ocultan mientras tanto.
export interface MonitorCaps { vrr: boolean; bitdepth10: boolean; hdr: boolean }
export const [monitorCaps, setMonitorCaps] = createState<Record<string, MonitorCaps>>({})

// Detecta capacidades vía DRM (modetest) + EDID (edid-decode). hyprctl no expone
// vrr_capable/max bpc/HDR, así que se leen de las propiedades del conector.
function detectCaps() {
  // 1) drivers de cada card (i915, nvidia, amdgpu…)
  execAsync(["bash", "-c",
    'for c in /sys/class/drm/card[0-9]; do [ -e "$c/device/driver" ] && basename "$(readlink -f "$c/device/driver")"; done | sort -u',
  ]).then(drvOut => {
    const drivers = drvOut.split("\n").map(s => s.trim()).filter(Boolean)
    if (drivers.length === 0) return
    // 2) modetest por driver (concatenado) → vrr + max bpc
    const mtCmd = drivers.map(d => `modetest -M ${d} -c 2>/dev/null`).join("; ")
    execAsync(["bash", "-c", mtCmd]).then(mtOut => {
      const mt = parseModetestCaps(mtOut)
      // 3) EDID por conector → HDR
      execAsync(["bash", "-c",
        'for e in /sys/class/drm/card*-*/edid; do [ -s "$e" ] || continue; ' +
        'conn=$(basename "$(dirname "$e")" | sed "s/^card[0-9]*-//"); echo "###EDID $conn"; ' +
        'edid-decode "$e" 2>/dev/null | grep -iE "HDR Static Metadata|SMPTE ST 2084|BT2020|Hybrid Log-Gamma"; done',
      ]).then(edOut => {
        const hdr = parseEdidHdr(edOut)
        const merged: Record<string, MonitorCaps> = {}
        for (const name of Object.keys(mt)) merged[name] = { vrr: mt[name].vrr, bitdepth10: mt[name].bitdepth10, hdr: hdr.has(name) }
        setMonitorCaps(merged)
      }).catch(() => {
        const merged: Record<string, MonitorCaps> = {}
        for (const name of Object.keys(mt)) merged[name] = { vrr: mt[name].vrr, bitdepth10: mt[name].bitdepth10, hdr: false }
        setMonitorCaps(merged)
      })
    }).catch(() => {})
  }).catch(() => {})
}

let pollId: number | null = null
let pollRefs = 0
export function acquirePoll() {
  pollRefs++
  if (pollId === null) {
    refreshMonitors()
    pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => { refreshMonitors(); return GLib.SOURCE_CONTINUE })
  }
}
export function releasePoll() {
  pollRefs = Math.max(0, pollRefs - 1)
  if (pollRefs === 0 && pollId !== null) { GLib.source_remove(pollId); pollId = null }
}

// Aplica un patch parcial a un monitor: resuelve pref completa, persiste, emite
// hyprctl y refresca. `position` sale de patch.position o del estado actual.
export function applyPatch(mon: any, patch: Partial<MonitorPref>) {
  const resolved: MonitorPref = {
    mode: patch.mode ?? `${mon.width}x${mon.height}@${mon.refreshRate.toFixed(2)}Hz`,
    scale: patch.scale ?? mon.scale,
    vrr: patch.vrr ?? mon.vrr,
    enabled: patch.enabled ?? !mon.disabled,
    mirrorOf: patch.mirrorOf ?? (mon.mirrorOf ?? "none"),
    transform: patch.transform ?? (mon.transform ?? 0),
    bitdepth: patch.bitdepth ?? undefined,
    cm: patch.cm ?? undefined,
    sdrBrightness: patch.sdrBrightness ?? undefined,
    sdrSaturation: patch.sdrSaturation ?? undefined,
    position: patch.position ?? undefined,
  }
  const position = resolved.position && resolved.position !== "auto"
    ? resolved.position
    : `${mon.x}x${mon.y}`
  const rule = buildMonitorRule({ name: mon.name, position, pref: resolved })
  saveMonitorPref(mon.description, resolved)
  execAsync(["hyprctl", "keyword", "monitor", rule]).catch(() => {})
    .then(() => { GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => { refreshMonitors(); return GLib.SOURCE_REMOVE }) })
}

// ── Ajustes globales en vivo ─────────────────────────────────────────────────
export function applyGlobalVrr(mode: number) {
  setGlobalVrrMode(mode); saveDisplayConfig()
  execAsync(["hyprctl", "keyword", "misc:vrr", String(mode)]).catch(() => {})
}
export function applyAllowTearing(on: boolean) {
  setAllowTearing(on); saveDisplayConfig()
  execAsync(["hyprctl", "keyword", "general:allow_tearing", on ? "1" : "0"]).catch(() => {})
}

// ── Luz nocturna: manual (fija) + reglas (programada) + maestro "ahora" ───────
// (1) Manual (`nightLightActive` + `nightLightTemp`): enciende ya con una temp.
// (2) Reglas (`nightRulesEnabled` + `nightRules`): programa por horas.
// Precedencia: una franja de horario CÁLIDA manda; si el horario apaga (o no hay
// reglas), vale el manual. `lastAppliedTemp === -1` ⇒ hyprsunset apagado.
let lastAppliedTemp = -1

// ¿La luz nocturna está encendida AHORA? Estado reactivo que consume el toggle
// maestro de QuickSettings (refleja la fuente real: manual O programada).
export const [nightOn, setNightOn] = createState(false)

// "Desactivar hasta la próxima": QS puede apagar la luz actual sin desactivar el
// horario. El descarte se limpia cuando el horario cambia de franja (otra regla
// activa) y entonces la programada se vuelve a aplicar sola.
let nightDismissed = false
let dismissedKey = ""

// Identidad de la franja de horario activa (para detectar la transición que
// limpia el descarte). Sin reglas ⇒ clave fija.
function scheduleKey(): string {
  if (nightRulesEnabled.get() && nightRules.get().length) {
    const d = GLib.DateTime.new_now_local()
    const r = activeRule({ h: d.get_hour(), m: d.get_minute() }, nightRules.get())
    return r ? r.time : "none"
  }
  return "no-schedule"
}

// Temperatura que "quieren" horario/manual (sin contar el descarte). El horario
// cálido tiene prioridad; si el horario apaga (temp 0) o no hay reglas, vale el
// manual. temp === 0 en una regla = "apagar desde esa hora".
function baseTemp(): number | null {
  if (nightRulesEnabled.get() && nightRules.get().length) {
    const d = GLib.DateTime.new_now_local()
    const r = activeRule({ h: d.get_hour(), m: d.get_minute() }, nightRules.get())
    if (r && r.temp > 0) return r.temp   // franja cálida: manda el horario
  }
  if (nightLightActive.get()) return nightLightTemp.get()
  return null
}

// Reconcilia hyprsunset con el estado deseado (arranca / cambia temp / apaga) y
// publica `nightOn`. El descarte se limpia al cambiar de franja de horario.
function applyNight() {
  if (nightDismissed && scheduleKey() !== dismissedKey) nightDismissed = false
  const temp = nightDismissed ? null : baseTemp()
  setNightOn(temp != null)
  if (temp == null) {
    if (lastAppliedTemp !== -1) { lastAppliedTemp = -1; execAsync(["pkill", "-HUP", "-x", "hyprsunset"]).catch(() => {}) }
    return
  }
  if (temp === lastAppliedTemp) return
  if (lastAppliedTemp === -1) execAsync(["bash", "-c", `pkill -HUP -x hyprsunset; hyprsunset -t ${temp} &`]).catch(() => {}) // off → on: arrancar
  else execAsync(["bash", "-c", `hyprctl hyprsunset temperature ${temp}`]).catch(() => {})                         // on → on: cambiar en caliente
  lastAppliedTemp = temp
}

// Maestro de QuickSettings: apaga la luz actual "hasta la próxima" (apaga la fija
// y descarta la franja de horario en curso) o la enciende (fija). El horario sigue
// activo: la siguiente regla la volverá a encender.
export function toggleNightNow() {
  if (nightOn.get()) {
    setNightLightActive(false)      // apaga la fija
    nightDismissed = true
    dismissedKey = scheduleKey()    // recuerda la franja en curso
  } else {
    nightDismissed = false
    setNightLightActive(true)       // enciende la fija
  }
  saveDisplayConfig(); applyNight()
}

// (1) Toggle manual — enciende/apaga la luz nocturna fija ahora.
export function setNightLightManual(on: boolean) {
  nightDismissed = false
  setNightLightActive(on); saveDisplayConfig(); applyNight()
}

// Temperatura manual (slider). Aplica en vivo con debounce si el manual manda.
let tempDebounce: number | null = null
export function setManualTemp(t: number) {
  nightDismissed = false
  setNightLightTemp(t); saveDisplayConfig()
  if (tempDebounce !== null) GLib.source_remove(tempDebounce)
  tempDebounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => { applyNight(); tempDebounce = null; return GLib.SOURCE_REMOVE })
}

// (2) Toggle de reglas — activa/desactiva la programación por horas. Al activar
// sin reglas se añade un horario por defecto (cálida de noche, apagada de día)
// para que NO se encienda 24/7 por sorpresa.
export function setNightRulesEnabled(on: boolean) {
  nightDismissed = false
  setNightRulesEnabledState(on)
  if (on && nightRules.get().length === 0) setNightRules([{ time: "22:00", temp: 3500 }, { time: "07:00", temp: 0 }])
  saveDisplayConfig(); applyNight()
}

export function setNightRulesAndSave(rules: NightRule[]) {
  nightDismissed = false
  setNightRules(rules); saveDisplayConfig(); applyNight()
}

// ── Re-aplicación al arranque + arranque del scheduler ───────────────────────
let initialized = false
export function initDisplayService() {
  if (initialized) return
  initialized = true

  // Luz nocturna: restaurar estado (manual + reglas) y reconciliar hyprsunset.
  // brightness NO se restaura: state.tsx ya lee el valor real de sysfs al arrancar.
  setNightLightActive(config.nightLightActive)
  setNightLightTemp(config.nightLightTemp)
  applyNight()
  brightness.subscribe(saveDisplayConfig)

  // Re-aplicar preferencias por monitor (solo lo que difiera, para no pelear con
  // monitors.conf ni parpadear). idle_add = siguiente tick, sin delay fijo.
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    if (Object.keys(monitorPrefs).length > 0) {
      execAsync(["hyprctl", "monitors", "all", "-j"]).then(out => {
        let list: any[] = []
        try { list = JSON.parse(out) } catch { return }
        for (const mon of list) {
          const pref = monitorPrefs[mon.description]
          if (!pref || !monitorNeedsUpdate(mon, pref)) continue
          const position = pref.position && pref.position !== "auto" ? pref.position : `${mon.x}x${mon.y}`
          execAsync(["hyprctl", "keyword", "monitor", buildMonitorRule({ name: mon.name, position, pref })]).catch(() => {})
        }
      }).catch(() => {})
    }
    return GLib.SOURCE_REMOVE
  })

  // Globales
  const g = config.global
  if (g.vrrMode !== 0) execAsync(["hyprctl", "keyword", "misc:vrr", String(g.vrrMode)]).catch(() => {})
  if (g.allowTearing) execAsync(["hyprctl", "keyword", "general:allow_tearing", "1"]).catch(() => {})

  // Reconciliación de luz nocturna cada 60 s (para que las reglas cambien la temp)
  GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => { applyNight(); return GLib.SOURCE_CONTINUE })

  // Capacidades de hardware (para ocultar ajustes no soportados por monitor)
  detectCaps()
}
