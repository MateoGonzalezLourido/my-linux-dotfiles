import { Gtk } from "ags/gtk4"

const R = 20

export default function CornerCurve({ left }: { left: boolean }): Gtk.DrawingArea {
  const area = new Gtk.DrawingArea()
  area.set_size_request(R, R)
  area.valign = Gtk.Align.END

  area.set_draw_func((_w, cr, _width, _height) => {
    // Paint desktop color — rgba(8,11,16,1) matches the window background
    cr.setSourceRGBA(8 / 255, 11 / 255, 16 / 255, 1)

    if (left) {
      // LEFT corner (placed to the left of the panel): fill upper-right quadrant
      // Center at bottom-left (0, R); arc from 3π/2 (up) to 2π (right)
      // → the dark fill hugs the panel's bottom-left corner, curving outward
      cr.moveTo(0, R)
      cr.arc(0, R, R, 3 * Math.PI / 2, 2 * Math.PI)
      cr.closePath()
    } else {
      // RIGHT corner (placed to the right of the panel): fill upper-left quadrant
      // Center at bottom-right (R, R); arc from π (left) to 3π/2 (up)
      // → symmetric outward curve at panel's bottom-right corner
      cr.moveTo(R, R)
      cr.arc(R, R, R, Math.PI, 3 * Math.PI / 2)
      cr.closePath()
    }

    cr.fill()
  })

  return area
}
