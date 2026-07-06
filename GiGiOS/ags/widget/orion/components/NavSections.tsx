import { Gtk } from "ags/gtk4"
import { activeSection, onSectionChange } from "../state"
import { SECTION_COMPONENTS } from "./sections"

export default function NavSections() {
  const widgets: Record<string, Gtk.Widget> = {}

  const outer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["section-content"] })

  for (const [id, Component] of Object.entries(SECTION_COMPONENTS)) {
    const w = Component() as unknown as Gtk.Widget
    w.visible = false
    widgets[id] = w
    outer.append(w)
  }

  function show(id: string) {
    for (const [wid, w] of Object.entries(widgets)) w.visible = wid === id
  }

  show(activeSection.get())
  onSectionChange(show)

  return outer
}
