// widget/settings/PersonalizationSection.tsx
// Sección "Personalización" del panel de ajustes general (widget/SettingsPanel.tsx).
// Contenedor para preferencias del shell que persisten en config/preferences.json
// (ver widget/settings/preferences.ts). Mismo estilo de toggle que EnergySection.
import { Gtk } from "ags/gtk4"
import {
  updatesMonitorEnabled, setUpdatesMonitorEnabled,
  updatesPeriodicEnabled, setUpdatesPeriodicEnabled,
  updatesIntervalHours, setUpdatesIntervalHours,
  barAutoHideEnabled, setBarAutoHideEnabled,
  wsPreviewEnabled, setWsPreviewEnabled,
  spotifyBarEnabled, setSpotifyBarEnabled,
  batteryBarEnabled, setBatteryBarEnabled,
  networkBarEnabled, setNetworkBarEnabled,
  micIndicatorEnabled, setMicIndicatorEnabled,
  volumeOsdEnabled, setVolumeOsdEnabled,
  micOsdEnabled, setMicOsdEnabled,
  brightnessOsdEnabled, setBrightnessOsdEnabled,
  trayBarEnabled, setTrayBarEnabled,
  notificationBarEnabled, setNotificationBarEnabled,
  workspacesBarEnabled, setWorkspacesBarEnabled,
  batteryMonitorEnabled, setBatteryMonitorEnabled,
  tempMonitorEnabled, setTempMonitorEnabled,
  clipboardHistoryEnabled, setClipboardHistoryEnabled,
  orionEnabled, setOrionEnabled,
  orionAppsDefault, setOrionAppsDefault,
} from "./preferences"
import AutoDndSetting from "./AutoDndSetting"

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
          <label cssClasses={["sp-field-label"]} label="Actualizaciones del sistema" halign={Gtk.Align.START} />
          <label
            cssClasses={["sp-field-hint"]}
            label={"Muestra un icono en la barra cuando hay actualizaciones del SO o de los drivers de la GPU.\nAl desactivarlo se detiene el sondeo y el icono desaparece al instante."}
            halign={Gtk.Align.START}
            wrap={true}
            lines={2}
            maxWidthChars={62}
            xalign={0}
          />
        </box>
        <button
          cssClasses={updatesMonitorEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
          valign={Gtk.Align.CENTER}
          onClicked={() => setUpdatesMonitorEnabled(!updatesMonitorEnabled.get())}
        >
          <box cssClasses={["qs-toggle-track"]}>
            <box cssClasses={updatesMonitorEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
          </box>
        </button>
      </box>

      {/* recomprobación periódica: solo tiene sentido con el maestro activo */}
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        visible={updatesMonitorEnabled((v: boolean) => v)}
      >
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Recomprobar periódicamente" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Al desactivarlo solo se comprueba una vez al iniciar sesión.\nSe aplica al reiniciar el monitor o en el próximo login."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={updatesPeriodicEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setUpdatesPeriodicEnabled(!updatesPeriodicEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={updatesPeriodicEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>

        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={4}
          visible={updatesPeriodicEnabled((v: boolean) => v)}
        >
          <label cssClasses={["sp-field-label"]} label="Comprobar cada (horas)" halign={Gtk.Align.START} />
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

export default function PersonalizationSection() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]} hexpand>
      <label cssClasses={["sp-section-title"]} label="✦ Personalización" halign={Gtk.Align.START} />

      {/* auto-ocultado de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Ocultar la barra automáticamente" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"La barra se retrae y reaparece al llevar el ratón al borde superior.\nAl desactivarlo queda siempre visible y las ventanas dejan hueco para ella."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={barAutoHideEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setBarAutoHideEnabled(!barAutoHideEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={barAutoHideEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* preview de workspace */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Preview de workspace" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Muestra una captura al hacer clic derecho sobre un workspace.\nAl desactivarlo se deja de capturar en segundo plano."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={wsPreviewEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setWsPreviewEnabled(!wsPreviewEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={wsPreviewEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* reproductor de Spotify en la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Spotify en la barra" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Muestra la canción de Spotify en el centro de la barra.\nAl desactivarlo, no se ejecutan consultas, animaciones ni descargas de carátulas."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={spotifyBarEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setSpotifyBarEnabled(!spotifyBarEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={spotifyBarEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* indicador de batería en la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Batería en la barra" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Muestra el estado de la batería en la barra.\nAGS la oculta automáticamente si no detecta ninguna; desactívala para evitar incluso esa detección."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={batteryBarEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setBatteryBarEnabled(!batteryBarEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={batteryBarEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* indicador de red en la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Red en la barra" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Muestra Wi-Fi o Ethernet cuando hay una conexión activa.\nAl desactivarlo, el widget de red no se carga en la barra."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={networkBarEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setNetworkBarEnabled(!networkBarEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={networkBarEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* indicador de uso del micrófono */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Indicador de micrófono en la barra" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Avisa cuando una aplicación usa un micrófono disponible.\nAl desactivarlo, el indicador y sus escuchas de actividad no se cargan."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={micIndicatorEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setMicIndicatorEnabled(!micIndicatorEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={micIndicatorEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* OSD de volumen */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Widget flotante de volumen" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label="Muestra el nivel de volumen al usar los atajos multimedia."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={volumeOsdEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setVolumeOsdEnabled(!volumeOsdEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={volumeOsdEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* OSD de micrófono */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Widget flotante de micrófono" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label="Muestra el estado del micrófono al usar su atajo multimedia."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={micOsdEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setMicOsdEnabled(!micOsdEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={micOsdEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* OSD de brillo */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Widget flotante de brillo" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label="Muestra el nivel de brillo al usar los atajos multimedia."
              halign={Gtk.Align.START}
              wrap={true}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={brightnessOsdEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setBrightnessOsdEnabled(!brightnessOsdEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={brightnessOsdEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* apps en segundo plano de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Apps en segundo plano en la barra" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Renderiza en la barra los iconos de la bandeja del sistema.\nAl desactivarlo, se desmontan por completo sus iconos, menús y popovers."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={trayBarEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setTrayBarEnabled(!trayBarEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={trayBarEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* botón de notificaciones de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Notificaciones en la barra" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Muestra el botón de notificaciones en la barra.\nNo afecta al panel ni a las notificaciones de Quick Settings."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={notificationBarEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setNotificationBarEnabled(!notificationBarEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={notificationBarEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* selector de workspaces de la barra */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Workspaces en la barra" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Muestra el selector de workspaces en la barra.\nNo afecta a los escritorios ni a sus atajos de Hyprland."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={workspacesBarEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setWorkspacesBarEnabled(!workspacesBarEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={workspacesBarEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* menú de inicio avanzado Orion */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Menú Orion" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Activa el menú de inicio avanzado Orion.\nAl desactivarlo, Orion no se carga en el siguiente arranque de AGS."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={orionEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setOrionEnabled(!orionEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={orionEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* página inicial del menú Orion */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Abrir Orion en Aplicaciones" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Muestra directamente el mosaico de aplicaciones al abrir Orion.\nAl desactivarlo, Orion vuelve a abrirse en Inicio."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={orionAppsDefault((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setOrionAppsDefault(!orionAppsDefault.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={orionAppsDefault((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* almacenamiento del historial del portapapeles */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Historial del portapapeles" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Guarda las copias para consultarlas con SUPER+V.\nAl desactivarlo, detiene la captura y borra el historial guardado."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={clipboardHistoryEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setClipboardHistoryEnabled(!clipboardHistoryEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={clipboardHistoryEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* monitor de batería */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Monitor de batería" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Notificaciones de carga, descarga, ahorro y batería baja.\nSe aplica al reiniciar el monitor o en el próximo login."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={batteryMonitorEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setBatteryMonitorEnabled(!batteryMonitorEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={batteryMonitorEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* monitor de temperatura */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Monitor de temperatura" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"Notificaciones cuando CPU o GPU se sobrecalientan.\nSe aplica al reiniciar el monitor o en el próximo login."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <button
            cssClasses={tempMonitorEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setTempMonitorEnabled(!tempMonitorEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={tempMonitorEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* monitor de actualizaciones del SO + drivers de GPU */}
      <UpdatesSetting />

      {/* No molestar automático (juegos / apps en pantalla completa) */}
      <AutoDndSetting />
    </box>
  )
}
