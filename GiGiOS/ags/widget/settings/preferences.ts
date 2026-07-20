// widget/settings/preferences.ts
//
// Hub de preferencias persistentes de las secciones propias del shell. A diferencia de
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
import { createComputed, createState } from "ags"
import { execAsync } from "ags/process"
import { normalizarModoDaltonismo, type ModoDaltonismo } from "./daltonismo"

const PREFS_PATH = `${GLib.get_user_config_dir()}/gigios/preferences.json`
const SCRIPT_DALTONISMO = `${GLib.get_user_config_dir()}/hypr/scripts/aplicar-filtro-daltonismo.sh`

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

// Batería de la barra. Si se desactiva, el widget no se monta y por tanto no
// inicializa AstalBattery ni sus señales. Si se deja activa, Battery.tsx oculta
// el indicador automáticamente cuando el equipo no expone una batería.
// Default: activada para conservar el comportamiento existente.
const [batteryBarEnabled, _setBatteryBarEnabled] = createState(true)
export { batteryBarEnabled }

// Red de la barra. Al desactivarla, Network.tsx no se monta ni se conecta a las
// señales de AstalNetwork. Si está activa, el propio widget se oculta cuando no
// hay ningún enlace Wi-Fi o Ethernet activo.
const [networkBarEnabled, _setNetworkBarEnabled] = createState(true)
export { networkBarEnabled }

// Indicador puntual de uso del micrófono en la barra. Al desactivarlo, el
// componente no se monta ni escucha cambios de capturas en AstalWp.
const [micIndicatorEnabled, _setMicIndicatorEnabled] = createState(true)
export { micIndicatorEnabled }

// Indicador de captura de pantalla en la barra (compartir por portal + grabadores
// locales). El toggle es MAESTRO y se aplica en caliente: su setter lanza o mata
// hypr/scripts/screencast-monitor.sh, así que apagado no queda ni proceso ni icono.
const [screencastIndicatorEnabled, _setScreencastIndicatorEnabled] = createState(true)
export { screencastIndicatorEnabled }

// OSD flotantes activados por los atajos multimedia. Se controlan por separado
// para poder conservar solo los indicadores que resulten útiles.
const [volumeOsdEnabled, _setVolumeOsdEnabled] = createState(true)
const [micOsdEnabled, _setMicOsdEnabled] = createState(true)
const [brightnessOsdEnabled, _setBrightnessOsdEnabled] = createState(true)
export { volumeOsdEnabled, micOsdEnabled, brightnessOsdEnabled }

// Estado de mute que aplicará inicializador/init.sh al comenzar la sesión.
// Se guardan aquí porque son elecciones del shell, aunque las consume
// un script externo antes de que AGS termine de arrancar.
const [startupVolumeMuted, _setStartupVolumeMuted] = createState(false)
const [startupMicMuted, _setStartupMicMuted] = createState(false)
export { startupVolumeMuted, startupMicMuted }

// Apps en segundo plano (SystemTray) de la barra. Desactivada, no se monta el
// contenedor ni se renderizan sus iconos, bindings, menús o popovers.
const [trayBarEnabled, _setTrayBarEnabled] = createState(true)
export { trayBarEnabled }

// Botón de notificaciones de la barra. Solo controla NotificationButton; el
// panel, el historial y los controles de Quick Settings siguen disponibles.
const [notificationBarEnabled, _setNotificationBarEnabled] = createState(true)
export { notificationBarEnabled }

// Selector de workspaces de la barra. Solo controla su representación en el
// bar; no cambia la configuración ni los atajos de Hyprland.
const [workspacesBarEnabled, _setWorkspacesBarEnabled] = createState(true)
export { workspacesBarEnabled }

// Títulos emergentes de las aplicaciones en el selector de workspaces. Al
// desactivarlos, pasar el ratón por un icono no crea el tooltip nativo de GTK.
// Valor predeterminado: activados para conservar el comportamiento existente.
const [titulosAppsWorkspaceActivos, _setTitulosAppsWorkspaceActivos] = createState(true)
export { titulosAppsWorkspaceActivos }

// Máximo de iconos de aplicaciones que muestra cada workspace en la barra.
// Cuatro conserva el comportamiento histórico; el tope evita que una sola
// pastilla pueda ocupar la barra completa en workspaces muy cargados.
export const WORKSPACE_APP_LIMIT_MIN = 1
export const WORKSPACE_APP_LIMIT_MAX = 8
const [workspaceAppLimit, _setWorkspaceAppLimit] = createState(4)
export { workspaceAppLimit }

const clampWorkspaceAppLimit = (value: number): number =>
  Math.max(WORKSPACE_APP_LIMIT_MIN, Math.min(WORKSPACE_APP_LIMIT_MAX, Math.round(value)))

// Máximo de botones de workspace visibles simultáneamente. El workspace enfocado
// siempre entra en la selección; el resto se elige por uso reciente.
export const WORKSPACE_VISIBLE_LIMIT_MIN = 1
export const WORKSPACE_VISIBLE_LIMIT_MAX = 9
const [workspaceVisibleLimit, _setWorkspaceVisibleLimit] = createState(9)
export { workspaceVisibleLimit }

const clampWorkspaceVisibleLimit = (value: number): number =>
  Math.max(WORKSPACE_VISIBLE_LIMIT_MIN, Math.min(WORKSPACE_VISIBLE_LIMIT_MAX, Math.round(value)))

// Auto-ocultado de la barra. Activado (default) = comportamiento actual: la barra
// se retrae y vuelve al pasar el ratón por la hotzone superior. Desactivado, la
// barra queda fija y además pasa a exclusivity EXCLUSIVE (Bar.tsx), de modo que
// Hyprland le reserva su altura y no tapa las ventanas. Se aplica en caliente.
const [barAutoHideEnabled, _setBarAutoHideEnabled] = createState(true)
export { barAutoHideEnabled }

// Margen superior efectivo de una superficie anclada arriba (paneles, popups, OSD).
// Con auto-ocultado el bar vive en exclusivity NORMAL: no reserva nada, así que cada
// panel tiene que separarse él mismo los ~38px del bar. Sin auto-ocultado el bar es
// EXCLUSIVE y el compositor ya baja por debajo de él a toda superficie no exclusiva,
// de modo que ese margen propio se sumaría al hueco reservado y dejaría el doble de
// aire. Por eso ahí el margen pasa a 0 (o al mínimo que quiera el llamante).
export function barTopMargin(px: number, offPx = 0) {
  return createComputed(() => barAutoHideEnabled() ? px : offPx)
}

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

// Limpieza del portapapeles al comenzar la sesión de Hyprland. La consume el
// script limpiar-portapapeles.sh desde autostart.conf. Default: desactivada.
const [limpiezaPortapapelesAlIniciar, _setLimpiezaPortapapelesAlIniciar] = createState(false)
export { limpiezaPortapapelesAlIniciar }

// Anclaje de ventanas al escritorio de lanzamiento (hypr/scripts/anclaje.py).
// La consumen los DOS lanzadores que usan ese motor: rofi-launch.py (SUPER+SPACE)
// y lanzar-anclado.py (por el que Orion abre sus apps, widget/orion/data/launch.ts).
// Es una sola clave a propósito — para quien la usa es una única función, y
// partirla solo permitiría dejarla a medias; el nombre dice "Rofi" porque ya está
// escrito en el preferences.json de la máquina y renombrarlo apagaría el anclaje
// en silencio. Ninguno de los dos es un daemon: nacen de cero en cada lanzamiento,
// leen esta clave al arrancar y el cambio se aplica en el siguiente — sin pkill ni
// re-exec, al revés que los monitores.
// Default: activado.
const [anclarVentanasRofi, _setAnclarVentanasRofi] = createState(true)
export { anclarVentanasRofi }

// Escáner de apps al iniciar sesión (scripts/escaner-apps-inicio.sh). Vigila 30 s
// las ventanas que se abren solas (autostart, restauración de sesión) y al terminar
// salta al escritorio donde hayan quedado. El script NO es un daemon: nace en
// autostart.conf, mira y muere, así que lee esta clave una vez y el cambio se
// aplica en la próxima sesión — no hace falta pkill ni re-exec.
// Default: DESACTIVADO, porque mover el escritorio activo por su cuenta es
// intrusivo y debe optarse a ello.
const [escanerAppsInicio, _setEscanerAppsInicio] = createState(false)
export { escanerAppsInicio }

// Menú Orion. app.ts consulta este valor antes de importar el módulo: cuando
// está desactivado no se crea su ventana ni se cargan watchers/servicios de
// Orion. El cambio se aplica en el siguiente arranque o recarga de AGS.
const [orionEnabled, _setOrionEnabled] = createState(true)
export { orionEnabled }

// Página inicial de Orion. Desactivado conserva Inicio; activado abre directamente
// el catálogo de aplicaciones. Se aplica en caliente en la siguiente apertura.
const [orionAppsDefault, _setOrionAppsDefault] = createState(false)
export { orionAppsDefault }

// Conserva la última sección de Orion entre cierres dentro de la sesión actual.
// La sección recordada no se persiste: tras reiniciar AGS vuelve a mandar la
// página inicial configurada arriba. Default: desactivado.
const [orionRecordarUltimaSeccion, _setOrionRecordarUltimaSeccion] = createState(false)
export { orionRecordarUltimaSeccion }

// Monitor de actualizaciones (scripts/updates-monitor.sh) + icono de la barra.
// El toggle MAESTRO se aplica en caliente (su setter lanza/mata el script y el
// icono se monta/desmonta con este estado). Default: activado.
const [updatesMonitorEnabled, _setUpdatesMonitorEnabled] = createState(true)
export { updatesMonitorEnabled }

// Recomprobación periódica del monitor de actualizaciones. Lo lee el script bash
// UNA sola vez al arrancar (como batteryMonitor): al desactivarlo comprueba una
// vez y sale. Un cambio solo surte efecto reiniciando el script (reactivar el
// maestro lo relanza). Default: activado.
const [updatesPeriodicEnabled, _setUpdatesPeriodicEnabled] = createState(true)
export { updatesPeriodicEnabled }

// Horas entre comprobaciones periódicas. También leído UNA vez al arrancar por el
// script. Default: 3.
const [updatesIntervalHours, _setUpdatesIntervalHours] = createState(3)
export { updatesIntervalHours }

// Congelar tareas de fondo mientras juegas. Lo leen los scripts bash a través de
// hypr/scripts/lib/gaming-gate.sh, que retiene el sondeo PRESCINDIBLE (monitor de
// actualizaciones, SMART y unidades systemd) mientras haya un juego delante y lo
// reanuda al cerrarlo. Se lee EN VIVO (con caché de 30 s), no una sola vez al
// arrancar como los toggles de evento: es un control de recursos, así que apagarlo
// descongela sin reiniciar nada. NO afecta a los seguidores de eventos de seguridad
// ni al termómetro — ver la cabecera de gaming-gate.sh. Default: activado.
const [gamingFreezeEnabled, _setGamingFreezeEnabled] = createState(true)
export { gamingFreezeEnabled }

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
// se ve al instante sin reiniciar. Vive en "Región, fecha y hora".
export type TimeFormat = "24h" | "12h"
const [timeFormat, _setTimeFormat] = createState<TimeFormat>("24h")
export { timeFormat }

// Corrección global de color para daltonismo. Solo puede haber un shader de
// pantalla activo en Hyprland, de modo que el propio tipo representa también la
// exclusividad entre los tres modos. "ninguno" conserva la imagen original.
const [modoDaltonismo, _setModoDaltonismo] = createState<ModoDaltonismo>("ninguno")
export { modoDaltonismo }

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
    if (typeof saved.batteryBar === "boolean") _setBatteryBarEnabled(saved.batteryBar)
    if (typeof saved.networkBar === "boolean") _setNetworkBarEnabled(saved.networkBar)
    if (typeof saved.micIndicator === "boolean") _setMicIndicatorEnabled(saved.micIndicator)
    if (typeof saved.screencastIndicator === "boolean") _setScreencastIndicatorEnabled(saved.screencastIndicator)
    if (typeof saved.volumeOsd === "boolean") _setVolumeOsdEnabled(saved.volumeOsd)
    if (typeof saved.micOsd === "boolean") _setMicOsdEnabled(saved.micOsd)
    if (typeof saved.brightnessOsd === "boolean") _setBrightnessOsdEnabled(saved.brightnessOsd)
    if (typeof saved.startupVolumeMuted === "boolean") _setStartupVolumeMuted(saved.startupVolumeMuted)
    if (typeof saved.startupMicMuted === "boolean") _setStartupMicMuted(saved.startupMicMuted)
    if (typeof saved.trayBar === "boolean") _setTrayBarEnabled(saved.trayBar)
    if (typeof saved.notificationBar === "boolean") _setNotificationBarEnabled(saved.notificationBar)
    if (typeof saved.workspacesBar === "boolean") _setWorkspacesBarEnabled(saved.workspacesBar)
    if (typeof saved.titulosAppsWorkspace === "boolean") {
      _setTitulosAppsWorkspaceActivos(saved.titulosAppsWorkspace)
    }
    if (typeof saved.workspaceAppLimit === "number" && Number.isFinite(saved.workspaceAppLimit)) {
      _setWorkspaceAppLimit(clampWorkspaceAppLimit(saved.workspaceAppLimit))
    }
    if (typeof saved.workspaceVisibleLimit === "number" && Number.isFinite(saved.workspaceVisibleLimit)) {
      _setWorkspaceVisibleLimit(clampWorkspaceVisibleLimit(saved.workspaceVisibleLimit))
    }
    if (typeof saved.barAutoHide === "boolean") _setBarAutoHideEnabled(saved.barAutoHide)
    if (typeof saved.batteryMonitor === "boolean") _setBatteryMonitorEnabled(saved.batteryMonitor)
    if (typeof saved.tempMonitor === "boolean") _setTempMonitorEnabled(saved.tempMonitor)
    if (typeof saved.clipboardHistory === "boolean") _setClipboardHistoryEnabled(saved.clipboardHistory)
    if (typeof saved.limpiezaPortapapelesAlIniciar === "boolean") {
      _setLimpiezaPortapapelesAlIniciar(saved.limpiezaPortapapelesAlIniciar)
    }
    if (typeof saved.anclarVentanasRofi === "boolean") {
      _setAnclarVentanasRofi(saved.anclarVentanasRofi)
    }
    if (typeof saved.escanerAppsInicio === "boolean") {
      _setEscanerAppsInicio(saved.escanerAppsInicio)
    }
    if (typeof saved.orion === "boolean") _setOrionEnabled(saved.orion)
    if (typeof saved.orionAppsDefault === "boolean") _setOrionAppsDefault(saved.orionAppsDefault)
    if (typeof saved.orionRecordarUltimaSeccion === "boolean") {
      _setOrionRecordarUltimaSeccion(saved.orionRecordarUltimaSeccion)
    }
    if (typeof saved.updatesMonitor === "boolean") _setUpdatesMonitorEnabled(saved.updatesMonitor)
    if (typeof saved.updatesPeriodic === "boolean") _setUpdatesPeriodicEnabled(saved.updatesPeriodic)
    if (typeof saved.updatesIntervalHours === "number" && saved.updatesIntervalHours >= 1) {
      _setUpdatesIntervalHours(Math.floor(saved.updatesIntervalHours))
    }
    if (typeof saved.gamingFreeze === "boolean") _setGamingFreezeEnabled(saved.gamingFreeze)
    if (typeof saved.autoDnd === "boolean") _setAutoDndEnabled(saved.autoDnd)
    if (Array.isArray(saved.autoDndFullscreenApps)) {
      _setAutoDndFullscreenApps(sanitizeApps(saved.autoDndFullscreenApps))
    }
    if (saved.timeFormat === "12h" || saved.timeFormat === "24h") _setTimeFormat(saved.timeFormat)
    _setModoDaltonismo(normalizarModoDaltonismo(saved.modoDaltonismo))
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
      batteryBar: batteryBarEnabled.get(),
      networkBar: networkBarEnabled.get(),
      micIndicator: micIndicatorEnabled.get(),
      screencastIndicator: screencastIndicatorEnabled.get(),
      volumeOsd: volumeOsdEnabled.get(),
      micOsd: micOsdEnabled.get(),
      brightnessOsd: brightnessOsdEnabled.get(),
      startupVolumeMuted: startupVolumeMuted.get(),
      startupMicMuted: startupMicMuted.get(),
      trayBar: trayBarEnabled.get(),
      notificationBar: notificationBarEnabled.get(),
      workspacesBar: workspacesBarEnabled.get(),
      titulosAppsWorkspace: titulosAppsWorkspaceActivos.get(),
      workspaceAppLimit: workspaceAppLimit.get(),
      workspaceVisibleLimit: workspaceVisibleLimit.get(),
      barAutoHide: barAutoHideEnabled.get(),
      batteryMonitor: batteryMonitorEnabled.get(),
      tempMonitor: tempMonitorEnabled.get(),
      clipboardHistory: clipboardHistoryEnabled.get(),
      limpiezaPortapapelesAlIniciar: limpiezaPortapapelesAlIniciar.get(),
      anclarVentanasRofi: anclarVentanasRofi.get(),
      escanerAppsInicio: escanerAppsInicio.get(),
      orion: orionEnabled.get(),
      orionAppsDefault: orionAppsDefault.get(),
      orionRecordarUltimaSeccion: orionRecordarUltimaSeccion.get(),
      updatesMonitor: updatesMonitorEnabled.get(),
      updatesPeriodic: updatesPeriodicEnabled.get(),
      updatesIntervalHours: updatesIntervalHours.get(),
      gamingFreeze: gamingFreezeEnabled.get(),
      autoDnd: autoDndEnabled.get(),
      autoDndFullscreenApps: autoDndFullscreenApps.get(),
      timeFormat: timeFormat.get(),
      modoDaltonismo: modoDaltonismo.get(),
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
export function setBatteryBarEnabled(on: boolean) {
  _setBatteryBarEnabled(on)
  save()
}
export function setNetworkBarEnabled(on: boolean) {
  _setNetworkBarEnabled(on)
  save()
}
export function setMicIndicatorEnabled(on: boolean) {
  _setMicIndicatorEnabled(on)
  save()
}
// Maestro del indicador de captura: se aplica en caliente. Al activar lanza el
// script; al desactivar lo mata y borra screencast.json para que el icono
// desaparezca al instante y no quede proceso sondeando.
export function setScreencastIndicatorEnabled(on: boolean) {
  _setScreencastIndicatorEnabled(on)
  save()
  if (on) {
    execAsync([`${GLib.get_user_config_dir()}/hypr/scripts/screencast-monitor.sh`]).catch(() => {})
  } else {
    execAsync(["pkill", "-f", "screencast-monitor.sh"]).catch(() => {})
    try { Gio.File.new_for_path(`${GLib.get_user_config_dir()}/gigios/screencast.json`).delete(null) } catch (_) {}
  }
}
export function setVolumeOsdEnabled(on: boolean) {
  _setVolumeOsdEnabled(on)
  save()
}
export function setMicOsdEnabled(on: boolean) {
  _setMicOsdEnabled(on)
  save()
}
export function setBrightnessOsdEnabled(on: boolean) {
  _setBrightnessOsdEnabled(on)
  save()
}
export function setStartupVolumeMuted(on: boolean) {
  _setStartupVolumeMuted(on)
  save()
}
export function setStartupMicMuted(on: boolean) {
  _setStartupMicMuted(on)
  save()
}
export function setTrayBarEnabled(on: boolean) {
  _setTrayBarEnabled(on)
  save()
}
export function setNotificationBarEnabled(on: boolean) {
  _setNotificationBarEnabled(on)
  save()
}
export function setWorkspacesBarEnabled(on: boolean) {
  _setWorkspacesBarEnabled(on)
  save()
}
export function setTitulosAppsWorkspaceActivos(activos: boolean) {
  _setTitulosAppsWorkspaceActivos(activos)
  save()
}
export function setWorkspaceAppLimit(value: number) {
  if (!Number.isFinite(value)) return
  const limit = clampWorkspaceAppLimit(value)
  if (workspaceAppLimit.get() === limit) return
  _setWorkspaceAppLimit(limit)
  save()
}
export function setWorkspaceVisibleLimit(value: number) {
  if (!Number.isFinite(value)) return
  const limit = clampWorkspaceVisibleLimit(value)
  if (workspaceVisibleLimit.get() === limit) return
  _setWorkspaceVisibleLimit(limit)
  save()
}
export function setBarAutoHideEnabled(on: boolean) {
  _setBarAutoHideEnabled(on)
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
export function setLimpiezaPortapapelesAlIniciar(activa: boolean) {
  _setLimpiezaPortapapelesAlIniciar(activa)
  save()
}
export function setAnclarVentanasRofi(on: boolean) {
  _setAnclarVentanasRofi(on)
  save()
}
// Sin setter maestro: el script solo corre al iniciar sesión, así que no hay
// proceso vivo al que relanzar ni matar. Basta con persistirlo.
export function setEscanerAppsInicio(on: boolean) {
  _setEscanerAppsInicio(on)
  save()
}
export function setOrionEnabled(on: boolean) {
  _setOrionEnabled(on)
  save()
}
export function setOrionAppsDefault(on: boolean) {
  _setOrionAppsDefault(on)
  save()
}
export function setOrionRecordarUltimaSeccion(activo: boolean) {
  _setOrionRecordarUltimaSeccion(activo)
  save()
}
// Maestro del monitor de actualizaciones: se aplica en caliente. Al activar lanza
// el script (que relee prefs y arranca); al desactivar lo mata y borra updates.json
// para que el icono desaparezca al instante.
export function setUpdatesMonitorEnabled(on: boolean) {
  _setUpdatesMonitorEnabled(on)
  save()
  if (on) {
    execAsync([`${GLib.get_user_config_dir()}/hypr/scripts/updates-monitor.sh`]).catch(() => {})
  } else {
    execAsync(["pkill", "-f", "updates-monitor.sh"]).catch(() => {})
    try { Gio.File.new_for_path(`${GLib.get_user_config_dir()}/gigios/updates.json`).delete(null) } catch (_) {}
  }
}
export function setUpdatesPeriodicEnabled(on: boolean) {
  _setUpdatesPeriodicEnabled(on)
  save()
}
export function setUpdatesIntervalHours(h: number) {
  const n = Math.floor(h)
  if (!Number.isFinite(n) || n < 1) return
  _setUpdatesIntervalHours(n)
  save()
}
export function setTimeFormat(fmt: TimeFormat) {
  _setTimeFormat(fmt)
  save()
}
export function setModoDaltonismo(modo: ModoDaltonismo) {
  const siguiente = normalizarModoDaltonismo(modo)
  if (modoDaltonismo.get() === siguiente) return
  _setModoDaltonismo(siguiente)
  save()
  // El script también se ejecuta desde hyprland.conf en cada recarga. Pasarle
  // el modo aquí evita releer el JSON en el camino interactivo.
  execAsync([SCRIPT_DALTONISMO, siguiente]).catch((error) => {
    console.error("[accesibilidad] No se pudo aplicar la corrección de color:", error)
  })
}
export function setAutoDndEnabled(on: boolean) {
  _setAutoDndEnabled(on)
  save()
}
// No hay setter "maestro" que relance nada: los scripts releen `gamingFreeze` del
// JSON en vivo, así que basta con persistirlo. Apagarlo descongela en <=30 s (el TTL
// de la caché del gate) sin reiniciar ningún monitor.
export function setGamingFreezeEnabled(on: boolean) {
  _setGamingFreezeEnabled(on)
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
