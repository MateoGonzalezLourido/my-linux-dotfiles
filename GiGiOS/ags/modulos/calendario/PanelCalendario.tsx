import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createComputed, createState, onCleanup } from "ags"
import { calendarVisible, setCalendarVisible, panelAutoClose } from "../../estado/shell"
import { barTopMargin, clasesFondoShell } from "../ajustes/preferences"
import { clipWindowInputToContent } from "../../utilidades/inputRegion.ts"
import { VistaMes } from "./calendario/VistaMes.tsx"
import { AgendaDia } from "./calendario/AgendaDia.tsx"
import { FormularioEvento } from "./calendario/FormularioEvento.tsx"
import { VistaReloj } from "./reloj/VistaReloj.tsx"
import { EstadoGoogle } from "./google/EstadoGoogle.tsx"
import {
  cerrarEdicion,
  edicion,
  establecerSeccionActiva,
  seccionActiva,
} from "./estado.ts"

/**
 * Panel lateral de calendario y reloj.
 *
 * **Las dos secciones se construyen una sola vez y se conmutan con un `Gtk.Stack`**, no se montan y
 * desmontan. Son baratas y sin estado de disco, y así cambiar de pestaña no pierde el mes que
 * estabas mirando ni reinicia la cuenta atrás visible. Lo que sí se apaga al ocultarse son los
 * *ticks*: cada widget del reloj cuelga del `relojVisible` que se calcula aquí, así que con el panel
 * cerrado —o en la pestaña Calendario— no queda ni un temporizador de repintado vivo.
 *
 * El editor de eventos, en cambio, sí se monta y desmonta: tiene estado propio y widgets con foco.
 */
export default function PanelCalendario(gdkmonitor: Gdk.Monitor) {
  const { LEFT, TOP, BOTTOM } = Astal.WindowAnchor

  const vistaMes = VistaMes()
  const agenda = AgendaDia()
  vistaMes.set_hexpand(true)
  agenda.set_hexpand(true)
  agenda.set_vexpand(true)

  const relojVisible = createComputed(() => calendarVisible() && seccionActiva() === "reloj")
  const vistaReloj = VistaReloj({ visible: relojVisible })

  const pila = new Gtk.Stack()
  pila.set_hexpand(true)
  pila.set_vexpand(true)
  pila.set_transition_type(Gtk.StackTransitionType.CROSSFADE)
  pila.set_transition_duration(120)

  const vistaCalendario = (
    <box cssClasses={["cal-cuerpo"]} orientation={Gtk.Orientation.VERTICAL} spacing={0} hexpand vexpand>
      {vistaMes}
      {agenda}
    </box>
  ) as unknown as Gtk.Widget

  pila.add_named(vistaCalendario, "calendario")
  pila.add_named(vistaReloj, "reloj")
  pila.set_visible_child_name(seccionActiva.get())

  const botonCalendario = new Gtk.Button()
  const botonReloj = new Gtk.Button()
  const contenidoPestana = (icono: string, texto: string) => {
    const contenido = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER })
    const glifo = new Gtk.Label({ label: icono })
    const etiqueta = new Gtk.Label({ label: texto })
    glifo.set_css_classes(["cal-view-tab-icono"])
    etiqueta.set_css_classes(["cal-view-tab-texto"])
    contenido.append(glifo)
    contenido.append(etiqueta)
    return contenido
  }
  botonCalendario.set_child(contenidoPestana("󰃭", "Calendario"))
  botonReloj.set_child(contenidoPestana("󰥔", "Reloj"))
  botonCalendario.set_valign(Gtk.Align.CENTER)
  botonReloj.set_valign(Gtk.Align.CENTER)
  botonCalendario.connect("clicked", () => establecerSeccionActiva("calendario"))
  botonReloj.connect("clicked", () => establecerSeccionActiva("reloj"))

  function sincronizarPestanas() {
    const activa = seccionActiva.get()
    pila.set_visible_child_name(activa)
    botonCalendario.set_css_classes(activa === "calendario" ? ["cal-view-tab", "active"] : ["cal-view-tab"])
    botonReloj.set_css_classes(activa === "reloj" ? ["cal-view-tab", "active"] : ["cal-view-tab"])
  }
  const bajaPestanas = seccionActiva.subscribe(sincronizarPestanas)
  sincronizarPestanas()

  // ── Editor de eventos (overlay que se monta y desmonta) ───────────────────
  const overlay = new Gtk.Overlay()
  overlay.set_child(pila)

  let formularioVivo: Gtk.Widget | null = null
  // Se observa si HAY edición, no la edición en sí: `edicion` cambia también al parchear el
  // borrador, y reconstruir el formulario en cada tecleo destruiría el widget que tiene el foco.
  const hayEdicion = createComputed(() => edicion() !== null)
  function sincronizarEditor() {
    if (formularioVivo) {
      overlay.remove_overlay(formularioVivo)
      formularioVivo = null
    }
    if (hayEdicion.get()) {
      formularioVivo = FormularioEvento({ altoDisponible: overlay.get_allocated_height() })
      // El fondo oscurecido se estira A MANO: un hijo de `Gtk.Overlay` se mide por su tamaño
      // natural, así que sin esto el velo solo cubría la tarjeta y el resto del panel seguía
      // pareciendo pulsable.
      formularioVivo.set_hexpand(true)
      formularioVivo.set_vexpand(true)
      formularioVivo.set_halign(Gtk.Align.FILL)
      formularioVivo.set_valign(Gtk.Align.FILL)
      overlay.add_overlay(formularioVivo)
    }
  }
  const bajaEdicion = hayEdicion.subscribe(sincronizarEditor)
  // Se llama también al construir: `subscribe` solo avisa de los CAMBIOS, así que un panel montado
  // con una edición ya abierta se quedaría sin editor y sin ninguna señal de por qué.
  sincronizarEditor()

  onCleanup(() => {
    for (const baja of [bajaPestanas, bajaEdicion]) if (typeof baja === "function") baja()
  })

  const calAutoClose = panelAutoClose(() => setCalendarVisible(false), 300, calendarVisible)
  const [tecladoActivo, establecerTecladoActivo] = createState(false)
  calendarVisible.subscribe(() => {
    establecerTecladoActivo(false)
    // Cerrar el panel cancela una edición a medias. Dejarla viva reabriría el formulario con datos
    // de hace media hora encima de lo que el usuario venga a hacer.
    if (!calendarVisible.get()) cerrarEdicion()
  })

  let superficiePanel: Gtk.Widget | null = null
  const ventana = <window
    name="calendar-panel"
    namespace="calendar-panel"
    gdkmonitor={gdkmonitor}
    application={app}
    visible={calendarVisible((v) => v)}
    anchor={LEFT | TOP | BOTTOM}
    layer={Astal.Layer.TOP}
    exclusivity={Astal.Exclusivity.NORMAL}
    keymode={tecladoActivo((activo) => (activo ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE))}
    // Con la barra autoocultable, el compositor no reserva su altura: los 38 px separan este panel
    // de su borde inferior. Con la barra fija, su zona exclusiva ya hace ese trabajo y el helper
    // devuelve 0, evitando sumar el hueco dos veces.
    marginTop={barTopMargin(38)}
    widthRequest={428}
    decorated={false}
    cssClasses={clasesFondoShell("cal-window")}
  >
    <Gtk.EventControllerKey
      onKeyPressed={(_self, keyval) => {
        if (keyval !== Gdk.KEY_Escape) return false
        // Escape cierra primero el editor y solo después el panel: con un único nivel, cancelar un
        // formulario cerraría también el calendario y habría que reabrirlo para seguir.
        if (edicion.get() !== null) cerrarEdicion()
        else setCalendarVisible(false)
        return true
      }}
    />
    <box cssClasses={["cal-wrapper"]} spacing={0} vexpand>
      <box
        cssClasses={["cal-panel", "cal-superficie"]}
        orientation={Gtk.Orientation.VERTICAL}
        overflow={Gtk.Overflow.HIDDEN}
        widthRequest={410}
        vexpand
        $={(self: Gtk.Widget) => { superficiePanel = self }}
      >
        <Gtk.EventControllerMotion
          onEnter={() => {
            calAutoClose.onEnter()
            establecerTecladoActivo(true)
          }}
          onLeave={calAutoClose.onLeave}
        />

        <box cssClasses={["cal-titlebar"]} spacing={5}>
          <box cssClasses={["cal-view-tabs"]} spacing={3} valign={Gtk.Align.CENTER}>
            {botonCalendario}
            {botonReloj}
          </box>
          <box hexpand />
          {EstadoGoogle()}
        </box>

        <box hexpand vexpand>
          {overlay}
        </box>
      </box>
      <box cssClasses={["cal-bar-connector"]} valign={Gtk.Align.START} />
    </box>
  </window>

  // El conector solo pinta su curva superior. El resto de sus 18 px es transparente y debe dejar
  // pasar los clics, igual que en los paneles de Notificaciones y Ajustes rápidos.
  clipWindowInputToContent(ventana, superficiePanel)
  return ventana
}
