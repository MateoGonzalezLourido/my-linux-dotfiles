// Campo de búsqueda de Orion. `focusSearchAndType` es el punto de entrada de
// "empezar a escribir enfoca la búsqueda" (ver el handler de teclado en
// `Orion.tsx`), de ahí que la referencia al `Gtk.Entry` se guarde a nivel de
// módulo en vez de pasarse como prop.

import { Gtk } from "ags/gtk4"
import { setQuery, orionVisible } from "../../state"

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

  orionVisible.subscribe(() => {
    // La búsqueda se conserva durante la salida para que el contenido no cambie
    // mientras Orion baja. Se limpia al comenzar la siguiente apertura.
    if (!orionVisible.get()) return
    entry.text = ""
    entry.grab_focus()
  })

  return (
    <box cssClasses={["search-zone"]}>
      <box cssClasses={["search-bar"]} hexpand>
        <image iconName="system-search-symbolic" pixelSize={13} cssClasses={["search-icon"]} />
        {entry}
      </box>
    </box>
  )
}
