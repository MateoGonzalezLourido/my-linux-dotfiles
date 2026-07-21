import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { onCleanup } from "ags"
import { cronometro, iniciarCronometro, pausarCronometro, reiniciarCronometro } from "./estadoReloj.ts"
import { formatearCronometro, transcurrido } from "./tiempos.ts"
import type { Visible } from "./visible.ts"

/**
 * Cronómetro.
 *
 * **El tick es solo presentación.** La medida sale de `transcurrido()` contra `Date.now()`, así que
 * el widget puede dejar de pintarse durante horas —sección oculta, panel cerrado, equipo
 * suspendido— y al volver enseña la cifra exacta. Por eso el tick se puede parar sin consecuencias,
 * y de hecho se para en cuanto la sección Reloj deja de verse: es el requisito de «ningún tick
 * visual con el panel oculto».
 *
 * Refresca a 10 Hz porque enseña décimas. Sin ellas bastaría 1 Hz, pero un cronómetro sin décimas
 * es un reloj.
 */
export function Cronometro({ visible }: { visible: Visible }): Gtk.Widget {
  const etiqueta = new Gtk.Label({ label: formatearCronometro(0) })
  etiqueta.set_css_classes(["reloj-crono-display"])

  const botonPrincipal = new Gtk.Button()
  botonPrincipal.set_css_classes(["cal-btn", "primario"])
  const etiquetaPrincipal = new Gtk.Label({ label: "Iniciar" })
  botonPrincipal.set_child(etiquetaPrincipal)

  const botonReiniciar = new Gtk.Button()
  botonReiniciar.set_css_classes(["cal-btn"])
  botonReiniciar.set_child(new Gtk.Label({ label: "Reiniciar" }))
  botonReiniciar.set_sensitive(false)

  let tick: number | null = null

  const pintar = () =>
    etiqueta.set_label(formatearCronometro(transcurrido(cronometro.get(), Date.now())))

  function pararTick() {
    if (tick !== null) {
      GLib.source_remove(tick)
      tick = null
    }
  }

  function sincronizar() {
    const estado = cronometro.get().estado
    etiquetaPrincipal.set_label(
      estado === "corriendo" ? "Pausar" : estado === "pausado" ? "Continuar" : "Iniciar",
    )
    botonReiniciar.set_sensitive(transcurrido(cronometro.get(), Date.now()) > 0)

    if (estado === "corriendo" && visible.get()) {
      if (tick === null) {
        tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
          pintar()
          return GLib.SOURCE_CONTINUE
        })
      }
    } else {
      pararTick()
    }
    // Se pinta siempre, también al ocultarse: así la etiqueta queda congelada en el valor real de
    // este instante y no en el del último tick que llegó a ejecutarse.
    pintar()
  }

  botonPrincipal.connect("clicked", () => {
    if (cronometro.get().estado === "corriendo") pausarCronometro()
    else iniciarCronometro()
  })
  botonReiniciar.connect("clicked", () => reiniciarCronometro())

  const bajas = [cronometro.subscribe(sincronizar), visible.subscribe(sincronizar)]
  onCleanup(() => {
    pararTick()
    for (const baja of bajas) if (typeof baja === "function") baja()
  })
  sincronizar()

  return (
    <box cssClasses={["reloj-tarjeta"]} orientation={Gtk.Orientation.VERTICAL} spacing={10}>
      <label cssClasses={["reloj-tarjeta-titulo"]} label="Cronómetro" halign={Gtk.Align.START} />
      {etiqueta}
      <box spacing={8} halign={Gtk.Align.CENTER}>
        {botonPrincipal}
        {botonReiniciar}
      </box>
    </box>
  ) as unknown as Gtk.Widget
}
