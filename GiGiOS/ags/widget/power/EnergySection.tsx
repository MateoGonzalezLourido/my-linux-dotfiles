// widget/power/EnergySection.tsx
// "Energía" section of the general settings panel: power-save threshold + the toggle that
// suspends notification-filter timers while in power-save.
import { Gtk } from "ags/gtk4"
import { InlineEditableValue } from "../InlineEditableValue"
import { conectarCambioDeslizador } from "../deslizador"
import { AjusteInterruptor, TarjetaAjustes, TextoInformativo, TituloAjuste, TituloSeccion } from "../settings/componentes"
import InactividadSection from "./InactividadSection"
import textos from "../../textos/ajustes/energia.json" with { type: "json" }
import {
  powerSaveThreshold, setPowerSaveThreshold,
  suspendNotifFilters, setSuspendNotifFilters,
  pauseWsPreviewInPowerSave, setPauseWsPreviewInPowerSave,
  hideSpotifyBarInPowerSave, setHideSpotifyBarInPowerSave,
  powerSaveActive, batteryStatusText,
} from "./powerState.ts"

function ThresholdSlider(): Gtk.Scale {
  const adj = new Gtk.Adjustment({ lower: 0, upper: 100, stepIncrement: 1, pageIncrement: 5 })
  adj.value = powerSaveThreshold.get()
  powerSaveThreshold.subscribe(() => { if (adj.value !== powerSaveThreshold.get()) adj.value = powerSaveThreshold.get() })
  const scale = new Gtk.Scale({ orientation: Gtk.Orientation.HORIZONTAL, adjustment: adj, drawValue: false, hexpand: true })
  scale.cssClasses = ["qs-slider", "brightness"]
  conectarCambioDeslizador(scale, setPowerSaveThreshold)
  return scale
}

export default function EnergySection() {
  const summaryClass = powerSaveActive((active) =>
    active ? ["sp-energy-summary", "active"] : ["sp-energy-summary"]
  )
  const modeClass = powerSaveActive((active) =>
    active ? ["sp-energy-mode", "active"] : ["sp-energy-mode"]
  )

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]} hexpand>
      <TituloSeccion titulo={textos.seccion.titulo} />

      {/* estado actual */}
      <box spacing={6} halign={Gtk.Align.START}>
        <label cssClasses={summaryClass} label={batteryStatusText} />
        <label cssClasses={["sp-energy-separator"]} label="·" />
        <label
          cssClasses={modeClass}
          label={powerSaveActive((active) => active ? textos.estado.ahorroActivo : textos.estado.ahorroDesactivado)}
        />
      </box>

      <TarjetaAjustes titulo={textos.grupos.bateria} icono="󰁹">
        <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["dev-row"]} hexpand>
          <box spacing={8} valign={Gtk.Align.CENTER}>
            <TituloAjuste label={textos.umbral.titulo} hexpand halign={Gtk.Align.START} />
            <InlineEditableValue
              display={powerSaveThreshold((v) => `${Math.round(v)} %`)}
              getValue={() => powerSaveThreshold.get()}
              onCommit={setPowerSaveThreshold}
              min={0} max={100}
              labelClass="sp-field-value"
              tooltip={textos.umbral.tooltip}
            />
          </box>
          {ThresholdSlider() as unknown as any}
          <TextoInformativo label={textos.umbral.descripcion} halign={Gtk.Align.START} wrap />
        </box>
      </TarjetaAjustes>

      <InactividadSection />

      <TarjetaAjustes titulo={textos.grupos.modoAhorro} icono="󰌪">
        <AjusteInterruptor titulo={textos.notificaciones.titulo} informacion={textos.notificaciones.descripcion} activo={suspendNotifFilters} alAlternar={() => setSuspendNotifFilters(!suspendNotifFilters.get())} />
        <AjusteInterruptor titulo={textos.vistasPrevias.titulo} informacion={textos.vistasPrevias.descripcion} activo={pauseWsPreviewInPowerSave} alAlternar={() => setPauseWsPreviewInPowerSave(!pauseWsPreviewInPowerSave.get())} />
        <AjusteInterruptor titulo={textos.spotify.titulo} informacion={textos.spotify.descripcion} activo={hideSpotifyBarInPowerSave} alAlternar={() => setHideSpotifyBarInPowerSave(!hideSpotifyBarInPowerSave.get())} />
      </TarjetaAjustes>

    </box>
  )
}
