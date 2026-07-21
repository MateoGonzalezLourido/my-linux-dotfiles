import { createState, createEffect } from "ags"
import { Gtk } from "ags/gtk4"
import { toggleCalendar } from "../../../../estado/shell.tsx";
import { timeFormat, formatClock } from "../../../ajustes/preferences"
import { ticReloj } from "../../../../servicios/sistema/reloj"
import { crearCicloVida } from "../../../../utilidades/cicloVida"
import type { EstadoVisibilidadBarra } from "../../../../estado/visibilidadBarra"

/**
 * Reloj de la barra. Abre el panel de calendario.
 *
 * **El clic derecho ya no arranca un cronómetro.** Lo hizo durante un tiempo, y era una función
 * invisible: nada en la barra insinuaba que existiera, no había forma de saber si estaba corriendo
 * salvo que el reloj dejara de dar la hora, y pulsar por error donde uno espera un menú
 * contextual sustituía la hora por un contador sin explicación. El cronómetro vive ahora en el
 * panel, pestaña Reloj, junto al temporizador y las alarmas — con botones, estado visible y su
 * medida basada en marcas de tiempo (`modulos/calendario/reloj/`).
 */
export default function Reloj({ visibilidad }: { visibilidad: EstadoVisibilidadBarra }) {
  const cicloVida = crearCicloVida()
  let ultimoTiempoRenderizado = formatClock()
  const [hora, establecerHora] = createState(ultimoTiempoRenderizado)
  const formatearReloj = () => formatClock()
  // Repinta al instante cuando el usuario cambia el formato en Ajustes > Región, fecha y hora.
  cicloVida.suscribir(timeFormat, () => establecerHora(formatearReloj()))
  cicloVida.suscribir(ticReloj, () => establecerHora(formatearReloj()))

  let wasVisible = visibilidad.refrescar()

  // Única dependencia del efecto: el refresco local de esta barra. El resto
  // se lee con .get() para no re-ejecutar el efecto en cada tick.
  createEffect(() => {
    const visible = visibilidad.refrescar()
    if (!visible && wasVisible) {
      // Al ocultarse: congelar la etiqueta en lo que se muestra AHORA (antes se
      // cacheaba al mostrarse, quedando hasta 1 min desfasado durante el ocultado).
      ultimoTiempoRenderizado = hora.get()
    }
    wasVisible = visible
  })

  return (
    <button
      valign={Gtk.Align.CENTER}
      cssClasses={["bar-pill-btn"]}
      tooltipText="Calendario y reloj"
    >
      <box
        cssClasses={["bar-pill", "clock", "clock-pill"]}
        valign={Gtk.Align.CENTER}
      >
        <label
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          hexpand
          label={hora((h) => (visibilidad.visible() ? h : ultimoTiempoRenderizado))}
        />
      </box>
      <Gtk.GestureClick
        button={1}
        onPressed={() => toggleCalendar()}
      />
    </button>
  )
}
