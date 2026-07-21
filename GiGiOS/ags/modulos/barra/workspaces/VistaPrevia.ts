import Gdk from "gi://Gdk"
import GdkPixbuf from "gi://GdkPixbuf"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"

const ANCHO_VISTA_PREVIA = 280
const ALTO_VISTA_PREVIA = 158

function crearVistaPreviaVacia(idEscritorio: number): Gtk.Label {
  const etiqueta = new Gtk.Label({ label: `Escritorio ${idEscritorio}` })
  etiqueta.add_css_class("ws-preview-empty")
  etiqueta.set_halign(Gtk.Align.CENTER)
  etiqueta.set_valign(Gtk.Align.CENTER)
  etiqueta.set_hexpand(true)
  etiqueta.set_vexpand(true)
  return etiqueta
}

function crearContenidoVistaPrevia(idEscritorio: number, ruta: string): Gtk.Box {
  const exterior = new Gtk.Box()
  exterior.add_css_class("ws-preview-bg")
  exterior.set_size_request(ANCHO_VISTA_PREVIA, ALTO_VISTA_PREVIA)

  if (!GLib.file_test(ruta, GLib.FileTest.EXISTS)) {
    exterior.append(crearVistaPreviaVacia(idEscritorio))
    return exterior
  }

  try {
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
      ruta,
      ANCHO_VISTA_PREVIA,
      ALTO_VISTA_PREVIA,
      false,
    )
    const imagen = new Gtk.Picture({
      paintable: Gdk.Texture.new_for_pixbuf(pixbuf),
      width_request: ANCHO_VISTA_PREVIA,
      height_request: ALTO_VISTA_PREVIA,
    })
    exterior.append(imagen)
  } catch (_) {
    exterior.append(crearVistaPreviaVacia(idEscritorio))
  }
  return exterior
}

/** Un único popover por barra, sin referencias compartidas entre monitores. */
export function crearGestorVistaPreviaEscritorios(
  alCambiarVisibilidad: (visible: boolean) => void,
) {
  let popover: Gtk.Popover | null = null
  let ancla: Gtk.Widget | null = null
  let temporizadorCierre: ReturnType<typeof setTimeout> | null = null
  let eliminado = false

  const cancelarCierre = () => {
    if (temporizadorCierre !== null) clearTimeout(temporizadorCierre)
    temporizadorCierre = null
  }

  const cerrar = () => {
    cancelarCierre()
    if (popover) {
      try { popover.popdown() } catch (_) {}
    }
  }

  const alEntrar = () => cancelarCierre()
  const alSalir = () => {
    cancelarCierre()
    temporizadorCierre = setTimeout(cerrar, 250)
  }

  const mostrar = (nuevaAncla: Gtk.Widget, idEscritorio: number, ruta: string) => {
    if (eliminado) return
    if (popover && ancla === nuevaAncla) {
      cerrar()
      return
    }
    cerrar()

    const contenido = crearContenidoVistaPrevia(idEscritorio, ruta)
    const movimiento = new Gtk.EventControllerMotion()
    movimiento.connect("enter", alEntrar)
    movimiento.connect("leave", alSalir)
    contenido.add_controller(movimiento)

    const siguientePopover = new Gtk.Popover({
      has_arrow: false,
      autohide: false,
      position: Gtk.PositionType.TOP,
      child: contenido,
    })
    siguientePopover.add_css_class("ws-preview-popover")
    siguientePopover.set_parent(nuevaAncla)
    popover = siguientePopover
    ancla = nuevaAncla
    alCambiarVisibilidad(true)

    siguientePopover.connect("closed", () => {
      if (popover === siguientePopover) {
        popover = null
        ancla = null
        alCambiarVisibilidad(false)
      }
      try { siguientePopover.unparent() } catch (_) {}
    })
    siguientePopover.popup()
  }

  return {
    mostrar,
    alEntrar,
    alSalir,
    cerrar,
    eliminar: () => {
      eliminado = true
      cerrar()
      alCambiarVisibilidad(false)
      if (popover) {
        try { popover.unparent() } catch (_) {}
        popover = null
        ancla = null
      }
    },
  }
}

export type GestorVistaPreviaEscritorios = ReturnType<typeof crearGestorVistaPreviaEscritorios>
