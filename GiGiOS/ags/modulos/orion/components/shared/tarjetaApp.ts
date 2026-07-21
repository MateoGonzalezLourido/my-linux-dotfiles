// Icono y "tarjeta" de app (icono + nombre a dos líneas) que Apps, Inicio, el
// panel derecho y la búsqueda reactiva pintaban cada uno por su cuenta con el
// mismo árbol de widgets y las mismas clases CSS.

import { Gtk } from "ags/gtk4"
import Pango from "gi://Pango"
import type Gio from "gi://Gio"

/**
 * Icono de una app: prioriza el `Gio.Icon` nativo (resuelve tema e
 * ilustraciones embebidas correctamente) y cae al nombre de icono simbólico
 * cuando no hay uno.
 */
export function crearIconoApp(
  gicon: Gio.Icon | null | undefined,
  iconName: string,
  size: number,
): Gtk.Image {
  if (gicon) {
    const imagen = Gtk.Image.new_from_gicon(gicon)
    imagen.pixel_size = size
    return imagen
  }
  return new Gtk.Image({ iconName, pixelSize: size })
}

/**
 * Rellena `boton` con el mosaico estándar de Orion: icono centrado + nombre
 * envuelto a dos líneas. Usado por la rejilla de "Todas las apps" y por los
 * favoritos de Inicio — antes duplicaban este árbol de widgets al detalle.
 */
export function construirTileApp(boton: Gtk.Button, icono: Gtk.Widget, nombre: string): void {
  const inner = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: ["apps-tile-inner"],
    spacing: 6,
    halign: Gtk.Align.CENTER,
  })
  const iconBox = new Gtk.Box({
    cssClasses: ["apps-tile-icon"],
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  })
  iconBox.append(icono)
  inner.append(iconBox)
  inner.append(new Gtk.Label({
    label: nombre,
    cssClasses: ["apps-tile-label"],
    wrap: true,
    wrapMode: Pango.WrapMode.WORD_CHAR,
    lines: 2,
    ellipsize: Pango.EllipsizeMode.END,
    maxWidthChars: 12,
    halign: Gtk.Align.CENTER,
    justify: Gtk.Justification.CENTER,
    xalign: 0.5,
  }))
  boton.set_child(inner)
}
