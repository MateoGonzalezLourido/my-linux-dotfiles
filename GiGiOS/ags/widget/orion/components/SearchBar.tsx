import { Gtk } from "ags/gtk4"
import { setQuery, orionVisible } from "../state"

let _entry: Gtk.Entry | null = null

export function focusSearchAndType(char: string) {
  if (!_entry) return
  _entry.text = _entry.text + char
  _entry.set_position(-1)
  _entry.grab_focus()
}

export default function SearchBar() {
  const entry = new Gtk.Entry()
  entry.set_css_classes(["search-input"])
  entry.placeholder_text = "Buscador inteligente"
  entry.hexpand = true
  entry.connect("changed", () => setQuery(entry.text))
  _entry = entry

  orionVisible.subscribe(v => {
    // La búsqueda se conserva durante la salida para que el contenido no cambie
    // mientras Orion baja. Se limpia al comenzar la siguiente apertura.
    if (!v) return
    entry.text = ""
    entry.grab_focus()
  })

  return (
    <box cssClasses={["search-zone"]}>
      <box cssClasses={["search-bar"]} hexpand>
        <image iconName="system-search-symbolic" cssClasses={["search-icon"]} />
        {entry}
      </box>
    </box>
  )
}
