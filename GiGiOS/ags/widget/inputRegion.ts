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

export function clipWindowInputToContent(win: any, content: any): void {
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
}
