// Handler de búsqueda por defecto de Inicio: fuzzy-match sobre nombre, exec,
// id y descripción de cada `.desktop` (algoritmo de subsecuencia estilo
// rofi/fzf), con pesos distintos por campo.

import Gio from "gi://Gio"
import type { SearchHandler, SearchResult } from "../types"
import { launchApp } from "../../data/launch"

let _cache: Gio.AppInfo[] | null = null
function getApps(): Gio.AppInfo[] {
  if (!_cache) _cache = (Gio.AppInfo.get_all() as Gio.AppInfo[]).filter(a => a.should_show())
  return _cache
}

// ── Fuzzy subsequence scoring ─────────────────────────────────────────────────
// All query chars must appear in target in order (rofi fuzzy algorithm).
// Returns null if target is not a match; positive score if it is.
// Higher score = better match.
function fuzzy(target: string, query: string): number | null {
  const t = target.toLowerCase()
  const q = query.toLowerCase()

  // Fast exact paths
  if (t === q)          return 2000
  if (t.startsWith(q)) return 1800
  if (t.includes(q))   return 1600

  // Subsequence scan: find each query char in order
  const pos: number[] = []
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti)
    if (idx === -1) return null   // not a subsequence → no match
    pos.push(idx)
    ti = idx + 1
  }

  let score = 200

  // Consecutive-run bonus: tightly-grouped chars score much higher
  let run = 1
  for (let i = 1; i < pos.length; i++) {
    if (pos[i] === pos[i - 1] + 1) {
      score += 20 + (++run) * 10
    } else {
      run = 1
    }
  }

  // Word-boundary bonus: match starts at a word start
  for (const p of pos) {
    if (p === 0 || /[\s\-_.]/.test(t[p - 1])) score += 20
  }

  // Penalise late first-match (earlier = more relevant)
  score -= pos[0] * 4

  // Penalise wide span (tighter match = better)
  score -= pos[pos.length - 1] - pos[0]

  // Penalise long targets (shorter = more specific match)
  score -= (t.length - q.length) * 0.4

  return Math.max(score, 1)
}

// Score an app against a query across multiple fields with field weights
function scoreApp(app: Gio.AppInfo, q: string): number {
  const name = app.get_name() ?? ""
  const exec = app.get_executable() ?? ""
  const desc = app.get_description() ?? ""
  const id   = (app.get_id() ?? "").replace(/\.desktop$/, "")

  const ns = fuzzy(name, q)
  if (ns !== null) return ns * 1.5   // name is the strongest signal

  const es = fuzzy(exec, q)
  if (es !== null) return es * 1.2   // exec second

  const is = fuzzy(id, q)
  if (is !== null) return is * 1.0

  const ds = fuzzy(desc, q)
  if (ds !== null) return ds * 0.6   // description last

  return 0
}

export const appsHandler: SearchHandler = {
  id: "apps",
  defaultFor: ["inicio"],
  inlineFor: [],

  confidence(query: string): number {
    const q = query.toLowerCase()
    if (q.length < 2) return 0.05
    const hasMatch = getApps().some(a =>
      fuzzy(a.get_name() ?? "", q) !== null ||
      fuzzy(a.get_executable() ?? "", q) !== null
    )
    return hasMatch ? 0.75 : 0.10
  },

  search(query: string): SearchResult[] {
    const q = query.toLowerCase()
    return getApps()
      .map(a => ({ a, s: scoreApp(a, q) }))
      .filter(({ s }) => s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 9)
      .map(({ a }) => ({
        id: a.get_id() ?? a.get_name() ?? Math.random().toString(),
        title: a.get_name() ?? "",
        subtitle: a.get_description() ?? undefined,
        icon: a.get_icon(),
        meta: {
          exec: a.get_commandline() ?? "",
          appId: a.get_id() ?? "",
          execName: a.get_executable() ?? "",
        },
        action: () => {
          const cmd = (a.get_commandline() ?? "").replace(/%[fFuUdDnNickvmb]/g, "").trim()
          if (cmd) launchApp(cmd)
        },
      }))
  },
}
