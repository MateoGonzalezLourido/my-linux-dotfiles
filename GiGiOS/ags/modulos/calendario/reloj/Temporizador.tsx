import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { onCleanup } from "ags"
import {
  cancelarTemporizador,
  continuarTemporizador,
  fijarDuracionTemporizador,
  iniciarTemporizador,
  pausarTemporizador,
  temporizador,
} from "./estadoReloj.ts"
import { formatearRestante, msHastaSiguienteTick, restanteTemporizador } from "./tiempos.ts"
import type { Visible } from "./visible.ts"

const PRESETS_MIN = [1, 5, 10, 15, 30, 60]

/**
 * Temporizador.
 *
 * **El vencimiento y el repintado son cosas distintas.** Quien avisa es el temporizador de
 * `estadoReloj.ts`, armado contra un instante absoluto y vivo aunque el panel esté cerrado; lo de
 * aquí solo redibuja la cuenta atrás, y únicamente mientras la sección se ve. Cerrar el panel a
 * mitad de una cuenta de veinte minutos no la para: para el dibujo.
 *
 * El tick se realinea con `msHastaSiguienteTick` en vez de repetir cada 1000 ms desde un origen
 * arbitrario. Con un intervalo fijo, la cifra cambia a destiempo respecto al segundo real y se ve
 * saltar dos unidades cada minuto.
 */
export function Temporizador({ visible }: { visible: Visible }): Gtk.Widget {
  const display = new Gtk.Label({ label: "00:00" })
  display.set_css_classes(["reloj-temporizador-display"])

  const botonPrincipal = new Gtk.Button()
  botonPrincipal.set_css_classes(["cal-btn", "primario"])
  const etiquetaPrincipal = new Gtk.Label({ label: "Iniciar" })
  botonPrincipal.set_child(etiquetaPrincipal)

  const botonCancelar = new Gtk.Button()
  botonCancelar.set_css_classes(["cal-btn"])
  botonCancelar.set_child(new Gtk.Label({ label: "Cancelar" }))

  const filaPresets = new Gtk.Grid()
  filaPresets.set_css_classes(["reloj-presets"])
  filaPresets.set_column_homogeneous(true)
  filaPresets.set_column_spacing(4)
  filaPresets.set_row_spacing(4)
  PRESETS_MIN.forEach((minutos, indice) => {
    const boton = new Gtk.Button()
    boton.set_css_classes(["reloj-preset"])
    boton.set_child(new Gtk.Label({ label: `${minutos} min` }))
    boton.set_hexpand(true)
    boton.connect("clicked", () => fijarDuracionTemporizador(minutos * 60_000))
    filaPresets.attach(boton, indice % 3, Math.floor(indice / 3), 1, 1)
  })

  let tick: number | null = null

  const pintar = () =>
    display.set_label(formatearRestante(restanteTemporizador(temporizador.get(), Date.now())))

  function pararTick() {
    if (tick !== null) {
      GLib.source_remove(tick)
      tick = null
    }
  }

  function programarTick() {
    pararTick()
    const restante = restanteTemporizador(temporizador.get(), Date.now())
    tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, msHastaSiguienteTick(restante), () => {
      tick = null
      pintar()
      if (temporizador.get().estado === "corriendo" && visible.get()) programarTick()
      return GLib.SOURCE_REMOVE
    })
  }

  function sincronizar() {
    const t = temporizador.get()
    etiquetaPrincipal.set_label(
      t.estado === "corriendo" ? "Pausar" : t.estado === "pausado" ? "Continuar" : "Iniciar",
    )
    botonCancelar.set_sensitive(t.estado !== "parado")
    // Los presets solo se ofrecen con el temporizador parado: cambiar la duración a mitad de cuenta
    // no altera la cuenta en marcha (ver `fijarDuracion`), así que pulsarlos parecería no hacer nada.
    filaPresets.set_sensitive(t.estado === "parado")
    botonPrincipal.set_sensitive(t.estado !== "parado" || t.duracionMs > 0)

    pintar()
    if (t.estado === "corriendo" && visible.get()) programarTick()
    else pararTick()
  }

  botonPrincipal.connect("clicked", () => {
    const estado = temporizador.get().estado
    if (estado === "corriendo") pausarTemporizador()
    else if (estado === "pausado") continuarTemporizador()
    else iniciarTemporizador()
  })
  botonCancelar.connect("clicked", () => cancelarTemporizador())

  const bajas = [temporizador.subscribe(sincronizar), visible.subscribe(sincronizar)]
  onCleanup(() => {
    pararTick()
    for (const baja of bajas) if (typeof baja === "function") baja()
  })
  sincronizar()

  return (
    <box cssClasses={["reloj-tarjeta", "reloj-herramienta"]} orientation={Gtk.Orientation.VERTICAL} spacing={7} hexpand>
      <box spacing={6}>
        <label cssClasses={["reloj-tarjeta-icono"]} label="󰔛" />
        <label cssClasses={["reloj-tarjeta-titulo"]} label="Temporizador" halign={Gtk.Align.START} />
      </box>
      {display}
      {filaPresets}
      <box spacing={6} homogeneous>
        {botonPrincipal}
        {botonCancelar}
      </box>
    </box>
  ) as unknown as Gtk.Widget
}
