// widget/settings/PersonalizationSection.tsx
// Sección "Personalización" del panel de ajustes general (widget/SettingsPanel.tsx).
// Contenedor para preferencias del shell que persisten en config/preferences.json
// (ver widget/settings/preferences.ts). Usa el Interruptor compartido del shell.
import { Gtk } from "ags/gtk4"
import {
  updatesMonitorEnabled, setUpdatesMonitorEnabled,
  updatesPeriodicEnabled, setUpdatesPeriodicEnabled,
  updatesIntervalHours, setUpdatesIntervalHours,
  gamingFreezeEnabled, setGamingFreezeEnabled,
  barAutoHideEnabled, setBarAutoHideEnabled,
  wsPreviewEnabled, setWsPreviewEnabled,
  spotifyBarEnabled, setSpotifyBarEnabled,
  batteryBarEnabled, setBatteryBarEnabled,
  networkBarEnabled, setNetworkBarEnabled,
  micIndicatorEnabled, setMicIndicatorEnabled,
  screencastIndicatorEnabled, setScreencastIndicatorEnabled,
  volumeOsdEnabled, setVolumeOsdEnabled,
  micOsdEnabled, setMicOsdEnabled,
  brightnessOsdEnabled, setBrightnessOsdEnabled,
  startupVolumeMuted, setStartupVolumeMuted,
  startupMicMuted, setStartupMicMuted,
  trayBarEnabled, setTrayBarEnabled,
  notificationBarEnabled, setNotificationBarEnabled,
  workspacesBarEnabled, setWorkspacesBarEnabled,
  titulosAppsWorkspaceActivos, setTitulosAppsWorkspaceActivos,
  workspaceAppLimit, setWorkspaceAppLimit,
  WORKSPACE_APP_LIMIT_MIN, WORKSPACE_APP_LIMIT_MAX,
  workspaceVisibleLimit, setWorkspaceVisibleLimit,
  WORKSPACE_VISIBLE_LIMIT_MIN, WORKSPACE_VISIBLE_LIMIT_MAX,
  batteryMonitorEnabled, setBatteryMonitorEnabled,
  tempMonitorEnabled, setTempMonitorEnabled,
  clipboardHistoryEnabled, setClipboardHistoryEnabled,
  orionEnabled, setOrionEnabled,
  orionAppsDefault, setOrionAppsDefault,
} from "./preferences"
import AutoDndSetting from "./AutoDndSetting"
import { InlineEditableValue } from "../InlineEditableValue"
import { conectarCambioDeslizador } from "../deslizador"
import Interruptor from "../Interruptor"
import { TextoInformativo, TituloAjuste, TituloSeccion } from "./componentes"

// Monitor de actualizaciones del SO + drivers de GPU (hypr/scripts/updates-monitor.sh).
// El maestro se aplica en caliente (su setter lanza/mata el script); la recomprobación
// periódica y el intervalo los lee el script una sola vez al arrancar, así que el
// cambio se aplica al reiniciarlo (o al reactivar el maestro).
function UpdatesSetting() {
  let hoursRef: Gtk.Entry
  const applyHours = () => {
    const n = parseInt((hoursRef?.get_text() ?? "").trim(), 10)
    if (Number.isFinite(n) && n >= 1) setUpdatesIntervalHours(n)
    hoursRef.set_text(String(updatesIntervalHours.get()))
  }
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["sp-field"]} hexpand>
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
          <TituloAjuste label="Actualizaciones del sistema" halign={Gtk.Align.START} />
          <TextoInformativo
            label={"Muestra un icono en la barra cuando hay actualizaciones del SO o de los drivers de la GPU.\nAl desactivarlo se detiene el sondeo y el icono desaparece al instante."}
            halign={Gtk.Align.START}
            wrap={true}
            lines={2}
            maxWidthChars={62}
            xalign={0}
          />
        </box>
        <Interruptor activo={updatesMonitorEnabled} alAlternar={() => setUpdatesMonitorEnabled(!updatesMonitorEnabled.get())} />
      </box>

      {/* recomprobación periódica: solo tiene sentido con el maestro activo */}
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        visible={updatesMonitorEnabled((v: boolean) => v)}
      >
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Recomprobar periódicamente" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Al desactivarlo solo se comprueba una vez al iniciar sesión.\nSe aplica al reiniciar el monitor o en el próximo login."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={updatesPeriodicEnabled} alAlternar={() => setUpdatesPeriodicEnabled(!updatesPeriodicEnabled.get())} />
        </box>

        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={4}
          visible={updatesPeriodicEnabled((v: boolean) => v)}
        >
          <TituloAjuste label="Comprobar cada (horas)" halign={Gtk.Align.START} />
          <box spacing={6} valign={Gtk.Align.CENTER}>
            <entry
              cssClasses={["sp-num-input"]}
              hexpand
              placeholderText="3"
              $={(self: Gtk.Entry) => { hoursRef = self; self.set_text(String(updatesIntervalHours.get())) }}
              onActivate={applyHours}
            />
            <button cssClasses={["sp-add-rule"]} onClicked={applyHours} valign={Gtk.Align.CENTER}>
              <label label="Guardar" />
            </button>
          </box>
        </box>
      </box>
    </box>
  )
}

function WorkspaceAppLimitSlider(): Gtk.Scale {
  const adjustment = new Gtk.Adjustment({
    lower: WORKSPACE_APP_LIMIT_MIN,
    upper: WORKSPACE_APP_LIMIT_MAX,
    stepIncrement: 1,
    pageIncrement: 1,
  })
  adjustment.value = workspaceAppLimit.get()
  workspaceAppLimit.subscribe(() => {
    if (adjustment.value !== workspaceAppLimit.get()) adjustment.value = workspaceAppLimit.get()
  })

  const scale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment,
    drawValue: false,
    digits: 0,
    hexpand: true,
  })
  scale.cssClasses = ["qs-slider", "brightness"]
  conectarCambioDeslizador(scale, setWorkspaceAppLimit)
  return scale
}

function WorkspaceVisibleLimitSlider(): Gtk.Scale {
  const adjustment = new Gtk.Adjustment({
    lower: WORKSPACE_VISIBLE_LIMIT_MIN,
    upper: WORKSPACE_VISIBLE_LIMIT_MAX,
    stepIncrement: 1,
    pageIncrement: 1,
  })
  adjustment.value = workspaceVisibleLimit.get()
  workspaceVisibleLimit.subscribe(() => {
    if (adjustment.value !== workspaceVisibleLimit.get()) adjustment.value = workspaceVisibleLimit.get()
  })

  const scale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment,
    drawValue: false,
    digits: 0,
    hexpand: true,
  })
  scale.cssClasses = ["qs-slider", "brightness"]
  conectarCambioDeslizador(scale, setWorkspaceVisibleLimit)
  return scale
}

export default function PersonalizationSection() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]} hexpand>
      <TituloSeccion titulo="Personalización" />

      {/* estado inicial del audio */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Iniciar el volumen silenciado" halign={Gtk.Align.START} />
            <TextoInformativo
              label="Al iniciar el sistema, silencia la salida de audio predeterminada."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={startupVolumeMuted} alAlternar={() => setStartupVolumeMuted(!startupVolumeMuted.get())} />
        </box>
      </box>

      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Iniciar el micrófono silenciado" halign={Gtk.Align.START} />
            <TextoInformativo
              label="Al iniciar el sistema, silencia el micrófono predeterminado."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={startupMicMuted} alAlternar={() => setStartupMicMuted(!startupMicMuted.get())} />
        </box>
      </box>

      {/* auto-ocultado de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Ocultar la barra automáticamente" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"La barra se retrae y reaparece al llevar el ratón al borde superior.\nAl desactivarlo queda siempre visible y las ventanas dejan hueco para ella."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={barAutoHideEnabled} alAlternar={() => setBarAutoHideEnabled(!barAutoHideEnabled.get())} />
        </box>
      </box>

      {/* preview de workspace */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Preview de workspace" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Muestra una captura al hacer clic derecho sobre un workspace.\nAl desactivarlo se deja de capturar en segundo plano."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={wsPreviewEnabled} alAlternar={() => setWsPreviewEnabled(!wsPreviewEnabled.get())} />
        </box>
      </box>

      {/* reproductor de Spotify en la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Spotify en la barra" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Muestra la canción de Spotify en el centro de la barra.\nAl desactivarlo, no se ejecutan consultas, animaciones ni descargas de carátulas."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={spotifyBarEnabled} alAlternar={() => setSpotifyBarEnabled(!spotifyBarEnabled.get())} />
        </box>
      </box>

      {/* indicador de batería en la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Batería en la barra" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Muestra el estado de la batería en la barra.\nAGS la oculta automáticamente si no detecta ninguna; desactívala para evitar incluso esa detección."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={batteryBarEnabled} alAlternar={() => setBatteryBarEnabled(!batteryBarEnabled.get())} />
        </box>
      </box>

      {/* indicador de red en la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Red en la barra" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Muestra Wi-Fi o Ethernet cuando hay una conexión activa.\nAl desactivarlo, el widget de red no se carga en la barra."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={networkBarEnabled} alAlternar={() => setNetworkBarEnabled(!networkBarEnabled.get())} />
        </box>
      </box>

      {/* indicador de uso del micrófono */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Indicador de micrófono en la barra" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Avisa cuando una aplicación usa un micrófono disponible.\nAl desactivarlo, el indicador y sus escuchas de actividad no se cargan."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={micIndicatorEnabled} alAlternar={() => setMicIndicatorEnabled(!micIndicatorEnabled.get())} />
        </box>
      </box>

      {/* indicador de captura de pantalla */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Indicador de compartir pantalla" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Avisa mientras compartes pantalla (Discord, OBS, navegador) o grabas en local.\nAl desactivarlo se detiene también el script que lo vigila."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={screencastIndicatorEnabled} alAlternar={() => setScreencastIndicatorEnabled(!screencastIndicatorEnabled.get())} />
        </box>
      </box>

      {/* OSD de volumen */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Widget flotante de volumen" halign={Gtk.Align.START} />
            <TextoInformativo
              label="Muestra el nivel de volumen al usar los atajos multimedia."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={volumeOsdEnabled} alAlternar={() => setVolumeOsdEnabled(!volumeOsdEnabled.get())} />
        </box>
      </box>

      {/* OSD de micrófono */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Widget flotante de micrófono" halign={Gtk.Align.START} />
            <TextoInformativo
              label="Muestra el estado del micrófono al usar su atajo multimedia."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={micOsdEnabled} alAlternar={() => setMicOsdEnabled(!micOsdEnabled.get())} />
        </box>
      </box>

      {/* OSD de brillo */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Widget flotante de brillo" halign={Gtk.Align.START} />
            <TextoInformativo
              label="Muestra el nivel de brillo al usar los atajos multimedia."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={brightnessOsdEnabled} alAlternar={() => setBrightnessOsdEnabled(!brightnessOsdEnabled.get())} />
        </box>
      </box>

      {/* apps en segundo plano de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Apps en segundo plano en la barra" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Renderiza en la barra los iconos de la bandeja del sistema.\nAl desactivarlo, se desmontan por completo sus iconos, menús y popovers."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={trayBarEnabled} alAlternar={() => setTrayBarEnabled(!trayBarEnabled.get())} />
        </box>
      </box>

      {/* botón de notificaciones de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Notificaciones en la barra" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Muestra el botón de notificaciones en la barra.\nNo afecta al panel ni a las notificaciones de Quick Settings."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={notificationBarEnabled} alAlternar={() => setNotificationBarEnabled(!notificationBarEnabled.get())} />
        </box>
      </box>

      {/* selector de workspaces de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Workspaces en la barra" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Muestra el selector de workspaces en la barra.\nNo afecta a los escritorios ni a sus atajos de Hyprland."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={workspacesBarEnabled} alAlternar={() => setWorkspacesBarEnabled(!workspacesBarEnabled.get())} />
        </box>
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={6}
          visible={workspacesBarEnabled((enabled: boolean) => enabled)}
        >
          <box spacing={8} valign={Gtk.Align.CENTER} marginBottom={4}>
            <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
              <TituloAjuste
                label="Títulos de apps al pasar el ratón"
                halign={Gtk.Align.START}
              />
              <TextoInformativo
                label="Muestra el nombre de la app y el título de su ventana tras mantener el puntero sobre su icono."
                halign={Gtk.Align.START}
                wrap={true}
                maxWidthChars={62}
                xalign={0}
              />
            </box>
            <Interruptor activo={titulosAppsWorkspaceActivos} alAlternar={() => setTitulosAppsWorkspaceActivos(!titulosAppsWorkspaceActivos.get())} />
          </box>
          <box spacing={8} valign={Gtk.Align.CENTER}>
            <TituloAjuste
              label="Máximo de apps por workspace"
              hexpand
              halign={Gtk.Align.START}
            />
            <InlineEditableValue
              display={workspaceAppLimit((limit: number) => `${limit}`)}
              getValue={() => workspaceAppLimit.get()}
              onCommit={setWorkspaceAppLimit}
              min={WORKSPACE_APP_LIMIT_MIN}
              max={WORKSPACE_APP_LIMIT_MAX}
              labelClass="sp-field-value"
              tooltip="Editar límite de iconos"
              maxLength={1}
            />
          </box>
          {WorkspaceAppLimitSlider() as unknown as any}
          <TextoInformativo
            label={`Muestra entre ${WORKSPACE_APP_LIMIT_MIN} y ${WORKSPACE_APP_LIMIT_MAX} iconos en cada workspace. Se aplica al instante.`}
            halign={Gtk.Align.START}
            wrap={true}
            xalign={0}
          />
          <box spacing={8} valign={Gtk.Align.CENTER} marginTop={4}>
            <TituloAjuste
              label="Máximo de workspaces visibles"
              hexpand
              halign={Gtk.Align.START}
            />
            <InlineEditableValue
              display={workspaceVisibleLimit((limit: number) => `${limit}`)}
              getValue={() => workspaceVisibleLimit.get()}
              onCommit={setWorkspaceVisibleLimit}
              min={WORKSPACE_VISIBLE_LIMIT_MIN}
              max={WORKSPACE_VISIBLE_LIMIT_MAX}
              labelClass="sp-field-value"
              tooltip="Editar límite de workspaces"
              maxLength={1}
            />
          </box>
          {WorkspaceVisibleLimitSlider() as unknown as any}
          <TextoInformativo
            label="El actual siempre permanece visible; al llegar al límite sale el workspace con contenido usado hace más tiempo."
            halign={Gtk.Align.START}
            wrap={true}
            xalign={0}
          />
        </box>
      </box>

      {/* menú de inicio avanzado Orion */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Menú Orion" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Activa el menú de inicio avanzado Orion.\nAl desactivarlo, Orion no se carga en el siguiente arranque de AGS."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={orionEnabled} alAlternar={() => setOrionEnabled(!orionEnabled.get())} />
        </box>
      </box>

      {/* página inicial del menú Orion */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Abrir Orion en Aplicaciones" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Muestra directamente el mosaico de aplicaciones al abrir Orion.\nAl desactivarlo, Orion vuelve a abrirse en Inicio."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={orionAppsDefault} alAlternar={() => setOrionAppsDefault(!orionAppsDefault.get())} />
        </box>
      </box>

      {/* almacenamiento del historial del portapapeles */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Historial del portapapeles" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Guarda las copias para consultarlas con SUPER+V.\nAl desactivarlo, detiene la captura y borra el historial guardado."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={clipboardHistoryEnabled} alAlternar={() => setClipboardHistoryEnabled(!clipboardHistoryEnabled.get())} />
        </box>
      </box>

      {/* monitor de batería */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Monitor de batería" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Notificaciones de carga, descarga, ahorro y batería baja.\nSe aplica al reiniciar el monitor o en el próximo login."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={batteryMonitorEnabled} alAlternar={() => setBatteryMonitorEnabled(!batteryMonitorEnabled.get())} />
        </box>
      </box>

      {/* monitor de temperatura */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <TituloAjuste label="Monitor de temperatura" halign={Gtk.Align.START} />
            <TextoInformativo
              label={"Notificaciones cuando CPU o GPU se sobrecalientan.\nSe aplica al reiniciar el monitor o en el próximo login."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <Interruptor activo={tempMonitorEnabled} alAlternar={() => setTempMonitorEnabled(!tempMonitorEnabled.get())} />
        </box>
      </box>

      {/* monitor de actualizaciones del SO + drivers de GPU */}
      <UpdatesSetting />

      {/* No molestar automático (juegos / apps en pantalla completa) */}
      <AutoDndSetting />

      {/* Congelar sondeos de fondo mientras juegas — la otra mitad del "modo juego":
          el auto-DND calla las notificaciones, esto quita la CARGA. Va justo detrás
          porque los dispara la misma detección (widget/bar/games). */}
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
          <TituloAjuste label="Congelar tareas de fondo al jugar" halign={Gtk.Align.START} />
          <TextoInformativo
            label={"Pausa los sondeos prescindibles (actualizaciones, SMART, servicios) mientras haya un juego.\nSe reanudan al cerrarlo. No afecta a la vigilancia de seguridad ni a la temperatura."}
            halign={Gtk.Align.START}
            wrap={true}
            lines={2}
            maxWidthChars={62}
            xalign={0}
          />
        </box>
        <Interruptor activo={gamingFreezeEnabled} alAlternar={() => setGamingFreezeEnabled(!gamingFreezeEnabled.get())} />
      </box>
    </box>
  )
}
