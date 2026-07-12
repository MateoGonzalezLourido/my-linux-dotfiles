// widget/notifications/history/historyStore.ts
// Persistent, reactive history of unique notification types (capped). Excludes anything a rule
// matched. Populated from ingest; re-cleaned when the settings panel opens.
import { createState } from "ags"
import GLib from "gi://GLib"
import type { StoredNotification } from "../store.ts"
import { notifSettingsVisible } from "../store.ts"
import { saveJsonAsync } from "../persist.ts"
import { ruleIndex } from "../rules/rulesStore.ts"
import { evaluate } from "../rules/engine.ts"
import { computeDedupKey } from "../rules/dedup.ts"
import {
  type HistoryEntry, type HistoryInput, HISTORY_CAP,
  upsertEntry, collapseDuplicates, trimByRecency, applyRuleExclusion,
} from "./historyLogic.ts"

const HISTORY_PATH = `${GLib.get_user_config_dir()}/gigios/notif-history.json`

function loadHistory(): HistoryEntry[] {
  try {
    const [ok, content] = GLib.file_get_contents(HISTORY_PATH)
    if (ok) {
      const data = JSON.parse(new TextDecoder().decode(content))
      return data.entries ?? []
    }
  } catch (e) { console.error("[notif] loadHistory failed:", e) }
  return []
}

let saveTimer: number | null = null
function scheduleSave(): void {
  if (saveTimer !== null) GLib.source_remove(saveTimer)
  saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
    saveJsonAsync(HISTORY_PATH, { entries: historyEntries.get() }, "history")
    saveTimer = null
    return GLib.SOURCE_REMOVE
  })
}

export const [historyEntries, setHistoryEntries] = createState<HistoryEntry[]>(loadHistory())

/** Record an incoming (already-stored) notification into history. No-op if a rule matched it. */
export function recordNotification(n: StoredNotification): void {
  const input: HistoryInput = {
    // History keeps its OWN dedup key (app + summary + body) so notifications that share an
    // app+summary but differ in body show as distinct entries — independent of the rule
    // engine's dedupKey (which defaults to app+summary for the active list).
    dedupKey: computeDedupKey("app+summary+body", {
      appName: n.appName, summary: n.summary, body: n.body, urgency: n.urgency,
    }),
    app: n.appName,
    summary: n.summary,
    body: n.body,
    appIcon: n.appIcon,
    matchedRulesCount: n.meta.matchedRules.length,
  }
  const prev = historyEntries.get()
  const next = upsertEntry(prev, input, Date.now(), HISTORY_CAP)
  if (next !== prev) {
    setHistoryEntries(next)
    scheduleSave()
  }
}

/** Maintenance pass: collapse dups, drop anything now covered by a rule, trim to cap. */
export function cleanHistory(): void {
  const now = Date.now()
  const idx = ruleIndex.get()
  const matchesAnyRule = (e: HistoryEntry): boolean =>
    evaluate({ appName: e.app, summary: e.summary, body: e.sampleBody, urgency: 1 }, idx, now).meta.matchedRules.length > 0
  let entries = collapseDuplicates(historyEntries.get())
  entries = applyRuleExclusion(entries, matchesAnyRule)
  entries = trimByRecency(entries, HISTORY_CAP)
  setHistoryEntries(entries)
  scheduleSave()
}

// Re-clean whenever the settings panel opens.
notifSettingsVisible.subscribe(() => { if (notifSettingsVisible.get()) cleanHistory() })
