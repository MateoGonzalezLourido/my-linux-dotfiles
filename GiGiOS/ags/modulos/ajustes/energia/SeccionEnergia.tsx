// modulos/ajustes/energia/SeccionEnergia.tsx
// Sección de energía: umbral y funciones que se suspenden durante el ahorro.
import { Gtk } from "ags/gtk4"
import { createComputed, onCleanup } from "ags"
import { InlineEditableValue } from "../../../componentes/InlineEditableValue"
import { conectarCambioDeslizador } from "../../../utilidades/deslizador"
import { AjusteInterruptor, TarjetaAjustes, TextoInformativo, TituloAjuste, TituloSeccion } from "../componentes"
import Inactividad from "../pantalla/Inactividad"
import textos from "../../../textos/ajustes/energia.json" with { type: "json" }
import {
  powerSaveThreshold, setPowerSaveThreshold,
  forcePowerSave, setForcePowerSave,
  suspendNotifFilters, setSuspendNotifFilters,
  pauseWsPreviewInPowerSave, setPauseWsPreviewInPowerSave,
  hideSpotifyBarInPowerSave, setHideSpotifyBarInPowerSave,
  fallbackWaveInPowerSave, setFallbackWaveInPowerSave,
  freezeBackgroundInPowerSave, setFreezeBackgroundInPowerSave,
  hideMascotaInPowerSave, setHideMascotaInPowerSave,
  opaquePanelsInPowerSave, setOpaquePanelsInPowerSave,
  reduceBrightnessInPowerSave, setReduceBrightnessInPowerSave,
  powerSaveBrightnessPct, setPowerSaveBrightnessPct,
  tlpAutoInPowerSave, setTlpAutoInPowerSave,
  powerSaveActive, batteryStatusText,
} from "../../../servicios/energia/powerState.ts"
import { brightnessSupported } from "../../../servicios/pantalla/brightness.ts"
import InactividadAhorro from "./InactividadAhorro"
import { tlpAvailable, tlpMode, tlpBusy, setTlpMode } from "../../../servicios/energia/tlp.ts"
import { botonApagado, setBotonApagado } from "../preferences.ts"
import {
  ACCIONES_BOTON_ENCENDIDO,
  comprobarBotonEncendido,
  teclaCedidaAHyprland,
  type AccionBotonEncendido,
} from "../../../servicios/energia/botonEncendido.ts"
import { DisplaySelect } from "../../../servicios/pantalla/controls"

/** Deslizador 0..100 atado a un estado de `powerState`. Lo comparten el umbral de batería
 *  y el brillo del ahorro: los dos son un porcentaje entero con la misma presentación.
 *  `minimo` existe porque el brillo no puede llegar a 0 (dejaría la pantalla apagada sin
 *  nada visible con lo que volver a subirla), mientras que en el umbral el 0 significa
 *  "desactivado" y sí es un valor legítimo. */
function DeslizadorPorcentaje(
  valor: typeof powerSaveThreshold,
  fijar: (v: number) => void,
  minimo = 0,
): Gtk.Scale {
  const adj = new Gtk.Adjustment({ lower: minimo, upper: 100, stepIncrement: 1, pageIncrement: 5 })
  adj.value = valor.get()
  onCleanup(valor.subscribe(() => {
    if (adj.value !== valor.get()) adj.value = valor.get()
  }))
  const scale = new Gtk.Scale({ orientation: Gtk.Orientation.HORIZONTAL, adjustment: adj, drawValue: false, hexpand: true })
  scale.cssClasses = ["qs-slider", "brightness"]
  conectarCambioDeslizador(scale, fijar)
  return scale
}

function Segmentado({ options, current, onSelect, disabled }: {
  options: { value: string, label: string }[]
  current: any
  onSelect: (v: string) => void
  disabled?: any
}) {
  return (
    <box cssClasses={["dl-seg"]} valign={Gtk.Align.CENTER}>
      {options.map((o) => (
        <button
          sensitive={disabled ? disabled((d: boolean) => !d) : true}
          cssClasses={current((c: string) => c === o.value ? ["dl-seg-btn", "active"] : ["dl-seg-btn"])}
          onClicked={() => onSelect(o.value)}
        ><label label={o.label} /></button>
      ))}
    </box>
  )
}

const etiquetaAccion = (accion: AccionBotonEncendido) =>
  (textos.botonEncendido.opciones as Record<string, string>)[accion] ?? accion

/**
 * Qué hace el botón de encendido físico. El shell solo guarda la elección: quien la
 * ejecuta es `GiGiOS.boton_apagado()` (`hypr/gigios/boton-apagado.lua`) desde un bind
 * `{locked = true}` de Hyprland, así que
 * el botón sigue respondiendo con AGS caído o la sesión bloqueada.
 *
 * El aviso no sobra: systemd-logind maneja esa tecla por su cuenta y de fábrica
 * apaga el equipo, tapando la acción elegida SIN dar ningún error. Solo se enseña
 * cuando la elección de verdad no puede cumplirse — con "Apagar el equipo" el
 * resultado es el mismo venga de quien venga, así que ahí callar es lo correcto.
 */
function TarjetaBotonEncendido() {
  comprobarBotonEncendido()
  const avisoVisible = createComputed(() =>
    teclaCedidaAHyprland() === false && botonApagado() !== "apagar"
  )

  return (
    <TarjetaAjustes titulo={textos.grupos.botonEncendido} icono="󰐥">
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["dev-row"]} hexpand>
        <TituloAjuste label={textos.botonEncendido.titulo} halign={Gtk.Align.START} />
        <box cssClasses={["sp-field"]} widthRequest={320} hexpand={false} halign={Gtk.Align.START}>
          <DisplaySelect
            current={botonApagado((accion) => etiquetaAccion(accion))}
            options={botonApagado((actual) => ACCIONES_BOTON_ENCENDIDO.map((accion) => ({
              label: etiquetaAccion(accion), value: accion, active: accion === actual,
            })))}
            onSelect={(valor) => setBotonApagado(valor as AccionBotonEncendido)}
          />
        </box>
        <TextoInformativo label={textos.botonEncendido.descripcion} halign={Gtk.Align.START} wrap />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} visible={avisoVisible}>
          <TextoInformativo
            label={textos.botonEncendido.aviso}
            cssClasses={["sp-field-hint-warn"]}
            halign={Gtk.Align.START} wrap
          />
          <TextoInformativo
            label={textos.botonEncendido.avisoComando}
            cssClasses={["sp-field-hint-command"]}
            halign={Gtk.Align.START} wrap selectable
          />
        </box>
      </box>
    </TarjetaAjustes>
  )
}

export default function SeccionEnergia() {
  const summaryClass = powerSaveActive((active) =>
    active ? ["sp-energy-summary", "active"] : ["sp-energy-summary"]
  )
  const modeClass = powerSaveActive((active) =>
    active ? ["sp-energy-mode", "active"] : ["sp-energy-mode"]
  )

  // El overlay es el ancla que DisplaySelect busca para desplegar su lista sin
  // crear otra superficie (ver servicios/pantalla/controls.tsx).
  return (
    <overlay cssClasses={["display-select-host"]}>
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
          {DeslizadorPorcentaje(powerSaveThreshold, setPowerSaveThreshold) as unknown as any}
          <TextoInformativo label={textos.umbral.descripcion} halign={Gtk.Align.START} wrap />
        </box>
        <AjusteInterruptor titulo={textos.forzar.titulo} informacion={textos.forzar.descripcion} activo={forcePowerSave} alAlternar={() => setForcePowerSave(!forcePowerSave.get())} />
      </TarjetaAjustes>

      {tlpAvailable && (
        <TarjetaAjustes titulo={textos.grupos.tlp} icono="󰂎">
          <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["dev-row"]} hexpand>
            <box spacing={8} valign={Gtk.Align.CENTER}>
              <TituloAjuste label={textos.tlp.titulo} hexpand halign={Gtk.Align.START} />
              <Segmentado
                current={tlpMode}
                disabled={tlpBusy}
                onSelect={(v) => setTlpMode(v as any)}
                options={[
                  { value: "normal", label: textos.tlp.normal },
                  { value: "ahorro", label: textos.tlp.ahorro },
                ]}
              />
            </box>
            <TextoInformativo
              label={tlpBusy((b) => b ? textos.tlp.aplicando : textos.tlp.descripcion)}
              halign={Gtk.Align.START} wrap
            />
          </box>
          <AjusteInterruptor
            titulo={textos.tlp.automatico.titulo}
            informacion={textos.tlp.automatico.descripcion}
            activo={tlpAutoInPowerSave}
            alAlternar={() => setTlpAutoInPowerSave(!tlpAutoInPowerSave.get())}
          />
        </TarjetaAjustes>
      )}

      {/* Brillo. La tarjeta se pinta SIEMPRE, también sin backend de brillo: ocultarla
          dejaría el ajuste indescubrible y sin nada que explicara la ausencia — el mismo
          criterio que la tarjeta de firmas de ClamAV. Lo que se oculta es el deslizador,
          que sin backend escribiría en el vacío, y en su sitio queda el porqué. */}
      <TarjetaAjustes titulo={textos.grupos.brilloAhorro} icono="󰃞">
        <AjusteInterruptor
          titulo={textos.brillo.titulo}
          informacion={textos.brillo.descripcion}
          activo={reduceBrightnessInPowerSave}
          alAlternar={() => setReduceBrightnessInPowerSave(!reduceBrightnessInPowerSave.get())}
        />
        <box
          orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["dev-row"]} hexpand
          visible={createComputed(() => reduceBrightnessInPowerSave() && brightnessSupported())}
        >
          <box spacing={8} valign={Gtk.Align.CENTER}>
            <TituloAjuste label={textos.brillo.nivel} hexpand halign={Gtk.Align.START} />
            <InlineEditableValue
              display={powerSaveBrightnessPct((v) => `${Math.round(v)} %`)}
              getValue={() => powerSaveBrightnessPct.get()}
              onCommit={setPowerSaveBrightnessPct}
              min={5} max={100}
              labelClass="sp-field-value"
              tooltip={textos.brillo.tooltip}
            />
          </box>
          {DeslizadorPorcentaje(powerSaveBrightnessPct, setPowerSaveBrightnessPct, 5) as unknown as any}
        </box>
        <box cssClasses={["dev-row"]} visible={brightnessSupported((s) => !s)}>
          <TextoInformativo
            label={textos.brillo.sinSoporte}
            cssClasses={["sp-field-hint-warn"]}
            halign={Gtk.Align.START} wrap
          />
        </box>
      </TarjetaAjustes>

      <TarjetaBotonEncendido />

      <Inactividad />

      <InactividadAhorro />

      <TarjetaAjustes titulo={textos.grupos.modoAhorro} icono="󰌪">
        <AjusteInterruptor titulo={textos.notificaciones.titulo} informacion={textos.notificaciones.descripcion} activo={suspendNotifFilters} alAlternar={() => setSuspendNotifFilters(!suspendNotifFilters.get())} />
        <AjusteInterruptor titulo={textos.vistasPrevias.titulo} informacion={textos.vistasPrevias.descripcion} activo={pauseWsPreviewInPowerSave} alAlternar={() => setPauseWsPreviewInPowerSave(!pauseWsPreviewInPowerSave.get())} />
        <AjusteInterruptor titulo={textos.procesosFondo.titulo} informacion={textos.procesosFondo.descripcion} activo={freezeBackgroundInPowerSave} alAlternar={() => setFreezeBackgroundInPowerSave(!freezeBackgroundInPowerSave.get())} />
        <AjusteInterruptor titulo={textos.spotify.titulo} informacion={textos.spotify.descripcion} activo={hideSpotifyBarInPowerSave} alAlternar={() => setHideSpotifyBarInPowerSave(!hideSpotifyBarInPowerSave.get())} />
        <AjusteInterruptor titulo={textos.ondaSpotify.titulo} informacion={textos.ondaSpotify.descripcion} activo={fallbackWaveInPowerSave} alAlternar={() => setFallbackWaveInPowerSave(!fallbackWaveInPowerSave.get())} />
        <AjusteInterruptor titulo={textos.mascota.titulo} informacion={textos.mascota.descripcion} activo={hideMascotaInPowerSave} alAlternar={() => setHideMascotaInPowerSave(!hideMascotaInPowerSave.get())} />
        <AjusteInterruptor titulo={textos.transparencia.titulo} informacion={textos.transparencia.descripcion} activo={opaquePanelsInPowerSave} alAlternar={() => setOpaquePanelsInPowerSave(!opaquePanelsInPowerSave.get())} />
      </TarjetaAjustes>

    </box>
    </overlay>
  )
}
