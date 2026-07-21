import { createComputed } from "ags"
import { Gtk } from "ags/gtk4"
import {
  mantenerDespiertoActivo,
  mantenerPantallaActiva,
  tiempoRestanteMantenerDespierto,
} from "../../../servicios/energia/mantenerDespierto"
import { textoTooltipMantenerDespierto } from "../../../servicios/energia/tiempoMantenerDespierto"

export default function IndicadorMantenerDespierto() {
  const tooltip = createComputed(
    [tiempoRestanteMantenerDespierto, mantenerPantallaActiva],
    (restante: number | null, pantallaActiva: boolean) =>
      textoTooltipMantenerDespierto(restante, pantallaActiva),
  )

  return (
    <box
      visible={mantenerDespiertoActivo}
      valign={Gtk.Align.CENTER}
      cssClasses={["wakeup-indicator"]}
      tooltipText={tooltip}
    >
      <label label="󰅶" />
    </box>
  )
}
