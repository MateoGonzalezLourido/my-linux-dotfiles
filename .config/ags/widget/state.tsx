import { createState } from "ags"

export const [widgetsRefresh, setWidgetsRefresh] = createState(false)
export const [barVisible, setBarVisible] = createState(false)
export const [nightLightActive, setNightLightActive] = createState(false)
export const [nightLightTemp, setNightLightTemp] = createState(4500)
export const [brightness, setBrightness] = createState(0.5)

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
export const anyPanelVisible = {
  get: () => powerMenuVisible.get() || quickSettingsVisible.get(),
  subscribe: (cb: (v: boolean) => void) => {
    powerMenuVisible.subscribe(() => cb(powerMenuVisible.get() || quickSettingsVisible.get()))
    quickSettingsVisible.subscribe(() => cb(powerMenuVisible.get() || quickSettingsVisible.get()))
  },
}

export function openPowerMenu() {
  setQuickSettingsVisible(false)
  setPowerMenuVisible(true)
}

export function openQuickSettings() {
  setPowerMenuVisible(false)
  setQuickSettingsVisible(true)
}

export function closeAllPanels() {
  setPowerMenuVisible(false)
  setQuickSettingsVisible(false)
  setQsView("main")
  setInfoSsid(null)
}