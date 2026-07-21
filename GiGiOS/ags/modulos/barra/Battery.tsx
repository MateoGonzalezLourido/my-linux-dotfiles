import AstalBattery from "gi://AstalBattery"
import { For } from "ags"
import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import { suscribirPotenciaBateria } from "../../servicios/energia/potenciaBateria"
import { crearCicloVida } from "../../utilidades/cicloVida"
import {
  claseEstadoBateria,
  clasesSegmentosBateria,
  formatearTiempoBateria,
} from "./bateriaDatos"
import type { EstadoVisibilidadBarra } from "./visibilidad"

export default function Battery({ visibilidad }: { visibilidad: EstadoVisibilidadBarra }) {
  const cicloVida = crearCicloVida()
  const bateria = AstalBattery.get_default()
  const porcentaje = () => Math.round((bateria?.percentage ?? 0) * 100)
  const estaCompleta = () => bateria?.state === AstalBattery.State.FULLY_CHARGED

  let potenciaInstantanea: number | null = null

  const crearTooltip = () => {
    if (!bateria) return ""
    let texto = ""
    if (bateria.charging && (bateria.percentage >= 1 || estaCompleta())) {
      texto = "cargado"
    } else if (bateria.charging) {
      texto = bateria.timeToFull > 0
        ? `+ ${formatearTiempoBateria(bateria.timeToFull)}`
        : `+ ${porcentaje()}`
    } else {
      texto = bateria.timeToEmpty > 0
        ? `- ${formatearTiempoBateria(bateria.timeToEmpty)}`
        : `- ${porcentaje()}`
    }
    const vatios = potenciaInstantanea ?? Math.abs(bateria.energyRate)
    if (vatios > 0) texto += `\n${bateria.charging ? "+" : "-"} ${vatios.toFixed(1)}w`
    return texto
  }

  const [presente, establecerPresente] = createState(!!bateria?.isPresent)
  const [clasesCuerpo, establecerClasesCuerpo] = createState([
    "battery-body",
    claseEstadoBateria(porcentaje(), !!bateria?.charging),
  ])
  const [clasesSegmentos, establecerClasesSegmentos] = createState(
    clasesSegmentosBateria(porcentaje(), !!bateria?.charging, estaCompleta()),
  )
  const [tooltip, establecerTooltip] = createState(crearTooltip())

  const sincronizar = () => {
    establecerPresente(!!bateria?.isPresent)
    establecerClasesCuerpo(["battery-body", claseEstadoBateria(porcentaje(), !!bateria?.charging)])
    establecerClasesSegmentos(clasesSegmentosBateria(porcentaje(), !!bateria?.charging, estaCompleta()))
    establecerTooltip(crearTooltip())
  }

  let cancelarPotencia: (() => void) | null = null
  const dejarDeConsumirPotencia = () => {
    cancelarPotencia?.()
    cancelarPotencia = null
  }
  const empezarAConsumirPotencia = () => {
    if (cancelarPotencia || !bateria?.isPresent || !visibilidad.refrescar.get()) return
    cancelarPotencia = suscribirPotenciaBateria((vatios) => {
      potenciaInstantanea = vatios
      establecerTooltip(crearTooltip())
    })
  }
  cicloVida.registrar(dejarDeConsumirPotencia)

  if (bateria) {
    cicloVida.conectarSenales(bateria, [
      "notify::percentage",
      "notify::charging",
      "notify::state",
      "notify::time-to-empty",
      "notify::time-to-full",
      "notify::energy-rate",
      "notify::is-present",
    ], () => {
      sincronizar()
      if (bateria.isPresent) empezarAConsumirPotencia()
      else dejarDeConsumirPotencia()
    })
  }

  cicloVida.suscribir(visibilidad.refrescar, () => {
    if (visibilidad.refrescar.get()) {
      sincronizar()
      empezarAConsumirPotencia()
    } else {
      dejarDeConsumirPotencia()
    }
  })
  if (visibilidad.refrescar.get()) empezarAConsumirPotencia()

  return (
    <box
      visible={presente}
      cssClasses={["battery"]}
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={3}
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      tooltipText={tooltip}
    >
      <box
        cssClasses={clasesCuerpo}
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={1}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        <For each={clasesSegmentos}>
          {(clases) => <box cssClasses={clases} />}
        </For>
      </box>
      <box cssClasses={["battery-cap"]} valign={Gtk.Align.CENTER} />
    </box>
  )
}
