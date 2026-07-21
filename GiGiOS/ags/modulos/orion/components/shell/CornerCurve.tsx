import { Gtk } from "ags/gtk4"

const RADIO = 24

/**
 * Cuña que rellena el hueco entre el panel de Orion y su curva exterior, a
 * cada lado (`left`). Widget propio en vez de CSS `border-radius`: el hueco
 * necesita el color de fondo del shell, no un simple recorte del panel.
 */
export default function CornerCurve({ left = true }: { left?: boolean }): Gtk.DrawingArea {
  const area = new Gtk.DrawingArea()
  area.set_size_request(RADIO, RADIO)
  area.set_valign(Gtk.Align.END)

  area.set_draw_func((_area, cr, width, height) => {
    // Mismo negro casi puro que el resto del shell de Orion.
    cr.setSourceRGBA(8 / 255, 8 / 255, 12 / 255, 0.94)

    if (left) {
      cr.moveTo(width, height)
      cr.lineTo(0, height)
      // Centro en (0, 0).
      cr.arcNegative(0, 0, RADIO, Math.PI / 2, 0)
      cr.lineTo(width, height)
    } else {
      cr.moveTo(0, height)
      cr.lineTo(width, height)
      // Centro en (width, 0).
      cr.arc(width, 0, RADIO, Math.PI / 2, Math.PI)
      cr.lineTo(0, height)
    }

    cr.closePath()
    cr.fill()
  })

  return area
}
