// widget/inputRegion.ts
// Clip a layer-shell panel window's INPUT region to a content widget's bounding box.
//
// Each panel is a top-level layer-shell surface whose rectangle is sized to its content. The
// transparent parts of that rectangle — rounded-corner triangles, the bar connector, and the
// margin around the drop shadow — are still part of the surface, so they capture pointer input
// (clicks don't fall through) and can show a faint shadow. Setting the surface input region to
// just the visible panel box makes those empty areas click-through while keeping the look and the
// existing mouse-leave auto-close.
import GLib from "gi://GLib"
import cairo from "gi://cairo"

interface OpcionesRecorteEntrada {
  /** Añade únicamente la silueta pintada de dos curvas laterales pegadas a las
   * esquinas inferiores, sin convertir sus anchos en franjas verticales. */
  radioCurvasInferioresLaterales?: number
}

function anadirCurvasInferioresLaterales(
  region: any,
  rect: { x: number; y: number; width: number; height: number },
  radioSolicitado: number,
): void {
  const radio = Math.max(0, Math.min(Math.floor(radioSolicitado), rect.height))
  if (radio === 0) return

  // Las DrawingArea de Orion pintan el espacio situado debajo de un cuarto de
  // círculo. Una fila por píxel aproxima esa misma silueta en cairo.Region sin
  // conservar el cuadrado transparente que contiene cada curva.
  for (let fila = 0; fila < radio; fila++) {
    const yCentro = fila + 0.5
    const limiteCurva = Math.sqrt(Math.max(0, radio * radio - yCentro * yCentro))
    const inicioPintado = Math.min(radio, Math.ceil(limiteCurva - 0.5))
    const anchoPintado = radio - inicioPintado
    if (anchoPintado <= 0) continue

    const y = rect.y + rect.height - radio + fila
    region.unionRectangle({
      x: rect.x - radio + inicioPintado,
      y,
      width: anchoPintado,
      height: 1,
    })
    region.unionRectangle({
      x: rect.x + rect.width,
      y,
      width: anchoPintado,
      height: 1,
    })
  }
}

// Returns a `reclip` function: call it to re-measure and re-apply the input region. This is
// REQUIRED after any CSS-`transform` entrance animation on `content` (or an ancestor) settles.
// `compute_bounds()` — and, equivalently, summing `get_allocation()` up the tree — reports the
// TRANSFORMED position, so if the region is measured while the slide-in transform is still active
// it freezes offset from where the panel is finally painted, and the whole surface stops receiving
// pointer input (the panel looks "not there"). Re-measuring once the transform is back to identity
// fixes it. Content resizes are handled automatically via the surface size signals below.
export function clipWindowInputToContent(
  win: any,
  content: any,
  opciones: OpcionesRecorteEntrada = {},
): () => void {
  let surfaceHandlers: { surface: any; ids: number[] } | null = null

  const apply = () => {
    try {
      const surface = win.get_surface?.()
      if (!surface || !content) return
      const res = content.compute_bounds(win)
      // gjs returns [ok, Graphene.Rect]
      const ok = Array.isArray(res) ? res[0] : false
      const rect = Array.isArray(res) ? res[1] : null
      if (!ok || !rect) return
      const x = Math.floor(rect.origin.x)
      const y = Math.floor(rect.origin.y)
      const w = Math.ceil(rect.size.width)
      const h = Math.ceil(rect.size.height)
      if (w <= 0 || h <= 0) return
      const region = new (cairo as any).Region()
      region.unionRectangle({ x, y, width: w, height: h })
      if (opciones.radioCurvasInferioresLaterales) {
        anadirCurvasInferioresLaterales(
          region,
          { x, y, width: w, height: h },
          opciones.radioCurvasInferioresLaterales,
        )
      }
      surface.set_input_region(region)
    } catch (e) {
      // If anything is unavailable, fall back silently to the default (full) input region.
      console.error("[inputRegion] clip failed:", e)
    }
  }

  // Defer to an idle tick so the content has been allocated at its final size before we measure.
  const scheduleApply = () => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { apply(); return GLib.SOURCE_REMOVE })
  }

  const hookSurface = () => {
    const surface = win.get_surface?.()
    if (!surface) return
    // Avoid stacking duplicate handlers if the same surface persists across maps.
    if (surfaceHandlers && surfaceHandlers.surface === surface) return
    if (surfaceHandlers) {
      try { for (const id of surfaceHandlers.ids) surfaceHandlers.surface.disconnect(id) } catch (_) {}
    }
    const ids = [
      surface.connect("notify::width", scheduleApply),
      surface.connect("notify::height", scheduleApply),
    ]
    surfaceHandlers = { surface, ids }
  }

  win.connect("map", () => { hookSurface(); scheduleApply() })
  if (win.get_mapped?.()) { hookSurface(); scheduleApply() }

  // Callers MUST invoke this when a transform-based entrance animation finishes, so the region is
  // re-measured with the transform back at identity (see the header note above).
  return scheduleApply
}
