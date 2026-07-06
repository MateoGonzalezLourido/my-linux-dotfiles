// widget/notifications/history/historyLogic.ts
// Pure history logic. No runtime imports.

export const HISTORY_CAP = 500

export interface HistoryEntry {
  dedupKey: string
  app: string
  summary: string
  sampleBody: string
  appIcon: string
  count: number
  firstSeen: number
  lastSeen: number
}

// The minimal incoming shape, derived from a StoredNotification by the GJS layer.
export interface HistoryInput {
  dedupKey: string
  app: string
  summary: string
  body: string
  appIcon: string
  matchedRulesCount: number
}

/** A notification belongs in history only if NO rule matched it. */
export function shouldIndex(input: HistoryInput): boolean {
  return input.matchedRulesCount === 0
}

export function trimByRecency(entries: HistoryEntry[], cap: number): HistoryEntry[] {
  if (entries.length <= cap) return entries
  return [...entries].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, cap)
}

export function upsertEntry(entries: HistoryEntry[], input: HistoryInput, now: number, cap: number): HistoryEntry[] {
  // Matched by a rule → must not be in history; drop any existing entry with this key.
  if (!shouldIndex(input)) {
    const filtered = entries.filter(e => e.dedupKey !== input.dedupKey)
    return filtered.length === entries.length ? entries : filtered
  }
  const idx = entries.findIndex(e => e.dedupKey === input.dedupKey)
  let next: HistoryEntry[]
  if (idx >= 0) {
    const prev = entries[idx]
    const updated: HistoryEntry = {
      ...prev,
      summary: input.summary,
      sampleBody: input.body,
      appIcon: input.appIcon || prev.appIcon,
      count: prev.count + 1,
      lastSeen: now,
    }
    next = [...entries.slice(0, idx), updated, ...entries.slice(idx + 1)]
  } else {
    next = [...entries, {
      dedupKey: input.dedupKey,
      app: input.app,
      summary: input.summary,
      sampleBody: input.body,
      appIcon: input.appIcon,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    }]
  }
  return trimByRecency(next, cap)
}

/** Merge entries sharing a dedupKey (used as a maintenance pass). */
export function collapseDuplicates(entries: HistoryEntry[]): HistoryEntry[] {
  const map = new Map<string, HistoryEntry>()
  for (const e of entries) {
    const ex = map.get(e.dedupKey)
    if (!ex) { map.set(e.dedupKey, { ...e }); continue }
    const newest = e.lastSeen > ex.lastSeen ? e : ex
    map.set(e.dedupKey, {
      ...ex,
      count: ex.count + e.count,
      firstSeen: Math.min(ex.firstSeen, e.firstSeen),
      lastSeen: Math.max(ex.lastSeen, e.lastSeen),
      summary: newest.summary,
      sampleBody: newest.sampleBody,
      appIcon: ex.appIcon || e.appIcon,
    })
  }
  return [...map.values()]
}

/** Keep only entries the predicate does NOT flag as matching a rule. */
export function applyRuleExclusion(
  entries: HistoryEntry[],
  matchesAnyRule: (e: HistoryEntry) => boolean,
): HistoryEntry[] {
  return entries.filter(e => !matchesAnyRule(e))
}
