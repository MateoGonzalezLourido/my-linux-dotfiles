import { Gtk } from "ags/gtk4"
import { onCleanup } from "ags"
import { hayCuentaConfigurada } from "./autenticacion.ts"
import { estadoSync, sincronizar, textoEstado } from "./sincronizacion.ts"

/**
 * Chip de estado de Google en la cabecera del panel.
 *
 * **Sin cuenta configurada no desaparece, informa.** Un panel que no menciona Google por ningún
 * lado deja al usuario sin saber que la integración existe ni cómo activarla; el tooltip nombra el
 * script que hay que ejecutar una vez.
 *
 * **El disparo al abrir el panel ya no está aquí**, aunque siga ocurriendo: vive en
 * `sincronizacion.ts`, a nivel de módulo. Este widget se construye una vez por monitor, así que con
 * tres pantallas la suscripción lanzaba tres sincronizaciones y tres lecturas del fichero de
 * credenciales por apertura. Aquí solo queda pintar el estado y el botón de refrescar, que pasa
 * `manual` para saltarse el mínimo entre pasadas automáticas.
 */
export function EstadoGoogle(): Gtk.Widget {
  const etiqueta = new Gtk.Label({ label: "" })
  etiqueta.set_css_classes(["cal-google-chip"])

  const boton = new Gtk.Button()
  boton.set_css_classes(["cal-icon-btn"])
  boton.set_child(etiqueta)
  boton.connect("clicked", () => {
    if (hayCuentaConfigurada()) void sincronizar({ manual: true })
  })

  function pintar() {
    const estado = estadoSync.get()
    etiqueta.set_label(
      estado.fase === "sincronizando" ? "󰑓"
        : estado.fase === "sin-configurar" ? "󰃭"
        : estado.fase === "sin-conexion" ? "󰤭"
        : estado.fase === "error" ? "󰀪"
        : "󰄬",
    )
    boton.set_tooltip_text(
      estado.fase === "sin-configurar"
        ? "Google Calendar no está conectado.\nEjecuta una vez: ags/scripts/google-calendar-auth.sh"
        : `${textoEstado(estado)}\nPulsa para actualizar`,
    )
    boton.set_css_classes(
      estado.fase === "error" || estado.fase === "sin-conexion"
        ? ["cal-icon-btn", "aviso"]
        : ["cal-icon-btn"],
    )
  }

  const baja = estadoSync.subscribe(pintar)
  onCleanup(() => {
    if (typeof baja === "function") baja()
  })
  pintar()

  return boton as unknown as Gtk.Widget
}
