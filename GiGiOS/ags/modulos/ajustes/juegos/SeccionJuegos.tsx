import { Gtk } from "ags/gtk4"
import { AjusteInterruptor, TarjetaAjustes, TituloSeccion } from "../componentes"
import { allowTearing, applyAllowTearing } from "../../../servicios/pantalla/service"
import {
  escanerJuegos,
  gamingFreezeEnabled,
  setEscanerJuegos,
  setGamingFreezeEnabled,
} from "../preferences"
import textos from "../../../textos/ajustes/juegos.json" with { type: "json" }

/** Preferencias generales que cambian el comportamiento del sistema al jugar. */
export default function SeccionJuegos() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
      <TituloSeccion titulo={textos.seccion.titulo} />
      <TarjetaAjustes titulo={textos.grupos.deteccion} icono="󰺵">
        <AjusteInterruptor
          titulo={textos.deteccion.titulo}
          informacion={textos.deteccion.descripcion}
          activo={escanerJuegos}
          alAlternar={() => setEscanerJuegos(!escanerJuegos.get())}
        />
      </TarjetaAjustes>
      <TarjetaAjustes titulo={textos.grupos.graficosLatencia} icono="󰹑">
        <AjusteInterruptor
          titulo={textos.tearing.titulo}
          informacion={textos.tearing.descripcion}
          activo={allowTearing}
          alAlternar={() => applyAllowTearing(!allowTearing.get())}
        />
      </TarjetaAjustes>
      {/* Sin escáner no hay "estás jugando" que detectar, así que congelar tareas al
          jugar no puede dispararse nunca: la tarjeta se retira en vez de dejar un
          interruptor que no hace nada. El de tearing sí se queda — es una opción del
          compositor y no depende de que se reconozca la ventana. */}
      <TarjetaAjustes titulo={textos.grupos.rendimiento} icono="󰊴" visible={escanerJuegos}>
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
