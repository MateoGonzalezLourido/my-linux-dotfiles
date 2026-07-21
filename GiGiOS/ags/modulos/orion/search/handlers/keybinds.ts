// Handler de búsqueda para la sección "Atajos": inline mientras ya estás en
// esa sección (filtra en sitio, ver `KeybindsSection.tsx`); fuera de ella
// sus resultados navegan allí en vez de ejecutar nada directamente.

import { getKeybinds } from "../../data/keybinds"
import type { SearchHandler, SearchResult } from "../types"

const MODIFIER_RE = /\b(super|ctrl|alt|shift|prtscn|print)\b/i

export const keybindsHandler: SearchHandler = {
  id: "keybinds",
  defaultFor: ["keybinds"],
  inlineFor: ["keybinds"],   // only inline when already IN keybinds section

  confidence(query: string): number {
    const q = query.toLowerCase()
    if (q.length < 2) return 0.05
    // Modifier key pattern → almost certainly a keybind search
    if (MODIFIER_RE.test(q)) return 0.85
    // Scan cached keybinds for any description/binding match
    const groups = getKeybinds()
    const hasMatch = groups.some(g =>
      g.binds.some(kb =>
        kb.description.toLowerCase().includes(q) ||
        kb.binding.toLowerCase().includes(q)
      )
    )
    return hasMatch ? 0.72 : 0.05
  },

  search(query: string): SearchResult[] {
    const q = query.toLowerCase()
    const results: SearchResult[] = []

    for (const group of getKeybinds()) {
      for (const kb of group.binds) {
        if (
          kb.description.toLowerCase().includes(q) ||
          kb.binding.toLowerCase().includes(q)
        ) {
          results.push({
            id: `kb-${kb.binding}-${kb.description}`,
            title: kb.description,
            subtitle: `${group.name}  ·  ${kb.binding}`,
            iconName: "input-keyboard-symbolic",
            // Navigate to keybinds section with filter applied (query stays in SearchBar)
            navigateTo: "keybinds",
            action: () => {},
          })
        }
      }
    }

    return results.slice(0, 9)
  },
}
