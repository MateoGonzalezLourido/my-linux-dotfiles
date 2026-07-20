import { Gtk } from "ags/gtk4"
import { AjusteInterruptor, TarjetaAjustes, TituloSeccion } from "./componentes"
import { gamingFreezeEnabled, setGamingFreezeEnabled } from "./preferences"
import textos from "../../textos/ajustes/juegos.json" with { type: "json" }

/** Preferencias generales que cambian el comportamiento del sistema al jugar. */
export default function JuegosSection() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
      <TituloSeccion titulo={textos.seccion.titulo} />
      <TarjetaAjustes titulo={textos.grupos.rendimiento} icono="󰊴">
        <AjusteInterruptor
          titulo={textos.congelarTareas.titulo}
          informacion={textos.congelarTareas.descripcion}
          activo={gamingFreezeEnabled}
          alAlternar={() => setGamingFreezeEnabled(!gamingFreezeEnabled.get())}
        />
      </TarjetaAjustes>
    </box>
  )
}
