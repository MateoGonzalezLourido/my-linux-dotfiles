// widget/power/EnergySection.tsx
// "Energía" section of the general settings panel: power-save threshold + the toggle that
// suspends notification-filter timers while in power-save.
import { Gtk } from "ags/gtk4"
import {
  powerSaveThreshold, setPowerSaveThreshold,
  suspendNotifFilters, setSuspendNotifFilters,
  pauseWsPreviewInPowerSave, setPauseWsPreviewInPowerSave,
  powerSaveActive, batteryStatusText,
} from "./powerState.ts"

function ThresholdSlider(): Gtk.Scale {
  const adj = new Gtk.Adjustment({ lower: 0, upper: 100, stepIncrement: 1, pageIncrement: 5 })
  adj.value = powerSaveThreshold.get()
  powerSaveThreshold.subscribe(() => { if (adj.value !== powerSaveThreshold.get()) adj.value = powerSaveThreshold.get() })
  const scale = new Gtk.Scale({ orientation: Gtk.Orientation.HORIZONTAL, adjustment: adj, drawValue: false, hexpand: true })
  scale.cssClasses = ["qs-slider", "brightness"]
  scale.connect("change-value", (_s, _scroll, val) => { setPowerSaveThreshold(val); return false })
  return scale
}

export default function EnergySection() {
  const statusLabel = powerSaveActive((a) => a ? "Ahorro de energía activo" : "Energía normal")
  const statusClass = powerSaveActive((a) => a ? ["sp-energy-status", "active"] : ["sp-energy-status"])

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]}>
      <label cssClasses={["sp-section-title"]} label="Energía" halign={Gtk.Align.START} />

      {/* estado actual */}
      <box cssClasses={["sp-energy-card"]} orientation={Gtk.Orientation.VERTICAL} spacing={4}>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <label cssClasses={["sp-energy-icon"]} label={powerSaveActive((a) => a ? "󰂃" : "󰁹")} />
          <label cssClasses={statusClass} label={statusLabel} hexpand halign={Gtk.Align.START} />
        </box>
        <label cssClasses={["sp-energy-sub"]} label={batteryStatusText} halign={Gtk.Align.START} />
      </box>

      {/* umbral de ahorro */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]}>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <label cssClasses={["sp-field-label"]} label="Entrar en ahorro al bajar de" hexpand halign={Gtk.Align.START} />
          <label cssClasses={["sp-field-value"]} label={powerSaveThreshold((v) => `${v}%`)} />
        </box>
        {ThresholdSlider() as unknown as any}
        <label
          cssClasses={["sp-field-hint"]}
          label="Se activa con la batería en o por debajo de este nivel (y sin cargar)."
          halign={Gtk.Align.START}
          wrap={true}
        />
      </box>

      {/* suspender filtros de notificaciones */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]}>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Pausar filtros de notificaciones en ahorro" halign={Gtk.Align.START} />
            <label cssClasses={["sp-field-hint"]} label="Detiene los temporizadores de limpieza mientras dure el ahorro; al salir limpia y reanuda." halign={Gtk.Align.START} wrap={true} />
          </box>
          <button
            cssClasses={suspendNotifFilters((v) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setSuspendNotifFilters(!suspendNotifFilters.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={suspendNotifFilters((v) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* pausar preview de workspace en ahorro */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]}>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Pausar preview de workspace en ahorro" halign={Gtk.Align.START} />
            <label cssClasses={["sp-field-hint"]} label="Deja de capturar el workspace con grim mientras dure el ahorro; al salir vuelve a capturar." halign={Gtk.Align.START} wrap={true} />
          </box>
          <button
            cssClasses={pauseWsPreviewInPowerSave((v) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            valign={Gtk.Align.CENTER}
            onClicked={() => setPauseWsPreviewInPowerSave(!pauseWsPreviewInPowerSave.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={pauseWsPreviewInPowerSave((v) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>
    </box>
  )
}
