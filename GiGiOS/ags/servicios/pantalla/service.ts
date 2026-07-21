// servicios/pantalla/service.ts
// Cola reactiva de gestión de pantallas compartida por QuickSettings (acceso
// rápido) y la sección Pantalla de Ajustes. Fuente única de verdad: estado de
// monitores (poller ref-counted), applyPatch en vivo, persistencia en
// display.json (monitors + global) y scheduler de luz nocturna por reloj.
import { createState } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { buildMonitorRule, monitorNeedsUpdate } from "./modes"
import type { MonitorPref } from "./modes"
import { activeSetpoint, activeRuleFor, normalizeRules } from "./schedule"
import type { NightRule } from "./schedule"
import { parseModetestCaps, parseEdidHdr } from "./caps"
import { applyBrightness, brightnessSupported } from "./brightness"
import {
  brightness,
  nightLightActive, setNightLightActive,
  nightLightTemp, setNightLightTemp,
} from "../../estado/shell"

const DISPLAY_CONFIG_PATH = `${GLib.get_user_config_dir()}/gigios/display.json`

export interface GlobalDisplay {
  vrrMode: number             // 0 off, 1 on, 2 solo fullscreen
  allowTearing: boolean
  nightRulesEnabled: boolean  // ¿programación por horas activada?
  nightRules: NightRule[]     // reglas hora→{luz nocturna, brillo}
}

/** Franja de brillo en curso, persistida. NO es configuración del usuario: es el apunte
 *  de "estoy dentro de esta franja y el brillo que había antes de entrar era este".
 *  Vive en disco porque la restauración al salir **cruza apagados**: una franja nocturna
 *  (00:00→07:00) se sale casi siempre con el PC apagado. Ver `applyScheduledBrightness`. */
type BrightnessWindow = { key: string; before: number }

interface DisplayConfig {
  brightness: number
  nightLightActive: boolean
  nightLightTemp: number
  brightnessWindow: BrightnessWindow | null
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
      const w = c.brightnessWindow
      return {
        brightness: c.brightness ?? 0.5,
        nightLightActive: c.nightLightActive ?? false,
        nightLightTemp: c.nightLightTemp ?? 4500,
        brightnessWindow:
          w && typeof w.key === "string" && typeof w.before === "number"
            ? { key: w.key, before: w.before }
            : null,
        monitors: c.monitors ?? {},
        global: {
          ...DEFAULT_GLOBAL, ...g,
          nightRulesEnabled: !!g.nightRulesEnabled,
          nightRules: normalizeRules(g.nightRules),
        },
      }
    }
  } catch (e) { /* fichero ausente o corrupto → defaults */ }
  return {
    brightness: 0.5, nightLightActive: false, nightLightTemp: 4500,
    brightnessWindow: null, monitors: {}, global: { ...DEFAULT_GLOBAL },
  }
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
        brightnessWindow:
          lastBrightnessKey !== null && brightnessBeforeWindow !== null
            ? { key: lastBrightnessKey, before: brightnessBeforeWindow }
            : null,
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

// ── Volcado a la config de Hyprland ──────────────────────────────────────────
// display.json es la fuente de verdad de AGS, pero Hyprland no la lee. Los ajustes
// se aplicaban SOLO en vivo (`hyprctl keyword monitor`) y al arrancar AGS, y como
// `monitors.conf` no lleva más que la regla comodín (`monitor = , preferred, auto, 1`),
// cualquier `hyprctl reload` releía los configs y devolvía el monitor a modo preferido
// y escala 1 — 240 Hz → 60 Hz, 1.25 → 1 — sin que AGS se enterara (no hay señal de
// recarga a la que suscribirse, y su poller solo observa; no re-aplica).
//
// Así que las prefs se vuelcan también a un .conf generado que `hyprland.conf` sourcea
// DESPUÉS de monitors.conf (mismo patrón que `input-settings.conf`). Las reglas van por
// `desc:` — no por conector (DP-1), que baila entre reconexiones — y una regla concreta
// gana a la comodín, que sigue cubriendo los monitores sin preferencia guardada. Efecto
// extra: el compositor arranca ya en el modo bueno, sin el parpadeo de la re-aplicación.
const MONITOR_CONF_PATH = `${GLib.get_home_dir()}/.config/hypr/monitor-settings.conf`

function writeMonitorConf() {
  try {
    const lines = [
      "# Generado por AGS · Ajustes > Pantalla. No editar a mano.",
      "# Lo sourcea hyprland.conf después de monitors.conf: una regla `desc:` concreta",
      "# gana a la comodín de ahí, que sigue cubriendo los monitores sin preferencia.",
      "",
    ]
    for (const [description, pref] of Object.entries(monitorPrefs)) {
      if (!description) continue
      const position = pref.position && pref.position !== "auto" ? pref.position : "auto"
      lines.push(`monitor = ${buildMonitorRule({ name: `desc:${description}`, position, pref })}`)
    }
    GLib.file_set_contents(MONITOR_CONF_PATH, lines.join("\n") + "\n")
  } catch (e) { /* no-op: el ajuste ya está aplicado en vivo */ }
}

export function saveMonitorPref(description: string, pref: MonitorPref) {
  if (!description) return
  monitorPrefs[description] = pref
  saveDisplayConfig()
  writeMonitorConf()
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
  // Persistir la posición REAL, no la del patch: `hyprctl keyword` la resuelve sola,
  // pero el .conf generado se lee sin nadie que la resuelva, y con "auto" un layout
  // multi-monitor se recolocaría solo al recargar.
  resolved.position = position
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

// ── Luz nocturna + brillo: manual (fijo) + franjas (programadas) + maestro "ahora" ─
// (1) Manual (`nightLightActive` + `nightLightTemp`): enciende ya con una temp.
// (2) Franjas (`nightRulesEnabled` + `nightRules`): cada regla vale [start, end) y ahí
//     dentro programa DOS canales independientes — luz nocturna y brillo. Una regla puede
//     tocar uno, el otro o los dos. FUERA de su franja no pinta nada: la luz nocturna
//     vuelve al manual y el brillo, al valor que tenía antes de entrar.
// Precedencia (luz nocturna): dentro de una franja cálida manda el horario, SALVO que el
// usuario haya tocado a mano en esa misma franja (override, abajo); fuera, el manual.
// `lastAppliedTemp === -1` ⇒ hyprsunset apagado.
let lastAppliedTemp = -1

function nowHM() {
  const d = GLib.DateTime.new_now_local()
  return { h: d.get_hour(), m: d.get_minute() }
}
function rulesOn(): boolean { return nightRulesEnabled.get() && nightRules.get().length > 0 }

// ¿La luz nocturna está encendida AHORA? Estado reactivo que consume el toggle
// maestro de QuickSettings (refleja la fuente real: manual O programada).
export const [nightOn, setNightOn] = createState(false)

// Override manual DENTRO de una franja. Sin esto, el horario ganaba SIEMPRE mientras
// estuviera vigente (`baseTemp`), así que con una regla activa el interruptor y el slider
// de temperatura no hacían nada: tocabas, se guardaba en disco, y la siguiente
// reconciliación (el tick de 60 s, o el propio `applyNight` de la llamada) devolvía la
// temperatura de la regla. El brillo no tenía el bug porque su canal solo se aplica AL
// ENTRAR en la franja (ver `applyScheduledBrightness`), y por eso "el brillo sí funciona".
//
// Es el mismo trato que ya tenía el "desactivar hasta la próxima" del maestro de QS —
// de hecho lo absorbe: apagar a mano es un override que pide "nada". Guarda la franja en
// la que se tocó, así que caduca sola al cambiar de franja y entonces la programada se
// vuelve a aplicar. Por sesión, como antes: no se persiste.
let nightOverrideKey: string | null = null

function overrideActive(): boolean {
  return nightOverrideKey !== null && nightOverrideKey === scheduleKey()
}
function claimNightOverride() { nightOverrideKey = scheduleKey() }

// Identidad de la franja de LUZ NOCTURNA vigente (para detectar la transición que caduca
// el override manual). Solo cuentan las reglas que hablan de la luz: entrar en una franja de solo
// brillo no es cambiar de franja. Fuera de toda franja ⇒ clave fija.
function scheduleKey(): string {
  if (rulesOn()) {
    const r = activeRuleFor(nowHM(), nightRules.get(), "temp")
    return r ? `${r.start}-${r.end}` : "none"
  }
  return "no-schedule"
}

// Temperatura que "quieren" horario/manual. Dentro de una franja que programe la luz manda
// el horario; fuera de toda franja —o con override manual vigente—, el manual.
function baseTemp(): number | null {
  if (!overrideActive() && rulesOn()) {
    const t = activeSetpoint(nowHM(), nightRules.get(), "temp")
    if (t != null && t > 0) return t   // dentro de la franja: manda el horario
  }
  if (nightLightActive.get()) return nightLightTemp.get()
  return null
}

// Brillo programado. Dos reglas, y ninguna es cosmética:
//
// (1) Se aplica AL ENTRAR en la franja, no en cada reconciliación. Re-escribirlo cada
//     60 s dejaría el slider (y las teclas XF86MonBrightness*) sin efecto: el horario te
//     lo pisaría al minuto. `lastBrightnessKey` (franja + valor) distingue "he entrado en
//     otra franja" de "sigo en la misma"; incluye el valor para que editar la regla
//     vigente en Ajustes se vea al momento.
// (2) Al SALIR de la franja se restaura el brillo que había antes de entrar. Sin esto, una
//     franja de 10 a 11 seguiría "notándose" a la 1 de la tarde: nadie devolvería el brillo
//     a su sitio, porque el brillo es un ajuste físico que no vuelve solo (a diferencia de
//     la luz nocturna, que simplemente deja de forzarse y vuelve al manual).
// (3) Y las dos mitades viven EN DISCO, no en RAM, porque la transición cruza apagados.
//     El brillo es lo único aquí que deja **residuo físico**: la franja lo escribe en la
//     firmware del monitor (DDC) y ahí se queda. Con una franja nocturna (00:00→07:00) la
//     salida ocurre casi siempre con el PC apagado, así que el "restaurar al salir" no
//     llegaba a ejecutarse NUNCA: el valor programado se quedaba grabado en el monitor, y
//     al arrancar `detectDdc()` lo leía de vuelta y lo publicaba como si fuera la elección
//     del usuario — `brightness.subscribe(saveDisplayConfig)` lo escribía en display.json y
//     el brillo real quedaba borrado. Medido: brillo 73 → franja aplica 80 → apagar dentro
//     → arrancar fuera = monitor a 80 y `"brightness":0.8` en disco, cada vez. Guardarlas
//     hace que la restauración pendiente sobreviva al apagado y se cobre en el siguiente
//     arranque; y de paso reiniciar AGS *dentro* de una franja ya no pierde el brillo previo
//     (era limitación conocida) ni re-aplica la franja encima de un ajuste manual.
let lastBrightnessKey: string | null = config.brightnessWindow?.key ?? null
let brightnessBeforeWindow: number | null = config.brightnessWindow?.before ?? null   // 0..1

function applyScheduledBrightness() {
  const r = rulesOn() ? activeRuleFor(nowHM(), nightRules.get(), "brightness") : null

  if (!r || r.brightness == null) {          // fuera de toda franja con brillo
    if (lastBrightnessKey === null) return   // no hay franja en curso: nada que restaurar
    // Sin backend la restauración se perdería en el vacío Y borraría el apunte, que es lo
    // único que recuerda el brillo real. Se espera: `brightnessSupported.subscribe` reintenta.
    if (!brightnessSupported.get()) return
    if (brightnessBeforeWindow !== null) {
      applyBrightness(brightnessBeforeWindow)   // se acabó la franja: devuélvelo a su sitio
    }
    lastBrightnessKey = null
    brightnessBeforeWindow = null
    saveDisplayConfig()                         // franja saldada: olvídala también en disco
    return
  }

  const key = `${r.start}-${r.end}|${r.brightness}`
  if (key === lastBrightnessKey) return
  // Sin backend confirmado, `applyBrightness` no llega al hardware — y en un sobremesa el
  // sondeo DDC tarda ~1 s, así que al arrancar aún no lo hay. No se marca la franja como
  // aplicada: initDisplayService reintenta en cuanto `brightnessSupported` se confirma.
  if (!brightnessSupported.get()) return
  // Solo se recuerda el brillo previo al ENTRAR (no al editar el valor de la franja en
  // curso, que ya se aplicó sobre el suyo propio y machacaría el original).
  if (lastBrightnessKey === null) brightnessBeforeWindow = brightness.get()
  lastBrightnessKey = key
  applyBrightness(r.brightness / 100)   // persiste solo: brightness.subscribe(saveDisplayConfig)
  saveDisplayConfig()                   // recuerda la franja + el brillo previo por si apagas dentro
}

// Reconcilia los dos canales. Lo llaman el arranque, el tick de 60 s y todo cambio en
// las reglas; los toggles manuales (que no tocan el brillo) se quedan en `applyNight`.
function applyRules() {
  applyNight()
  applyScheduledBrightness()
}

// Reconcilia hyprsunset con el estado deseado (arranca / cambia temp / apaga) y
// publica `nightOn`. El descarte se limpia al cambiar de franja de horario.
function applyNight() {
  if (nightOverrideKey !== null && nightOverrideKey !== scheduleKey()) nightOverrideKey = null
  const temp = baseTemp()
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
  setNightLightActive(!nightOn.get())
  claimNightOverride()   // en esta franja manda el usuario (encienda o apague)
  saveDisplayConfig(); applyNight()
}

// (1) Toggle manual — enciende/apaga la luz nocturna fija ahora. También reclama el
// override: si no, con una franja vigente el interruptor no haría nada visible.
export function setNightLightManual(on: boolean) {
  setNightLightActive(on); claimNightOverride(); saveDisplayConfig(); applyNight()
}

// Temperatura manual (slider). Aplica en vivo con debounce si el manual manda.
let tempDebounce: number | null = null
export function setManualTemp(t: number) {
  // Mover el slider con la luz ENCENDIDA es pedir "quiero esta temperatura ahora", venga
  // de donde venga la que hay: se adopta como manual y se reclama la franja. Con la luz
  // apagada solo se está editando el valor manual para más tarde — no se enciende nada ni
  // se pisa una franja que ni siquiera está tocando la luz.
  if (nightOn.get()) { setNightLightActive(true); claimNightOverride() }
  setNightLightTemp(t); saveDisplayConfig()
  if (tempDebounce !== null) GLib.source_remove(tempDebounce)
  tempDebounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => { applyNight(); tempDebounce = null; return GLib.SOURCE_REMOVE })
}

// (2) Toggle de reglas — activa/desactiva la programación por horas. Al activar sin reglas
// se añade una franja por defecto (cálida de 22:00 a 07:00). Sin brillo: programarlo es
// opt-in, no algo que aparezca solo al encender el horario.
export function setNightRulesEnabled(on: boolean) {
  nightOverrideKey = null   // tocar el horario devuelve el mando al horario
  setNightRulesEnabledState(on)
  if (on && nightRules.get().length === 0) {
    setNightRules([{ start: "22:00", end: "07:00", temp: 3500, brightness: null }])
  }
  saveDisplayConfig(); applyRules()
}

export function setNightRulesAndSave(rules: NightRule[]) {
  nightOverrideKey = null
  setNightRules(rules); saveDisplayConfig(); applyRules()
}

// ── Re-aplicación al arranque + arranque del scheduler ───────────────────────
let initialized = false
export function initDisplayService() {
  if (initialized) return
  initialized = true

  // Luz nocturna: restaurar estado (manual + reglas) y reconciliar hyprsunset. El brillo
  // guardado NO se restaura aquí (brightness.ts ya lee el real del hardware al arrancar),
  // pero sí se aplica el de la franja horaria vigente, si alguna regla lo programa: el
  // horario describe cómo debe estar la pantalla a esta hora, también recién iniciada.
  setNightLightActive(config.nightLightActive)
  setNightLightTemp(config.nightLightTemp)
  applyRules()
  brightness.subscribe(saveDisplayConfig)
  brightnessSupported.subscribe(applyScheduledBrightness)   // backend DDC: llega ~1 s tarde

  // Re-aplicar preferencias por monitor (solo lo que difiera, para no pelear con
  // monitors.conf ni parpadear). Con monitor-settings.conf en su sitio esto ya no
  // debería tener nada que hacer — se queda como red por si el .conf falta (máquina
  // recién clonada) o la regla `desc:` no casa. Y de paso regenera el .conf, para
  // que las prefs guardadas antes de que existiera se vuelquen solas, sin que haya
  // que tocar ningún ajuste. idle_add = siguiente tick, sin delay fijo.
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    if (Object.keys(monitorPrefs).length > 0) {
      execAsync(["hyprctl", "monitors", "all", "-j"]).then(out => {
        let list: any[] = []
        try { list = JSON.parse(out) } catch { return }
        let backfilled = false
        for (const mon of list) {
          const pref = monitorPrefs[mon.description]
          if (!pref) continue
          // Las prefs guardadas antes de existir el .conf no traen posición, y sin
          // ella la regla saldría con "auto" (un layout multi-monitor se recolocaría
          // solo al recargar). La tomamos de la real.
          if (!pref.position) { pref.position = `${mon.x}x${mon.y}`; backfilled = true }
          if (!monitorNeedsUpdate(mon, pref)) continue
          execAsync(["hyprctl", "keyword", "monitor", buildMonitorRule({ name: mon.name, position: pref.position, pref })]).catch(() => {})
        }
        if (backfilled) saveDisplayConfig()
        writeMonitorConf()
      }).catch(() => {})
    }
    return GLib.SOURCE_REMOVE
  })

  // Globales
  const g = config.global
  if (g.vrrMode !== 0) execAsync(["hyprctl", "keyword", "misc:vrr", String(g.vrrMode)]).catch(() => {})
  if (g.allowTearing) execAsync(["hyprctl", "keyword", "general:allow_tearing", "1"]).catch(() => {})

  // Reconciliación cada 60 s (para que las reglas cambien de franja: temp y brillo)
  GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => { applyRules(); return GLib.SOURCE_CONTINUE })

  // Capacidades de hardware (para ocultar ajustes no soportados por monitor)
  detectCaps()
}
