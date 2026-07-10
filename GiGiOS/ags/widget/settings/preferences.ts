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
import { createState } from "ags"
import { execAsync } from "ags/process"

const PREFS_PATH = `${GLib.get_user_config_dir()}/gigios/preferences.json`

// ── Estado reactivo ───────────────────────────────────────────────────────────
// Preview de workspace: captura con grim al cambiar de workspace + popover al
// hacer clic derecho sobre el número. Default: activada (comportamiento actual).
const [wsPreviewEnabled, _setWsPreviewEnabled] = createState(true)
export { wsPreviewEnabled }

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

// ── Carga inicial ─────────────────────────────────────────────────────────────
function load() {
  try {
    const [ok, content] = GLib.file_get_contents(PREFS_PATH)
    if (!ok) return
    const saved = JSON.parse(new TextDecoder().decode(content))
    if (typeof saved.workspacePreview === "boolean") _setWsPreviewEnabled(saved.workspacePreview)
    if (typeof saved.batteryMonitor === "boolean") _setBatteryMonitorEnabled(saved.batteryMonitor)
    if (typeof saved.tempMonitor === "boolean") _setTempMonitorEnabled(saved.tempMonitor)
    if (typeof saved.clipboardHistory === "boolean") _setClipboardHistoryEnabled(saved.clipboardHistory)
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
      batteryMonitor: batteryMonitorEnabled.get(),
      tempMonitor: tempMonitorEnabled.get(),
      clipboardHistory: clipboardHistoryEnabled.get(),
      timeFormat: timeFormat.get(),
    }
    GLib.file_set_contents(PREFS_PATH, JSON.stringify(config, null, 2))
  } catch (e) { /* no-op: un fallo de escritura no debe romper la UI */ }
}

// ── Setters públicos (mutan estado + persisten) ───────────────────────────────
export function setWsPreviewEnabled(on: boolean) {
  _setWsPreviewEnabled(on)
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
export function setTimeFormat(fmt: TimeFormat) {
  _setTimeFormat(fmt)
  save()
}

load()
