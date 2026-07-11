// widget/settings/PersonalizationSection.tsx
// Sección "Personalización" del panel de ajustes general (widget/SettingsPanel.tsx).
// Contenedor para preferencias del shell que persisten en config/preferences.json
// (ver widget/settings/preferences.ts). Mismo estilo de toggle que EnergySection.
import { Gtk } from "ags/gtk4"
import {
  wsPreviewEnabled, setWsPreviewEnabled,
  spotifyBarEnabled, setSpotifyBarEnabled,
  batteryBarEnabled, setBatteryBarEnabled,
  networkBarEnabled, setNetworkBarEnabled,
  micIndicatorEnabled, setMicIndicatorEnabled,
  trayBarEnabled, setTrayBarEnabled,
  notificationBarEnabled, setNotificationBarEnabled,
  workspacesBarEnabled, setWorkspacesBarEnabled,
  batteryMonitorEnabled, setBatteryMonitorEnabled,
  tempMonitorEnabled, setTempMonitorEnabled,
  clipboardHistoryEnabled, setClipboardHistoryEnabled,
  orionEnabled, setOrionEnabled,
} from "./preferences"
import AutoDndSetting from "./AutoDndSetting"

export default function PersonalizationSection() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]} hexpand>
      <label cssClasses={["sp-section-title"]} label="✦ Personalización" halign={Gtk.Align.START} />

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

      {/* No molestar automático (juegos / apps en pantalla completa) */}
      <AutoDndSetting />
    </box>
  )
}
