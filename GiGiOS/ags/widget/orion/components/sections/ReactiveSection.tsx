import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { searchResults, setSection, hidePanel, showAppContext } from "../../state"
import type { SearchResult } from "../../search"

function buildRow(result: SearchResult): Gtk.Box {
  const isApp = !!result.meta?.exec

  const outer = new Gtk.Box({ cssClasses: ["rx-result-row"] })
  const btn = new Gtk.Button({ cssClasses: ["rx-item"], hexpand: true })
  const row = new Gtk.Box({ cssClasses: ["rx-row"], spacing: 12 })

  // Icon
  const iconBox = new Gtk.Box({ cssClasses: ["rx-icon-wrap"], valign: Gtk.Align.CENTER })
  if (result.icon) {
    const img = Gtk.Image.new_from_gicon(result.icon)
    img.pixel_size = 26
    iconBox.append(img)
  } else {
    iconBox.append(new Gtk.Image({ iconName: result.iconName ?? "application-x-executable", pixelSize: 26 }))
  }
  row.append(iconBox)

  // Text
  const textCol = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, hexpand: true })
  textCol.append(new Gtk.Label({ label: result.title, cssClasses: ["rx-title"], halign: Gtk.Align.START, ellipsize: 3 }))
  if (result.subtitle) {
    textCol.append(new Gtk.Label({ label: result.subtitle, cssClasses: ["rx-subtitle"], halign: Gtk.Align.START, ellipsize: 3 }))
  }
  row.append(textCol)
  btn.set_child(row)

  let suppressClick = false
  btn.connect("clicked", () => {
    if (suppressClick) { suppressClick = false; return }
    if (result.navigateTo) {
      setSection(result.navigateTo)
    } else if (!isApp) {
      result.action()
      hidePanel()
    } else {
      const execName = result.meta?.execName ?? ""
      showAppContext({
        id: result.id,
        name: result.title,
        iconName: result.iconName ?? "application-x-executable",
        gicon: result.icon ?? null,
        execRaw: result.meta?.exec ?? "",
        execName,
        appId: result.meta?.appId ?? result.id,
        launch: () => result.action(),
      })
    }
  })

  if (isApp) {
    const gesture = new Gtk.GestureClick()
    gesture.set_button(1)
    gesture.propagation_phase = Gtk.PropagationPhase.CAPTURE
    gesture.connect("pressed", (_gesture, presses) => {
      if (presses !== 2) return
      suppressClick = true
      // The window hides on launch, so GTK may omit the final "clicked" signal.
      // Clear the guard independently to preserve the next normal click.
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
        suppressClick = false
        return GLib.SOURCE_REMOVE
      })
      result.action()
      hidePanel()
    })
    btn.add_controller(gesture)
  }

  outer.append(btn)
  return outer
}

export function ReactiveSection() {
  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["rx-content"] })

  const emptyLabel = new Gtk.Label({ label: "Sin resultados", cssClasses: ["rx-empty"] })
  emptyLabel.visible = false
  content.append(emptyLabel)

  function rebuild(results: SearchResult[]) {
    let child = content.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      if (child !== emptyLabel) content.remove(child)
      child = next
    }
    if (results.length === 0) { emptyLabel.visible = true; return }
    emptyLabel.visible = false
    for (const result of results) content.append(buildRow(result))
  }

  searchResults.subscribe(() => rebuild(searchResults.get()))
  rebuild(searchResults.get())

  return content
}
