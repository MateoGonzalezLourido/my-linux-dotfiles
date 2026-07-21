import GLib from "gi://GLib"
import { createState, createEffect } from "ags"
import { Gtk } from "ags/gtk4"
import { toggleCalendar } from "../../estado/shell.tsx";
import { timeFormat, formatClock } from "../ajustes/preferences"
import { ticReloj } from "../../servicios/sistema/reloj"
import { crearCicloVida } from "../../utilidades/cicloVida"
import type { EstadoVisibilidadBarra } from "./visibilidad"

export default function Clock({ visibilidad }: { visibilidad: EstadoVisibilidadBarra }) {
  const cicloVida = crearCicloVida()
  let ultimoTiempoRenderizado = formatClock()
  const [hora, establecerHora] = createState(ultimoTiempoRenderizado)
  const [cronometro, establecerCronometro] = createState(0)
  const [cronometroActivo, establecerCronometroActivo] = createState(false)
  let intervaloCronometro: number | null = null
  let inicioCronometro = 0
  const formatearReloj = () => formatClock()
  // Repinta al instante cuando el usuario cambia el formato en Ajustes > Región, fecha y hora.
  cicloVida.suscribir(timeFormat, () => establecerHora(formatearReloj()))
  cicloVida.suscribir(ticReloj, () => establecerHora(formatearReloj()))

  function formatearCronometro(segundos: number) {
    const horas = Math.floor(segundos / 3600)
    const minutos = Math.floor((segundos % 3600) / 60)
    const segundosRestantes = segundos % 60
    return horas > 0
      ? `${horas}:${String(minutos).padStart(2, "0")}:${String(segundosRestantes).padStart(2, "0")}`
      : `${String(minutos).padStart(2, "0")}:${String(segundosRestantes).padStart(2, "0")}`
  }

  function actualizarCronometro() {
    const transcurrido = Date.now() - inicioCronometro
    establecerCronometro(Math.round(transcurrido / 1000))
    const siguiente = 1000 - (transcurrido % 1000)
    intervaloCronometro = GLib.timeout_add(GLib.PRIORITY_HIGH, siguiente, () => {
      actualizarCronometro()
      return GLib.SOURCE_REMOVE
    })
  }

  function iniciarCronometro() {
    inicioCronometro = Date.now()
    establecerCronometro(0)
    establecerCronometroActivo(true)
    actualizarCronometro()
  }

  function detenerCronometro() {
    if (intervaloCronometro !== null) {
      GLib.source_remove(intervaloCronometro)
      intervaloCronometro = null
    }
    inicioCronometro = 0
    establecerCronometroActivo(false)
    establecerCronometro(0)
  }

  let wasVisible = visibilidad.refrescar()

  // Única dependencia del efecto: el refresco local de esta barra. El resto
  // se lee con .get() para no re-ejecutar el efecto en cada tick.
  createEffect(() => {
    const visible = visibilidad.refrescar()
    if (visible && !wasVisible) {
      // Al mostrarse: si el cronómetro corría, reanudar sus ticks por segundo.
      if (cronometroActivo.get()) {
        if (intervaloCronometro !== null) { GLib.source_remove(intervaloCronometro); intervaloCronometro = null }
        actualizarCronometro()
      }
    } else if (!visible && wasVisible) {
      // Al ocultarse: congelar la etiqueta en lo que se muestra AHORA (antes se
      // cacheaba al mostrarse, quedando hasta 1 min desfasado durante el ocultado)
      // y parar el tick por segundo del cronómetro.
      ultimoTiempoRenderizado = cronometroActivo.get() ? formatearCronometro(cronometro.get()) : hora.get()
      if (intervaloCronometro !== null) { GLib.source_remove(intervaloCronometro); intervaloCronometro = null }
    }
    wasVisible = visible
  })
  cicloVida.registrar(detenerCronometro)
  return (
    <button
      valign={Gtk.Align.CENTER}
      cssClasses={["bar-pill-btn"]}
    >
      <box
        cssClasses={cronometroActivo((activo) => activo ? ["bar-pill", "clock", "clock-pill", "stopwatch"] : ["bar-pill", "clock", "clock-pill"])}
        valign={Gtk.Align.CENTER}
      >
        <label halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} hexpand label={cronometroActivo((activo) => activo
          ? (visibilidad.visible() ? formatearCronometro(cronometro()) : ultimoTiempoRenderizado)
          : (visibilidad.visible() ? hora() : ultimoTiempoRenderizado)
        )} />
      </box>
      <Gtk.GestureClick
        button={1}
        onPressed={() => toggleCalendar()}
      />
      <Gtk.GestureClick
        button={3}
        onPressed={() => {
          if (cronometroActivo()) {
            detenerCronometro()
          } else {
            iniciarCronometro()
          }
        }}
      />
    </button>
  )
}
