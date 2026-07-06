// widget/power/powerState.ts
// Battery / power-save state for the shell. Detects "power save" from the real battery level
// (there is no Hyprland-level power-save signal, so we derive it from AstalBattery) and exposes
// a flag other subsystems can use to suspend battery-consuming background work.
//
// Config lives OUTSIDE the ags config tree, in the conventional XDG config dir under its own
// namespace: ~/.config/power-save/config.json.
import { createState } from "ags"
import GLib from "gi://GLib"
import AstalBattery from "gi://AstalBattery"

const POWER_CONFIG_PATH = `${GLib.get_user_config_dir()}/power-save/config.json`

interface PowerConfig {
  thresholdPct: number         // battery % at/under which power-save turns on (0..100)
  suspendNotifFilters: boolean // when true, notification filter timers pause during power-save
  pauseWsPreview: boolean      // when true, the workspace preview (grim capture) pauses during power-save
}
const DEFAULTS: PowerConfig = { thresholdPct: 15, suspendNotifFilters: false, pauseWsPreview: true }

function loadConfig(): PowerConfig {
  try {
    const [ok, content] = GLib.file_get_contents(POWER_CONFIG_PATH)
    if (ok) {
      const data = JSON.parse(new TextDecoder().decode(content))
      return {
        thresholdPct: typeof data.thresholdPct === "number" ? clampPct(data.thresholdPct) : DEFAULTS.thresholdPct,
        suspendNotifFilters: !!data.suspendNotifFilters,
        pauseWsPreview: typeof data.pauseWsPreview === "boolean" ? data.pauseWsPreview : DEFAULTS.pauseWsPreview,
      }
    }
  } catch (_) {}
  return { ...DEFAULTS }
}

function clampPct(v: number): number { return Math.max(0, Math.min(100, Math.round(v))) }

const initial = loadConfig()

// ── Persisted user settings ────────────────────────────────────────────────────
export const [powerSaveThreshold, _setThreshold] = createState(initial.thresholdPct)
export const [suspendNotifFilters, _setSuspend] = createState(initial.suspendNotifFilters)
export const [pauseWsPreviewInPowerSave, _setPauseWsPreview] = createState(initial.pauseWsPreview)

let saveTimer: number | null = null
function persist() {
  if (saveTimer !== null) GLib.source_remove(saveTimer)
  saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
    try {
      const dir = GLib.path_get_dirname(POWER_CONFIG_PATH)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
      GLib.file_set_contents(POWER_CONFIG_PATH, JSON.stringify({
        thresholdPct: powerSaveThreshold.get(),
        suspendNotifFilters: suspendNotifFilters.get(),
        pauseWsPreview: pauseWsPreviewInPowerSave.get(),
      }))
    } catch (e) {
      console.error("[power] save failed:", e)
    }
    saveTimer = null
    return GLib.SOURCE_REMOVE
  })
}

export function setPowerSaveThreshold(v: number) {
  _setThreshold(clampPct(v))
  recompute()
  persist()
}
export function setSuspendNotifFilters(v: boolean) {
  _setSuspend(v)
  recompute()
  persist()
}
export function setPauseWsPreviewInPowerSave(v: boolean) {
  _setPauseWsPreview(v)
  recompute()
  persist()
}

// ── Derived power state ─────────────────────────────────────────────────────────
// powerSaveActive: on battery and at/under the threshold.
// notifProcessingSuspended: powerSaveActive AND the user opted in to suspending notif filters.
export const [powerSaveActive, _setPowerSaveActive] = createState(false)
export const [notifProcessingSuspended, _setSuspended] = createState(false)
// wsPreviewSuspended: powerSaveActive AND the user opted in to pausing the workspace preview.
export const [wsPreviewSuspended, _setWsPreviewSuspended] = createState(false)
// Pre-composed human label so the UI doesn't have to combine three states in one binding.
export const [batteryStatusText, _setBatteryStatusText] = createState("Sin batería detectada")

const bat = (() => { try { return AstalBattery.get_default() } catch { return null } })()

function recompute() {
  const present = !!(bat && bat.isPresent)
  const charging = present ? bat!.charging : false
  const pct = present ? Math.round(bat!.percentage * 100) : 0
  _setBatteryStatusText(present ? `Batería: ${pct}%${charging ? " (cargando)" : ""}` : "Sin batería detectada")

  // pct > 0 guards against a transient 0 read before the proxy has the real value.
  const active = present && !charging && pct > 0 && pct <= powerSaveThreshold.get()
  _setPowerSaveActive(active)
  _setSuspended(active && suspendNotifFilters.get())
  _setWsPreviewSuspended(active && pauseWsPreviewInPowerSave.get())
}

if (bat) {
  bat.connect("notify::percentage", recompute)
  bat.connect("notify::charging", recompute)
  bat.connect("notify::is-present", recompute)
}
recompute()
