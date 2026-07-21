// Monta TODAS las secciones de una vez (no perezoso) y alterna su
// visibilidad, en vez de reconstruir al cambiar de pestaña: así una sección
// conserva su scroll y su estado interno (filtros, vista mosaico/lista…) al
// volver a ella.

import { Gtk } from "ags/gtk4"
import { activeSection, onSectionChange } from "../../state"
import { SECTION_COMPONENTS } from "../sections"
import { ALTURA_FRANJA_SISTEMA } from "../sections/HomeSection"
import type { NavegacionBusqueda } from "../shared/NavegacionBusqueda"

const ALTURA_VIEWPORT_ORION = 458

interface NavSectionsProps {
  navegacion: NavegacionBusqueda
}

export default function NavSections({ navegacion }: NavSectionsProps) {
  const widgets: Record<string, Gtk.Widget> = {}

  const outer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["section-content"] })
  const scroll = new Gtk.ScrolledWindow({ cssClasses: ["orion-content-scroll"], vexpand: true })
  // EXTERNAL mantiene rueda/touchpad pero no crea una barra visible o pulsable.
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.EXTERNAL)
  scroll.set_child(outer)

  for (const [id, Component] of Object.entries(SECTION_COMPONENTS)) {
    const w = Component(navegacion) as unknown as Gtk.Widget
    w.visible = false
    widgets[id] = w
    outer.append(w)
  }

  function show(id: string) {
    for (const [wid, w] of Object.entries(widgets)) w.visible = wid === id
    scroll.height_request = id === "inicio"
      ? ALTURA_VIEWPORT_ORION - ALTURA_FRANJA_SISTEMA
      : ALTURA_VIEWPORT_ORION
    scroll.get_vadjustment().set_value(0)
  }

  show(activeSection.get())
  onSectionChange(show)

  return scroll
}
