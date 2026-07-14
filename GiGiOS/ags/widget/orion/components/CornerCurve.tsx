import { Gtk } from "ags/gtk4"

export default function CornerCurve({ left = true }: { left?: boolean }) {
  const radius = 24

  const da = new Gtk.DrawingArea()
  da.set_size_request(radius, radius)
  da.set_valign(Gtk.Align.END)
  
  da.set_draw_func((_area, cr, width, height) => {
    // Keep the outward foot visually continuous with the Orion shell.
    cr.setSourceRGBA(8 / 255, 8 / 255, 12 / 255, 0.92)

    if (left) {
      cr.moveTo(width, height)
      cr.lineTo(0, height)
      // center is at (0, 0)
      cr.arcNegative(0, 0, radius, Math.PI / 2, 0)
      cr.lineTo(width, height)
    } else {
      cr.moveTo(0, height)
      cr.lineTo(width, height)
      // center is at (width, 0)
      cr.arc(width, 0, radius, Math.PI / 2, Math.PI)
      cr.lineTo(0, height)
    }
    
    cr.closePath()
    cr.fill()
  })

  // To make it usable in JSX, we can wrap it or just return the widget.
  // We return the DrawingArea as a Gtk.Widget.
  return da as unknown as JSX.Element
}
