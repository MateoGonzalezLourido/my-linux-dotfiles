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
import textos from "../../textos/ajustes/energia.json" with { type: "json" }
import { formatearTexto } from "../../textos/formatear.ts"

const POWER_CONFIG_PATH = `${GLib.get_user_config_dir()}/power-save/config.json`

interface PowerConfig {
  thresholdPct: number         // battery % at/under which power-save turns on (0..100)
  suspendNotifFilters: boolean // when true, notification filter timers pause during power-save
  pauseWsPreview: boolean      // when true, the workspace preview (grim capture) pauses during power-save
  hideSpotifyBar: boolean      // when true, the Spotify pill is unmounted during power-save
}
const DEFAULTS: PowerConfig = {
  thresholdPct: 15,
  suspendNotifFilters: false,
  pauseWsPreview: true,
  hideSpotifyBar: true,
}

function loadConfig(): PowerConfig {
  try {
    const [ok, content] = GLib.file_get_contents(POWER_CONFIG_PATH)
    if (ok) {
      const data = JSON.parse(new TextDecoder().decode(content))
      return {
        thresholdPct: typeof data.thresholdPct === "number" ? clampPct(data.thresholdPct) : DEFAULTS.thresholdPct,
        suspendNotifFilters: !!data.suspendNotifFilters,
        pauseWsPreview: typeof data.pauseWsPreview === "boolean" ? data.pauseWsPreview : DEFAULTS.pauseWsPreview,
        hideSpotifyBar: typeof data.hideSpotifyBar === "boolean" ? data.hideSpotifyBar : DEFAULTS.hideSpotifyBar,
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
export const [hideSpotifyBarInPowerSave, _setHideSpotifyBar] = createState(initial.hideSpotifyBar)

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
        hideSpotifyBar: hideSpotifyBarInPowerSave.get(),
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
export function setHideSpotifyBarInPowerSave(v: boolean) {
  _setHideSpotifyBar(v)
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
// spotifyBarSuspended: powerSaveActive AND the user opted in to hiding the Spotify pill.
// Bar.tsx lo usa para DESMONTAR el widget (no solo ocultarlo): la pastilla trae un timer
// de 1 s y el waveform engancha el reloj de FRAMES del monitor (240 Hz en este equipo,
// medido), y un widget meramente invisible seguiría pagando ambos. Al desmontarlo, su
// handler de "destroy" quita el timer, suelta el tick callback y cancela la suscripción.
export const [spotifyBarSuspended, _setSpotifyBarSuspended] = createState(false)
// Pre-composed human label so the UI doesn't have to combine three states in one binding.
export const [batteryStatusText, _setBatteryStatusText] = createState(textos.estado.sinBateria)

const bat = (() => { try { return AstalBattery.get_default() } catch { return null } })()

function recompute() {
  const present = !!(bat && bat.isPresent)
  const charging = present ? bat!.charging : false
  const pct = present ? Math.round(bat!.percentage * 100) : 0
  _setBatteryStatusText(present
    ? formatearTexto(charging ? textos.estado.bateriaCargando : textos.estado.bateria, { porcentaje: pct })
    : textos.estado.sinBateria)

  // pct > 0 guards against a transient 0 read before the proxy has the real value.
  const active = present && !charging && pct > 0 && pct <= powerSaveThreshold.get()
  _setPowerSaveActive(active)
  _setSuspended(active && suspendNotifFilters.get())
  _setWsPreviewSuspended(active && pauseWsPreviewInPowerSave.get())
  _setSpotifyBarSuspended(active && hideSpotifyBarInPowerSave.get())
}

if (bat) {
  bat.connect("notify::percentage", recompute)
  bat.connect("notify::charging", recompute)
  bat.connect("notify::is-present", recompute)
}
recompute()
