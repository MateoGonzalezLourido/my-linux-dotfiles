import { Gtk } from "ags/gtk4"
import { onCleanup } from "ags"
import { calendarVisible } from "../../../estado/shell"
import { hayCuentaConfigurada } from "./autenticacion.ts"
import { estadoSync, sincronizar, textoEstado } from "./sincronizacion.ts"

/**
 * Chip de estado de Google en la cabecera del panel.
 *
 * **Sin cuenta configurada no desaparece, informa.** Un panel que no menciona Google por ningún
 * lado deja al usuario sin saber que la integración existe ni cómo activarla; el tooltip nombra el
 * script que hay que ejecutar una vez.
 *
 * Al abrirse el panel se dispara una sincronización. Es el único disparador automático: no hay
 * sondeo, así que este es el momento en que el calendario se pone al día.
 */
export function EstadoGoogle(): Gtk.Widget {
  const etiqueta = new Gtk.Label({ label: "" })
  etiqueta.set_css_classes(["cal-google-chip"])

  const boton = new Gtk.Button()
  boton.set_css_classes(["cal-icon-btn"])
  boton.set_child(etiqueta)
  boton.connect("clicked", () => {
    if (hayCuentaConfigurada()) void sincronizar({ forzarCompleta: false })
  })

  function pintar() {
    const estado = estadoSync.get()
    etiqueta.set_label(
      estado.fase === "sincronizando" ? "󰑓  Sincronizando"
        : estado.fase === "sin-configurar" ? "󰃭  Google"
        : estado.fase === "sin-conexion" ? "󰤭  Sin conexión"
        : estado.fase === "error" ? "󰀪  Google"
        : "󰄬  Google",
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

  const bajas = [
    estadoSync.subscribe(pintar),
    // Abrir el panel sincroniza; cerrarlo no cancela nada, la pasada en curso termina sola.
    calendarVisible.subscribe(() => {
      if (calendarVisible.get() && hayCuentaConfigurada()) void sincronizar()
    }),
  ]
  onCleanup(() => {
    for (const baja of bajas) if (typeof baja === "function") baja()
  })
  pintar()

  return boton as unknown as Gtk.Widget
}
