// Elige QUÉ handler responde a una búsqueda: el de mayor confianza gana, con
// un pequeño empujón para el handler por defecto de la sección actual (así
// una búsqueda ambigua se resuelve a favor de donde ya estás). Los handlers
// en sí no compiten entre ellos ni se conocen.

import type { SectionId } from "../state"
import type { SearchHandler, SearchResult } from "./types"

export interface ResolveResult {
  inline: boolean
  results: SearchResult[]
  handlerId: string | null
}

export class SearchEngine {
  private handlers: SearchHandler[] = []

  register(handler: SearchHandler) {
    this.handlers.push(handler)
  }

  resolve(query: string, section: SectionId): ResolveResult {
    const q = query.trim()
    if (!q) return { inline: false, results: [], handlerId: null }

    const ctx = { section }

    // Score every handler — default handler for current section gets +0.3 boost
    let best: SearchHandler | null = null
    let bestScore = -Infinity

    for (const h of this.handlers) {
      const score = h.confidence(q, ctx) + (h.defaultFor.includes(section) ? 0.3 : 0)
      if (score > bestScore) { best = h; bestScore = score }
    }

    if (!best || bestScore <= 0) return { inline: false, results: [], handlerId: null }

    // Inline only when both: handler declares it AND we're in that section
    const inline = best.inlineFor.includes(section)

    return {
      inline,
      results: inline ? [] : best.search(q, ctx),
      handlerId: best.id,
    }
  }
}
