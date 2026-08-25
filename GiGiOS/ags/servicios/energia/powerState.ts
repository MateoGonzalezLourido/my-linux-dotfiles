// servicios/energia/powerState.ts
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

/** Un tiempo de inactividad del modo ahorro: minutos + si ese listener se usa. */
export interface TiempoAhorro { min: number; on: boolean }

interface PowerConfig {
  thresholdPct: number         // battery % at/under which power-save turns on (0..100)
  forcePowerSave: boolean      // when true, power-save is ON regardless of battery level/charging/presence
  suspendNotifFilters: boolean // when true, notification filter timers pause during power-save
  pauseWsPreview: boolean      // when true, the workspace preview (grim capture) pauses during power-save
  hideSpotifyBar: boolean      // when true, the Spotify pill is unmounted during power-save
  freezeBackground: boolean    // when true, background maintenance polling freezes during power-save
  fallbackWave: boolean        // when true, the Spotify wave drops cava for its procedural animation
  hideMascota: boolean         // when true, the desktop pet window is unmounted during power-save
  opaquePanels: boolean        // when true, the shell's translucent surfaces turn fully opaque during power-save
  reduceBrightness: boolean    // when true, screen brightness drops to `brightnessPct` during power-save
  brightnessPct: number        // target brightness (0..100) while power-save is on
  tlpAuto: boolean             // when true, the TLP profile switches to "ahorro" during power-save
  idleOverride: boolean        // when true, hypridle timeouts are replaced by the three below
  idleDpms: TiempoAhorro       // screen off
  idleLock: TiempoAhorro       // lock session
  idleSuspend: TiempoAhorro    // suspend
  /** Brillo de antes de que el ahorro lo bajara, o `null` si no hay reducción vigente.
   *  NO es un ajuste: es un APUNTE, y por eso vive en disco y no solo en RAM. El brillo es
   *  lo único de este módulo que deja residuo FÍSICO — por DDC se graba en la firmware del
   *  monitor y sobrevive al proceso, así que si AGS muere con el ahorro puesto la pantalla
   *  se queda baja para siempre y, peor, `brightness.subscribe(saveDisplayConfig)` adopta
   *  ese valor impuesto como si lo hubiera elegido el usuario y borra el real. Es el mismo
   *  fallo que documenta `applyScheduledBrightness` para las franjas horarias, y se cura
   *  igual: con el apunte en disco, la restauración pendiente se cobra en el arranque
   *  siguiente. Va en este fichero y no en uno propio porque se reescribe entero de una vez. */
  brightnessBefore: number | null
}
const DEFAULTS: PowerConfig = {
  thresholdPct: 15,
  forcePowerSave: false,
  suspendNotifFilters: false,
  pauseWsPreview: true,
  hideSpotifyBar: true,
  freezeBackground: true,
  fallbackWave: true,
  hideMascota: true,
  // Apagado por defecto, como el brillo y TLP: es la única medida de esta sección que
  // CAMBIA EL ASPECTO del escritorio en vez de quitar algo que sobra, y encontrarse los
  // paneles opacos sin haberlo pedido se lee como un fallo del tema, no como un ahorro.
  opaquePanels: false,
  reduceBrightness: false,
  brightnessPct: 40,
  tlpAuto: false,
  idleOverride: false,
  idleDpms: { min: 2, on: true },
  // Apagado por defecto: el listener general de bloqueo también lo está en esta
  // máquina, y que entrar en ahorro empezara a pedir contraseña sería una sorpresa.
  idleLock: { min: 3, on: false },
  idleSuspend: { min: 5, on: true },
  brightnessBefore: null,
}

function loadConfig(): PowerConfig {
  try {
    const [ok, content] = GLib.file_get_contents(POWER_CONFIG_PATH)
    if (ok) {
      const data = JSON.parse(new TextDecoder().decode(content))
      return {
        thresholdPct: typeof data.thresholdPct === "number" ? clampPct(data.thresholdPct) : DEFAULTS.thresholdPct,
        forcePowerSave: !!data.forcePowerSave,
        suspendNotifFilters: !!data.suspendNotifFilters,
        pauseWsPreview: typeof data.pauseWsPreview === "boolean" ? data.pauseWsPreview : DEFAULTS.pauseWsPreview,
        hideSpotifyBar: typeof data.hideSpotifyBar === "boolean" ? data.hideSpotifyBar : DEFAULTS.hideSpotifyBar,
        freezeBackground: typeof data.freezeBackground === "boolean" ? data.freezeBackground : DEFAULTS.freezeBackground,
        fallbackWave: typeof data.fallbackWave === "boolean" ? data.fallbackWave : DEFAULTS.fallbackWave,
        hideMascota: typeof data.hideMascota === "boolean" ? data.hideMascota : DEFAULTS.hideMascota,
        opaquePanels: typeof data.opaquePanels === "boolean" ? data.opaquePanels : DEFAULTS.opaquePanels,
        reduceBrightness: typeof data.reduceBrightness === "boolean" ? data.reduceBrightness : DEFAULTS.reduceBrightness,
        brightnessPct: typeof data.brightnessPct === "number" ? clampPct(data.brightnessPct) : DEFAULTS.brightnessPct,
        tlpAuto: typeof data.tlpAuto === "boolean" ? data.tlpAuto : DEFAULTS.tlpAuto,
        idleOverride: typeof data.idleOverride === "boolean" ? data.idleOverride : DEFAULTS.idleOverride,
        idleDpms: leerTiempo(data.idleDpms, DEFAULTS.idleDpms),
        idleLock: leerTiempo(data.idleLock, DEFAULTS.idleLock),
        idleSuspend: leerTiempo(data.idleSuspend, DEFAULTS.idleSuspend),
        brightnessBefore: typeof data.brightnessBefore === "number"
          ? Math.max(0, Math.min(1, data.brightnessBefore))
          : null,
      }
    }
  } catch (_) {}
  return { ...DEFAULTS }
}

function clampPct(v: number): number { return Math.max(0, Math.min(100, Math.round(v))) }

/** Un tiempo del disco, campo a campo: una clave ausente cae a su valor por defecto
 *  en vez de invalidar el objeto entero (mismo criterio que el resto de este loader). */
function leerTiempo(bruto: any, porDefecto: TiempoAhorro): TiempoAhorro {
  if (!bruto || typeof bruto !== "object") return { ...porDefecto }
  return {
    min: typeof bruto.min === "number" && bruto.min >= 1 ? Math.round(bruto.min) : porDefecto.min,
    on: typeof bruto.on === "boolean" ? bruto.on : porDefecto.on,
  }
}

const initial = loadConfig()

// ── Persisted user settings ────────────────────────────────────────────────────
export const [powerSaveThreshold, _setThreshold] = createState(initial.thresholdPct)
export const [forcePowerSave, _setForcePowerSave] = createState(initial.forcePowerSave)
export const [suspendNotifFilters, _setSuspend] = createState(initial.suspendNotifFilters)
export const [pauseWsPreviewInPowerSave, _setPauseWsPreview] = createState(initial.pauseWsPreview)
export const [hideSpotifyBarInPowerSave, _setHideSpotifyBar] = createState(initial.hideSpotifyBar)
export const [freezeBackgroundInPowerSave, _setFreezeBackground] = createState(initial.freezeBackground)
export const [fallbackWaveInPowerSave, _setFallbackWave] = createState(initial.fallbackWave)
export const [hideMascotaInPowerSave, _setHideMascota] = createState(initial.hideMascota)
export const [opaquePanelsInPowerSave, _setOpaquePanels] = createState(initial.opaquePanels)
export const [reduceBrightnessInPowerSave, _setReduceBrightness] = createState(initial.reduceBrightness)
export const [powerSaveBrightnessPct, _setBrightnessPct] = createState(initial.brightnessPct)
export const [tlpAutoInPowerSave, _setTlpAuto] = createState(initial.tlpAuto)
export const [idleOverrideInPowerSave, _setIdleOverride] = createState(initial.idleOverride)
export const [idleDpmsAhorro, _setIdleDpms] = createState(initial.idleDpms)
export const [idleLockAhorro, _setIdleLock] = createState(initial.idleLock)
export const [idleSuspendAhorro, _setIdleSuspend] = createState(initial.idleSuspend)

// El apunte del brillo previo (ver `brightnessBefore` arriba). No es reactivo: su único
// consumidor es `brilloAhorro.ts`, que lo lee al arrancar y lo reescribe en las dos
// transiciones. Se guarda SÍNCRONO —no por el debounce de 600 ms de `persist()`— porque
// justo después de escribirlo se cambia el brillo de verdad: si AGS muriera en esa
// ventana, el disco diría que no hay nada que restaurar y la pantalla se quedaría baja.
let brilloAntesDelAhorro: number | null = initial.brightnessBefore
export function leerBrilloAntesDelAhorro(): number | null { return brilloAntesDelAhorro }
export function guardarBrilloAntesDelAhorro(v: number | null): void {
  brilloAntesDelAhorro = v
  persistAhora()
}

let saveTimer: number | null = null
function persist() {
  if (saveTimer !== null) GLib.source_remove(saveTimer)
  saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
    persistAhora()
    saveTimer = null
    return GLib.SOURCE_REMOVE
  })
}

function persistAhora() {
  try {
    const dir = GLib.path_get_dirname(POWER_CONFIG_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    GLib.file_set_contents(POWER_CONFIG_PATH, JSON.stringify({
      thresholdPct: powerSaveThreshold.get(),
      forcePowerSave: forcePowerSave.get(),
      suspendNotifFilters: suspendNotifFilters.get(),
      pauseWsPreview: pauseWsPreviewInPowerSave.get(),
      hideSpotifyBar: hideSpotifyBarInPowerSave.get(),
      freezeBackground: freezeBackgroundInPowerSave.get(),
      fallbackWave: fallbackWaveInPowerSave.get(),
      hideMascota: hideMascotaInPowerSave.get(),
      opaquePanels: opaquePanelsInPowerSave.get(),
      reduceBrightness: reduceBrightnessInPowerSave.get(),
      brightnessPct: powerSaveBrightnessPct.get(),
      tlpAuto: tlpAutoInPowerSave.get(),
      idleOverride: idleOverrideInPowerSave.get(),
      idleDpms: idleDpmsAhorro.get(),
      idleLock: idleLockAhorro.get(),
      idleSuspend: idleSuspendAhorro.get(),
      brightnessBefore: brilloAntesDelAhorro,
    }))
  } catch (e) {
    console.error("[power] save failed:", e)
  }
}

export function setPowerSaveThreshold(v: number) {
  _setThreshold(clampPct(v))
  recompute()
  persist()
}
export function setForcePowerSave(v: boolean) {
  _setForcePowerSave(v)
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
export function setFreezeBackgroundInPowerSave(v: boolean) {
  _setFreezeBackground(v)
  recompute()
  persist()
}
export function setFallbackWaveInPowerSave(v: boolean) {
  _setFallbackWave(v)
  recompute()
  persist()
}
export function setHideMascotaInPowerSave(v: boolean) {
  _setHideMascota(v)
  recompute()
  persist()
}
export function setOpaquePanelsInPowerSave(v: boolean) {
  _setOpaquePanels(v)
  recompute()
  persist()
}
export function setReduceBrightnessInPowerSave(v: boolean) {
  _setReduceBrightness(v)
  recompute()
  persist()
}
export function setPowerSaveBrightnessPct(v: number) {
  _setBrightnessPct(clampPct(v))
  recompute()
  persist()
}
export function setTlpAutoInPowerSave(v: boolean) {
  _setTlpAuto(v)
  recompute()
  persist()
}
export function setIdleOverrideInPowerSave(v: boolean) {
  _setIdleOverride(v)
  recompute()
  persist()
}
export function setIdleDpmsAhorro(v: TiempoAhorro) {
  _setIdleDpms({ min: Math.max(1, Math.round(v.min)), on: v.on })
  recompute()
  persist()
}
export function setIdleLockAhorro(v: TiempoAhorro) {
  _setIdleLock({ min: Math.max(1, Math.round(v.min)), on: v.on })
  recompute()
  persist()
}
export function setIdleSuspendAhorro(v: TiempoAhorro) {
  _setIdleSuspend({ min: Math.max(1, Math.round(v.min)), on: v.on })
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
// Barra.tsx lo usa para DESMONTAR el widget (no solo ocultarlo): la pastilla trae un timer
// de 1 s y el waveform engancha el reloj de FRAMES del monitor (240 Hz en este equipo,
// medido), y un widget meramente invisible seguiría pagando ambos. Al desmontarlo, su
// handler de "destroy" quita el timer, suelta el tick callback y cancela la suscripción.
export const [spotifyBarSuspended, _setSpotifyBarSuspended] = createState(false)
// backgroundJobsSuspended: powerSaveActive AND the user opted in to freezing background work.
// A diferencia de los tres de arriba, este NO lo consume ningún widget: lo publica
// gamingState.ts en runtime-state.json para el lado BASH (lib/gaming-gate.sh), que congela
// el mismo sondeo prescindible que ya congela al jugar (actualizaciones, SMART, unidades).
// Se combina aquí, y no en bash, a propósito: rederivar allí "¿ahorro activo?" ya salió mal
// una vez —/sys/class/power_supply lista también la pila del ratón (ver oom-monitor.sh)— y
// AstalBattery/upower ya distingue la batería del equipo. Una sola fuente de verdad.
export const [backgroundJobsSuspended, _setBackgroundJobsSuspended] = createState(false)
// spectrumSuspended: powerSaveActive AND the user opted in to dropping the audio analysis.
// Lo consume OndaSpotify.tsx para NO lanzar `cava` y ceder a su animación procedimental, que
// no cuesta ni un proceso. Es un escalón ANTES que spotifyBarSuspended: con este la pastilla
// se sigue viendo y la onda se sigue moviendo, solo deja de seguir la música. Van por separado
// a propósito — quien quiera conservar el reproductor visible durante el ahorro puede querer
// justo eso y aun así no pagar la captura de audio.
export const [spectrumSuspended, _setSpectrumSuspended] = createState(false)
// mascotaSuspended: powerSaveActive AND the user opted in to hiding the desktop pet.
// `Lagarto.tsx` lo suma a su `visible`, que ahí NO es solo cosmético: la ventana se
// desmapea y su suscripción a `visible` para el temporizador de la marcha, así que oculto
// no cuesta ni un timeout ni un frame (el propio fichero ya lo documenta). Y eso es lo que
// se busca: el lagarto anima a ~11 fotogramas/s y cada uno es un commit de una capa
// layer-shell que Hyprland tiene que recomponer. Por diseño solo pasea cuando el escritorio
// está vacío o sin foco — o sea, justo en los ratos en que el equipo estaría en reposo y la
// batería no debería estar pagando una animación decorativa.
export const [mascotaSuspended, _setMascotaSuspended] = createState(false)
// transparenciaSuspendida: powerSaveActive AND the user opted in to opaque panels.
// Lo consume `opacidadAhorro.ts`, que redefine las variables `--lamina-*` del tema.
// Lo que se ahorra no es GTK —pintar un color sólido o uno con alfa cuesta lo mismo—
// sino HYPRLAND: cada lámina translúcida lleva `blur = true` en `hypr/gigios/reglas.lua`
// (quick-settings, notification-panel, calendar-panel, orion, osd), y desenfocar lo que
// se ve por debajo es trabajo de GPU por fotograma mientras el panel esté abierto. Con
// la lámina opaca, GTK declara la región como opaca y el compositor puede saltarse tanto
// el desenfoque como el pintado del escritorio de detrás. Es la única medida de la
// sección que ahorra mientras el usuario MIRA algo, no mientras el equipo está en reposo.
export const [transparenciaSuspendida, _setTransparenciaSuspendida] = createState(false)
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
  // forcePowerSave overrides the battery-derived condition: it turns power-save ON regardless
  // of level/charging/presence, so it also works on a desktop with no battery.
  const active = forcePowerSave.get() || (present && !charging && pct > 0 && pct <= powerSaveThreshold.get())
  _setPowerSaveActive(active)
  _setSuspended(active && suspendNotifFilters.get())
  _setWsPreviewSuspended(active && pauseWsPreviewInPowerSave.get())
  _setSpotifyBarSuspended(active && hideSpotifyBarInPowerSave.get())
  _setBackgroundJobsSuspended(active && freezeBackgroundInPowerSave.get())
  _setSpectrumSuspended(active && fallbackWaveInPowerSave.get())
  _setMascotaSuspended(active && hideMascotaInPowerSave.get())
  _setTransparenciaSuspendida(active && opaquePanelsInPowerSave.get())
}

if (bat) {
  bat.connect("notify::percentage", recompute)
  bat.connect("notify::charging", recompute)
  bat.connect("notify::is-present", recompute)
}
recompute()
