// widget/settings/preferences.ts
//
// Hub de preferencias de "Personalización" del shell. A diferencia de
// widget/bar/functions/state.ts (que vive SOLO en RAM), estas preferencias se
// persisten en config/preferences.json para sobrevivir a reinicios.
//
// Para añadir una preferencia nueva:
//   1. crea su createState (default = valor de fábrica),
//   2. léela en load(),
//   3. inclúyela en el objeto de save(),
//   4. expón un setter público que mute el estado y llame a save().

import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { createState } from "ags"
import { execAsync } from "ags/process"

const PREFS_PATH = `${GLib.get_user_config_dir()}/gigios/preferences.json`

// ── Estado reactivo ───────────────────────────────────────────────────────────
// Preview de workspace: captura con grim al cambiar de workspace + popover al
// hacer clic derecho sobre el número. Default: activada (comportamiento actual).
const [wsPreviewEnabled, _setWsPreviewEnabled] = createState(true)
export { wsPreviewEnabled }

// Reproductor de Spotify en el centro de la barra. Al desactivarlo el componente
// se desmonta por completo, por lo que no mantiene polling, timers ni carátulas.
// Default: activado para conservar el comportamiento existente.
const [spotifyBarEnabled, _setSpotifyBarEnabled] = createState(true)
export { spotifyBarEnabled }

// Monitor de batería (scripts/battery-monitor.sh): el propio script bash lee
// este valor UNA sola vez al arrancar (no hay polling desde bash), así que un
// cambio aquí solo se aplica reiniciando el script/Hyprland. Default: activado.
const [batteryMonitorEnabled, _setBatteryMonitorEnabled] = createState(true)
export { batteryMonitorEnabled }

// Monitor de temperatura (scripts/temp-monitor.sh): igual que el de batería,
// el script bash lo lee UNA sola vez al arrancar (nada de polling), así que
// un cambio aquí solo surte efecto reiniciando el script/Hyprland. Default: activado.
const [tempMonitorEnabled, _setTempMonitorEnabled] = createState(true)
export { tempMonitorEnabled }

// Historial del portapapeles (wl-paste + cliphist). Al desactivarlo se detiene
// la captura de nuevas copias y se limpia lo ya guardado. Default: activado.
const [clipboardHistoryEnabled, _setClipboardHistoryEnabled] = createState(true)
export { clipboardHistoryEnabled }

// Menú Orion. app.ts consulta este valor antes de importar el módulo: cuando
// está desactivado no se crea su ventana ni se cargan watchers/servicios de
// Orion. El cambio se aplica en el siguiente arranque o recarga de AGS.
const [orionEnabled, _setOrionEnabled] = createState(true)
export { orionEnabled }

// No molestar automático: cuando está activo, un watcher en el shell
// (widget/notifications/autoDnd) enciende notifd.dontDisturb mientras haya un
// juego corriendo o una app de la lista de abajo en pantalla completa. Silencia
// SOLO los popups para el usuario; el procesamiento e historial siguen. Default: desactivado.
const [autoDndEnabled, _setAutoDndEnabled] = createState(false)
export { autoDndEnabled }

// Lista de clases de ventana que, al ponerse en pantalla completa, también
// disparan el No molestar automático (además de los juegos). Se guarda como
// substrings en minúsculas y se compara contra class/initialClass. Default: vacía.
const [autoDndFullscreenApps, _setAutoDndFullscreenApps] = createState<string[]>([])
export { autoDndFullscreenApps }

// Formato del reloj de la barra: "24h" (por defecto, p. ej. 14:30) o "12h"
// (02:30 PM). Lo lee widget/bar/Clock.tsx de forma reactiva, así que el cambio
// se ve al instante sin reiniciar. Vive en "Fecha e idioma" (DateLanguageSection).
export type TimeFormat = "24h" | "12h"
const [timeFormat, _setTimeFormat] = createState<TimeFormat>("24h")
export { timeFormat }

// Formatea una hora según la preferencia. En 12h calculamos AM/PM a mano en vez
// de usar %p: en locales como es_US.UTF-8 %p viene vacío y el reloj quedaría
// ambiguo ("09:09 " sin sufijo). Así el formato es independiente del idioma.
export function formatClock(dt: GLib.DateTime = GLib.DateTime.new_now_local(), fmt: TimeFormat = timeFormat.get()): string {
  if (fmt === "12h") {
    const period = dt.get_hour() < 12 ? "AM" : "PM"
    return `${dt.format("%I:%M") ?? ""} ${period}`
  }
  return dt.format("%H:%M") ?? ""
}

// Normaliza una lista de clases: minúsculas, sin espacios sobrantes, sin vacíos
// ni duplicados. Se aplica tanto al cargar como al añadir, así el watcher y la UI
// nunca ven basura.
function sanitizeApps(apps: unknown[]): string[] {
  const out: string[] = []
  for (const a of apps) {
    if (typeof a !== "string") continue
    const norm = a.trim().toLowerCase()
    if (norm.length > 0 && !out.includes(norm)) out.push(norm)
  }
  return out
}

// ── Carga inicial ─────────────────────────────────────────────────────────────
function load() {
  try {
    const [ok, content] = GLib.file_get_contents(PREFS_PATH)
    if (!ok) return
    const saved = JSON.parse(new TextDecoder().decode(content))
    if (typeof saved.workspacePreview === "boolean") _setWsPreviewEnabled(saved.workspacePreview)
    if (typeof saved.spotifyBar === "boolean") _setSpotifyBarEnabled(saved.spotifyBar)
    if (typeof saved.batteryMonitor === "boolean") _setBatteryMonitorEnabled(saved.batteryMonitor)
    if (typeof saved.tempMonitor === "boolean") _setTempMonitorEnabled(saved.tempMonitor)
    if (typeof saved.clipboardHistory === "boolean") _setClipboardHistoryEnabled(saved.clipboardHistory)
    if (typeof saved.orion === "boolean") _setOrionEnabled(saved.orion)
    if (typeof saved.autoDnd === "boolean") _setAutoDndEnabled(saved.autoDnd)
    if (Array.isArray(saved.autoDndFullscreenApps)) {
      _setAutoDndFullscreenApps(sanitizeApps(saved.autoDndFullscreenApps))
    }
    if (saved.timeFormat === "12h" || saved.timeFormat === "24h") _setTimeFormat(saved.timeFormat)
  } catch (e) { /* archivo ausente o corrupto → nos quedamos con los defaults */ }
}

// ── Persistencia ──────────────────────────────────────────────────────────────
function save() {
  try {
    const dir = GLib.path_get_dirname(PREFS_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    const config = {
      workspacePreview: wsPreviewEnabled.get(),
      spotifyBar: spotifyBarEnabled.get(),
      batteryMonitor: batteryMonitorEnabled.get(),
      tempMonitor: tempMonitorEnabled.get(),
      clipboardHistory: clipboardHistoryEnabled.get(),
      orion: orionEnabled.get(),
      autoDnd: autoDndEnabled.get(),
      autoDndFullscreenApps: autoDndFullscreenApps.get(),
      timeFormat: timeFormat.get(),
    }
    GLib.file_set_contents(PREFS_PATH, JSON.stringify(config, null, 2))
  } catch (e) { /* no-op: un fallo de escritura no debe romper la UI */ }
}

// ── Setters públicos (mutan estado + persisten) ───────────────────────────────
export function setWsPreviewEnabled(on: boolean) {
  _setWsPreviewEnabled(on)
  save()
  // DEBUG-WSPREVIEW (temporal): registrar cada toggle y el valor resultante.
  try {
    const line = `${new Date().toISOString()} setWsPreviewEnabled(arg=${on}) -> get()=${wsPreviewEnabled.get()}\n`
    const f = Gio.File.new_for_path("/tmp/ws-preview-debug.log")
    const os = f.append_to(Gio.FileCreateFlags.NONE, null)
    os.write_bytes(new GLib.Bytes(new TextEncoder().encode(line)), null)
    os.close(null)
  } catch (_) {}
}
export function setSpotifyBarEnabled(on: boolean) {
  _setSpotifyBarEnabled(on)
  save()
}
export function setBatteryMonitorEnabled(on: boolean) {
  _setBatteryMonitorEnabled(on)
  save()
}
export function setTempMonitorEnabled(on: boolean) {
  _setTempMonitorEnabled(on)
  save()
}
export function setClipboardHistoryEnabled(on: boolean) {
  _setClipboardHistoryEnabled(on)
  save()
  const action = on ? "start" : "stop"
  execAsync([`${GLib.get_user_config_dir()}/hypr/scripts/clipboard-history.sh`, action]).catch(() => {})
}
export function setOrionEnabled(on: boolean) {
  _setOrionEnabled(on)
  save()
}
export function setTimeFormat(fmt: TimeFormat) {
  _setTimeFormat(fmt)
  save()
}
export function setAutoDndEnabled(on: boolean) {
  _setAutoDndEnabled(on)
  save()
}
/** Añade una clase a la lista de apps fullscreen. Normaliza y evita duplicados. */
export function addAutoDndApp(cls: string) {
  const next = sanitizeApps([...autoDndFullscreenApps.get(), cls])
  _setAutoDndFullscreenApps(next)
  save()
}
/** Quita una clase (comparación exacta contra el valor ya normalizado). */
export function removeAutoDndApp(cls: string) {
  _setAutoDndFullscreenApps(autoDndFullscreenApps.get().filter((a) => a !== cls))
  save()
}

load()
