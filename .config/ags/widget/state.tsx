import { createState } from "ags"
import { notifPanelVisible, closeNotifPanel } from "./notifications/store"
import GLib from "gi://GLib"
import GUdev from "gi://GUdev"
import Gio from "gi://Gio"

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
export const [pixelVolOsdVisible, setPixelVolOsdVisible] = createState(false)

let _pvOsdTimer: number | null = null
export function showPixelVolOSD() {
  setPixelVolOsdVisible(true)
  if (_pvOsdTimer) clearTimeout(_pvOsdTimer)
  _pvOsdTimer = setTimeout(() => {
    setPixelVolOsdVisible(false)
    _pvOsdTimer = null
  }, 2500)
}

export const [pixelMicOsdVisible, setPixelMicOsdVisible] = createState(false)

let _pmOsdTimer: number | null = null
export function showPixelMicOSD() {
  setPixelMicOsdVisible(true)
  if (_pmOsdTimer) clearTimeout(_pmOsdTimer)
  _pmOsdTimer = setTimeout(() => {
    setPixelMicOsdVisible(false)
    _pmOsdTimer = null
  }, 2500)
}

// ── Panel visibility ─────────────────────────────────────────────────────────
// Cada panel tiene su propio estado. anyPanelVisible se deriva de ellos.
export const [powerMenuVisible, setPowerMenuVisible] = createState(false)
export const [quickSettingsVisible, setQuickSettingsVisible] = createState(false)
export const [qsView, setQsView] = createState<"main" | "wifi" | "bluetooth" | "display" | "audio" | "mic">("main")
export const [infoSsid, setInfoSsid] = createState<string | null>(null)

quickSettingsVisible.subscribe((v) => {
  if (!v) {
    setQsView("main")
    setInfoSsid(null)
  }
})

// anyPanelVisible = true si CUALQUIER panel está abierto.
// La barra observa esto para no ocultarse mientras haya un panel abierto.
// Abrir un panel cierra el resto (exclusividad mutua).
import { orionVisible } from "./orion/state"
import { overviewVisible } from "./WorkspaceOverview/store"

export const anyPanelVisible = {
  get: () => powerMenuVisible.get() || quickSettingsVisible.get() || isMenuOpen.get() || notifPanelVisible.get() || isWsPreview.get() || calendarVisible.get() || orionVisible.get() || overviewVisible.get(),
  subscribe: (cb: (v: boolean) => void) => {
    const notify = () => cb(powerMenuVisible.get() || quickSettingsVisible.get() || isMenuOpen.get() || notifPanelVisible.get() || isWsPreview.get() || calendarVisible.get() || orionVisible.get() || overviewVisible.get())
    powerMenuVisible.subscribe(notify)
    quickSettingsVisible.subscribe(notify)
    isMenuOpen.subscribe(notify)
    notifPanelVisible.subscribe(notify)
    isWsPreview.subscribe(notify)
    calendarVisible.subscribe(notify)
    orionVisible.subscribe(notify)
    overviewVisible.subscribe(notify)
  },
}

export function openPowerMenu() {
  setQuickSettingsVisible(false)
  setPowerMenuVisible(true)
}

export function openQuickSettings() {
  setPowerMenuVisible(false)
  setQuickSettingsVisible(true)
  closeNotifPanel()
}

export function closeAllPanels() {
  setPowerMenuVisible(false)
  setQuickSettingsVisible(false)
  setQsView("main")
  setInfoSsid(null)
  closeNotifPanel()
}

// ── Game Detection State ──────────────────────────────────────────────────────
export const [gameActive, setGameActive] = createState(false)
export const [gameInfo, setGameInfo] = createState<{
  class: string
  title: string
  address: string
  workspaceId: number
  fullscreen: number
} | null>(null)

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
export function showBrightnessOSD() {
  setBrightnessOsdVisible(true)
  if (_brightOsdTimer) clearTimeout(_brightOsdTimer)
  _brightOsdTimer = setTimeout(() => {
    setBrightnessOsdVisible(false)
    _brightOsdTimer = null
  }, 2000)
}

// ── Brightness watcher via udev (event-driven, zero polling) ─────────────────
// El kernel envía un uevent "change" en el subsistema "backlight" cada vez que
// algo modifica el brillo, así que no necesitamos ningún timer.
let _startupSuppressed = true
setTimeout(() => { _startupSuppressed = false }, 5000)

try {
  const _backlightClient = new GUdev.Client({ subsystems: ["backlight"] })
  const _dev = _backlightClient.query_by_sysfs_path("/sys/class/backlight/intel_backlight")
  const _maxBright = _dev?.get_sysfs_attr_as_int("max_brightness") ?? 0

  if (_dev && _maxBright > 0) {
    setBrightness(_dev.get_sysfs_attr_as_int("brightness") / _maxBright)

    _backlightClient.connect("uevent", (_c: GUdev.Client, action: string, device: GUdev.Device) => {
      if (action !== "change") return
      setBrightness(device.get_sysfs_attr_as_int_uncached("brightness") / _maxBright)
      if (!_startupSuppressed) showBrightnessOSD()
    })
  }
} catch {}