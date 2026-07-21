import GLib from "gi://GLib"
import Pango from "gi://Pango"
import { Gtk } from "ags/gtk4"

const ANCHO_MAXIMO = 260
const ALTO_MAXIMO = 480
const CARACTERES_MAXIMOS_ETIQUETA = 24

interface EstadoLimites {
  ocupado: boolean
  eliminado: boolean
  fuenteIdle: number
  paginas: Gtk.SelectionModel
  idCambioPaginas: number
}

const estados = new WeakMap<Gtk.Popover, EstadoLimites>()

function limitarEtiquetas(widget: Gtk.Widget) {
  if (widget instanceof Gtk.Label) {
    widget.set_max_width_chars(CARACTERES_MAXIMOS_ETIQUETA)
    widget.set_ellipsize(Pango.EllipsizeMode.END)
    widget.set_wrap(false)
  }
  for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
    limitarEtiquetas(child)
  }
}

function aplicarLimites(popover: Gtk.Popover, estado: EstadoLimites) {
  if (estado.eliminado || estado.ocupado) return
  const stack = popover.get_child()
  if (!(stack instanceof Gtk.Stack)) return

  limitarEtiquetas(stack)
  stack.queue_resize()
  const entradas: Array<{ child: Gtk.Widget; name: string | null }> = []
  for (let index = 0; index < estado.paginas.get_n_items(); index++) {
    const pagina = estado.paginas.get_item(index) as Gtk.StackPage | null
    if (!pagina) continue
    const child = pagina.get_child()
    if (!child.has_css_class("tray-menu-scroll")) entradas.push({ child, name: pagina.get_name() })
  }

  estado.ocupado = true
  try {
    for (const { child, name } of entradas) {
      const [, naturalWidth] = child.measure(Gtk.Orientation.HORIZONTAL, -1)
      const width = Math.min(naturalWidth, ANCHO_MAXIMO)
      const [, naturalHeight] = child.measure(Gtk.Orientation.VERTICAL, width)
      const height = Math.min(naturalHeight, ALTO_MAXIMO)

      stack.remove(child)
      const scroll = new Gtk.ScrolledWindow({
        cssClasses: ["tray-menu-scroll"],
        hscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
        vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
        propagateNaturalWidth: true,
        propagateNaturalHeight: true,
        maxContentWidth: ANCHO_MAXIMO,
        maxContentHeight: ALTO_MAXIMO,
        widthRequest: width,
        heightRequest: height,
      })
      scroll.set_child(child)
      if (name) stack.add_named(scroll, name)
      else stack.add_child(scroll)
    }
  } finally {
    estado.ocupado = false
  }
}

/** Configura una vez un Gtk.PopoverMenu remoto y devuelve una limpieza idempotente. */
export function limitarMenuTray(popover: Gtk.Popover): () => void {
  const existente = estados.get(popover)
  if (existente) return () => eliminarLimites(popover, existente)

  const stack = popover.get_child()
  if (!(stack instanceof Gtk.Stack)) return () => {}
  const paginas = stack.get_pages()
  const estado: EstadoLimites = {
    ocupado: false,
    eliminado: false,
    fuenteIdle: 0,
    paginas,
    idCambioPaginas: 0,
  }

  const programar = () => {
    if (estado.eliminado || estado.ocupado || estado.fuenteIdle) return
    estado.fuenteIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      estado.fuenteIdle = 0
      aplicarLimites(popover, estado)
      return GLib.SOURCE_REMOVE
    })
  }
  estado.idCambioPaginas = paginas.connect("items-changed", programar)
  estados.set(popover, estado)
  aplicarLimites(popover, estado)
  programar()
  return () => eliminarLimites(popover, estado)
}

function eliminarLimites(popover: Gtk.Popover, estado: EstadoLimites) {
  if (estado.eliminado) return
  estado.eliminado = true
  if (estado.fuenteIdle) GLib.source_remove(estado.fuenteIdle)
  estado.fuenteIdle = 0
  if (estado.idCambioPaginas) {
    try { estado.paginas.disconnect(estado.idCambioPaginas) } catch (_) {}
  }
  estado.idCambioPaginas = 0
  estados.delete(popover)
}
