// widget/settings/PersonalizationSection.tsx
// Sección "Personalización" del panel de ajustes general (widget/SettingsPanel.tsx).
// Contenedor para preferencias del shell que persisten en config/preferences.json
// (ver widget/settings/preferences.ts). Mismo estilo de toggle que EnergySection.
import { Gtk } from "ags/gtk4"
import {
  wsPreviewEnabled, setWsPreviewEnabled,
  batteryMonitorEnabled, setBatteryMonitorEnabled,
  tempMonitorEnabled, setTempMonitorEnabled,
  clipboardHistoryEnabled, setClipboardHistoryEnabled,
} from "./preferences"

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
    </box>
  )
}
