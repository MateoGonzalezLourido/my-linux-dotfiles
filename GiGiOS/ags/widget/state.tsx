import { createState } from "ags"
import { notifPanelVisible, closeNotifPanel } from "./notifications/store"
import GLib from "gi://GLib"
import GUdev from "gi://GUdev"
import Gio from "gi://Gio"
import { brightnessOsdEnabled } from "./settings/preferences"

export const [calendarVisible, setCalendarVisible] = createState(false)
export function toggleCalendar() { setCalendarVisible(!calendarVisible.get()) }

export const [widgetsRefresh, setWidgetsRefresh] = createState(false)
export const [barVisible, setBarVisible] = createState(false)
export const [nightLightActive, setNightLightActive] = createState(false)
export const [nightLightTemp, setNightLightTemp] = createState(4500)
export const [brightness, setBrightness] = createState(0.5)
export const [isMenuOpen, setIsMenuOpen] = createState(false)
export const [isWsDragging, setIsWsDragging] = createState(false)
export const [isWsPreview, setIsWsPreview] = createState(false)

export const [osdVisible, setOsdVisible] = createState(false)
export const [micOsdVisible, setMicOsdVisible] = createState(false)

// ── Panel visibility ─────────────────────────────────────────────────────────
// Cada panel tiene su propio estado. anyPanelVisible se deriva de ellos.
export const [powerMenuVisible, setPowerMenuVisible] = createState(false)
export const [quickSettingsVisible, setQuickSettingsVisible] = createState(false)
export const [functionsMenuVisible, setFunctionsMenuVisible] = createState(false)
export const [trayMenuVisible, setTrayMenuVisible] = createState(false)

// Ventana de ajustes general (abierta desde el engranaje de QuickSettings). Es un
// overlay a pantalla completa e independiente del ciclo de vida de los paneles del
// bar, igual que la ventana de ajustes de notificaciones.
export const [settingsPanelVisible, setSettingsPanelVisible] = createState(false)
export function openSettingsPanel() {
  closeAllPanels()
  setSettingsPanelVisible(true)
}
export const [qsView, setQsView] = createState<"main" | "wifi" | "bluetooth" | "display" | "audio" | "mic">("main")
export const [infoSsid, setInfoSsid] = createState<string | null>(null)

// anyPanelVisible = true si CUALQUIER panel está abierto.
// La barra observa esto para no ocultarse mientras haya un panel abierto.
// Abrir un panel cierra el resto (exclusividad mutua).
import { orionVisible } from "./orion/state"

// ── Registro centralizado de paneles ─────────────────────────────────────────
// Única fuente de verdad. Para que un panel nuevo mantenga la barra visible
// mientras está abierto, basta con añadir su estado a este array (antes la lista
// se duplicaba en get() y subscribe(), con riesgo de que divergieran).
type PanelState = { get: () => boolean; subscribe: (cb: (v: boolean) => void) => unknown }

const panelStates: PanelState[] = [
  powerMenuVisible,
  quickSettingsVisible,
  functionsMenuVisible,
  trayMenuVisible,
  isMenuOpen,
  notifPanelVisible,
  isWsPreview,
  calendarVisible,
  orionVisible,
]

export const anyPanelVisible = {
  get: () => panelStates.some((s) => s.get()),
  subscribe: (cb: (v: boolean) => void) => {
    const notify = () => cb(panelStates.some((s) => s.get()))
    panelStates.forEach((s) => s.subscribe(notify))
  },
}

// ── Auto-cierre de paneles al salir el ratón ──────────────────────────────────
// Devuelve handlers onEnter/onLeave para un <Gtk.EventControllerMotion>. Al
// salir el puntero del panel se espera graceMs y se cierra; al volver a entrar
// se cancela. Centraliza el patrón que ya usaban PowerOptions y NotificationPanel
// para que todos los paneles del bar se comporten igual.
//
// `visible` (opcional): el estado de visibilidad del panel. Con él se activan dos
// protecciones contra el auto-cierre espurio al abrir un panel desde OTRO panel
// (p.ej. el botón de notificaciones de QuickSettings, que cierra QS y abre el panel
// de notificaciones dejando un hueco entre el botón y el panel nuevo):
//   1. El ratón DEBE haber entrado en el panel al menos una vez antes de que un
//      "leave" pueda armar el cierre. Así, abrir un panel y no llegar a pasar el
//      ratón por encima nunca lo cierra solo.
//   2. Un "leave" disparado mientras el panel ya no es visible (unmap) se ignora,
//      evitando que un panel que se está cerrando arme un closeAllPanels tardío
//      que arrastre al panel recién abierto.
type BoolAccessor = { get: () => boolean; subscribe: (cb: (v: boolean) => void) => unknown }
export function panelAutoClose(close: () => void, graceMs = 300, visible?: BoolAccessor) {
  let timer: number | null = null
  let hasEntered = false
  const cancel = () => {
    if (timer !== null) { GLib.source_remove(timer); timer = null }
  }
  // Cada vez que el panel se abre, exige un nuevo "enter" real antes de auto-cerrar.
  if (visible) {
    visible.subscribe(() => {
      if (visible.get()) { hasEntered = false; cancel() }
    })
  }
  return {
    onEnter: () => { hasEntered = true; cancel() },
    onLeave: () => {
      cancel()
      if (visible && !hasEntered) return           // aún no se ha pasado el ratón por encima
      if (visible && !visible.get()) return         // el panel ya se está cerrando
      timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, graceMs, () => {
        close()
        timer = null
        return GLib.SOURCE_REMOVE
      })
    },
  }
}

// ── Menús/popovers transitorios anclados al bar ───────────────────────────────
// Menús de contexto del tray, popover de CPU/RAM, etc. Al abrirse roban el
// puntero y el bar recibe un "leave", así que necesitan mantenerlo visible.
// isMenuOpen (en panelStates) ya lo logra, pero con un contador de referencias
// soportamos varios abiertos a la vez sin que el cierre de uno apague el estado
// mientras otro sigue abierto. Usa openBarMenu()/closeBarMenu() en pareja.
let _barMenuCount = 0
export function openBarMenu() {
  _barMenuCount++
  setIsMenuOpen(true)
}
export function closeBarMenu() {
  _barMenuCount = Math.max(0, _barMenuCount - 1)
  if (_barMenuCount === 0) setIsMenuOpen(false)
}

export function openPowerMenu() {
  setQuickSettingsVisible(false)
  setFunctionsMenuVisible(false)
  setTrayMenuVisible(false)
  setPowerMenuVisible(true)
}

export function openQuickSettings() {
  setPowerMenuVisible(false)
  setFunctionsMenuVisible(false)
  setTrayMenuVisible(false)
  setQuickSettingsVisible(true)
  closeNotifPanel()
}

export function closeAllPanels() {
  setPowerMenuVisible(false)
  setQuickSettingsVisible(false)
  setFunctionsMenuVisible(false)
  setTrayMenuVisible(false)
  closeNotifPanel()
}

// ── Teclado del bar (solo durante el renumerado de workspaces) ───────────────
// El bar es una capa layer-shell siempre mapeada; pedir teclado (keymode
// ON_DEMAND) permite al compositor darle el foco y, al arrancar sesión, quedárselo
// (había que clicar la app recién abierta). El bar NO necesita teclado salvo por el
// renumerado de workspaces (Workspaces.tsx: Ctrl+long-press → teclas 1–9). Así que
// mantenemos el keymode en NONE y solo lo elevamos a ON_DEMAND mientras un
// renumerado está activo. Ref-contado por si hubiera solapamiento entre botones.
export const [barKeyboardActive, setBarKeyboardActive] = createState(false)
let _barKbCount = 0
export function beginBarKeyboard() {
  _barKbCount++
  if (_barKbCount === 1) setBarKeyboardActive(true)
}
export function endBarKeyboard() {
  if (_barKbCount === 0) return
  _barKbCount--
  if (_barKbCount === 0) setBarKeyboardActive(false)
}

// ── Bar Pin (keybind toggle) ─────────────────────────────────────────────────
export const [barPinnedByKey, setBarPinnedByKey] = createState(false)
export function toggleBarPin() {
  setBarPinnedByKey(!barPinnedByKey.get())
}

// Monitorea /tmp/ags-bar-toggle — el keybind de Hyprland escribe en ese archivo
try {
  const _barToggleFile = Gio.file_new_for_path("/tmp/ags-bar-toggle")
  const _barToggleMonitor = _barToggleFile.monitor(Gio.FileMonitorFlags.NONE, null)
  _barToggleMonitor.connect("changed", () => toggleBarPin())
} catch (e) { console.error("[bar-toggle] monitor error:", e) }

// ── Brightness OSD ────────────────────────────────────────────────────────────
export const [brightnessOsdVisible, setBrightnessOsdVisible] = createState(false)
let _brightOsdTimer: number | null = null

const BACKLIGHT_PATH = "/sys/class/backlight/intel_backlight"
function readBacklightRatio(): number | null {
  try {
    const [brightnessOk, brightnessBytes] = GLib.file_get_contents(`${BACKLIGHT_PATH}/brightness`)
    const [maxOk, maxBytes] = GLib.file_get_contents(`${BACKLIGHT_PATH}/max_brightness`)
    if (!brightnessOk || !maxOk) return null
    const current = Number(new TextDecoder().decode(brightnessBytes).trim())
    const maximum = Number(new TextDecoder().decode(maxBytes).trim())
    if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return null
    return Math.max(0, Math.min(1, current / maximum))
  } catch {
    return null
  }
}

function hideBrightnessOSD() {
  setBrightnessOsdVisible(false)
  if (_brightOsdTimer) clearTimeout(_brightOsdTimer)
  _brightOsdTimer = null
}
export function showBrightnessOSD(startup = false) {
  // brightnessctl ya ha terminado cuando llega esta petición IPC: leer sysfs aquí
  // garantiza que cada repetición del atajo refresque el valor aunque udev tarde.
  const current = readBacklightRatio()
  if (current !== null) setBrightness(current)
  const value = current ?? brightness.get()
  if (!brightnessOsdEnabled.get() || !Number.isFinite(value) || (startup && value >= 0.999)) {
    hideBrightnessOSD()
    return
  }
  setBrightnessOsdVisible(true)
  if (_brightOsdTimer) clearTimeout(_brightOsdTimer)
  _brightOsdTimer = setTimeout(() => {
    setBrightnessOsdVisible(false)
    _brightOsdTimer = null
  }, 2000)
}
brightnessOsdEnabled.subscribe(() => {
  if (!brightnessOsdEnabled.get()) hideBrightnessOSD()
})

// ── Brightness watcher via udev (event-driven, zero polling) ─────────────────
// El kernel mantiene el valor sincronizado para el OSD. Mostrarlo es una acción
// separada que solo solicitan los atajos de Hyprland mediante `ags request`.

try {
  const _backlightClient = new GUdev.Client({ subsystems: ["backlight"] })
  const _dev = _backlightClient.query_by_sysfs_path(BACKLIGHT_PATH)
  const _maxBright = Number(_dev?.get_sysfs_attr_as_int("max_brightness") ?? 0)
  const readBrightness = (device: GUdev.Device) => {
    const raw = Number(device.get_sysfs_attr_as_int_uncached("brightness"))
    if (!Number.isFinite(raw) || !Number.isFinite(_maxBright) || _maxBright <= 0) return null
    return Math.max(0, Math.min(1, raw / _maxBright))
  }

  if (_dev && _maxBright > 0) {
    const initial = readBrightness(_dev)
    if (initial !== null) setBrightness(initial)

    _backlightClient.connect("uevent", (_c: GUdev.Client, action: string, device: GUdev.Device) => {
      if (action !== "change") return
      const value = readBrightness(device)
      if (value !== null) {
        setBrightness(value)
      }
    })
  }
} catch {}
