import { Gtk } from "ags/gtk4"
import { TarjetaAjustes, TextoInformativo, TituloSeccion } from "../componentes"
import OpcionDaltonismo from "./OpcionDaltonismo"
import textos from "../../../textos/ajustes/accesibilidad.json" with { type: "json" }

/** Correcciones visuales que Hyprland aplica sobre la composición completa. */
export default function SeccionAccesibilidad() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
      <TituloSeccion titulo={textos.seccion.titulo} />
      <TarjetaAjustes titulo={textos.grupos.daltonismo} icono="󰦧">
        <box cssClasses={["dev-row"]}>
          <TextoInformativo
            label={textos.daltonismo.descripcion}
            wrap
            xalign={0}
            maxWidthChars={72}
          />
        </box>
        <OpcionDaltonismo modo="protanopia" {...textos.modos.protanopia} />
        <OpcionDaltonismo modo="deuteranopia" {...textos.modos.deuteranopia} />
        <OpcionDaltonismo modo="tritanopia" {...textos.modos.tritanopia} />
      </TarjetaAjustes>
    </box>
  )
}
