// widget/notifications/ingest.ts
// Single entry point for incoming notifications: classify via rules → apply on-receive cleanup
// (suppress, dedup) → store → schedule dynamic conditions. The popup/daemon calls only this.
import AstalNotifd from "gi://AstalNotifd"
import { notifications, setNotifications, removeNotification, scheduleStoreSave, appSettings, type StoredNotification } from "./store.ts"
import { ruleIndex } from "./rules/rulesStore.ts"
import { evaluate } from "./rules/engine.ts"
import { applyTemplate } from "./rules/template.ts"
import { buildNotifFields, type RawNotif } from "./rules/notifFields.ts"
import { getCondition } from "./rules/conditions.ts"
import type { NotifInput } from "./rules/types.ts"
import { recordNotification } from "./history/historyStore.ts"

/** Unpack a notification's D-Bus hints (a{sv}) into a flat string map for rewrite placeholders.
 *  Only string/number/boolean hint values are kept; complex values (images, byte arrays) skipped. */
function extractHints(n: AstalNotifd.Notification): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = (n as any).hints?.recursiveUnpack?.()
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string") out[k] = v
        else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v)
      }
    }
  } catch (_) {}
  return out
}

const conditionDisposers = new Map<number, (() => void)[]>()

export function disposeConditions(id: number): void {
  const arr = conditionDisposers.get(id)
  if (arr) { for (const d of arr) { try { d() } catch {} } conditionDisposers.delete(id) }
}

function scheduleConditions(stored: StoredNotification): void {
  if (stored.meta.conditions.length === 0) return
  const disposers: (() => void)[] = []
  for (const name of stored.meta.conditions) {
    const provider = getCondition(name)
    if (!provider) continue
    disposers.push(provider.watch(stored, () => { removeNotification(stored.id); disposeConditions(stored.id) }))
  }
  if (disposers.length) conditionDisposers.set(stored.id, disposers)
}

/**
 * Ingest a live notification. Returns the stored notification (for the popup to display),
 * or null if it was suppressed or shouldn't be shown.
 */
export function ingest(n: AstalNotifd.Notification): StoredNotification | null {
  // Bridge: honor existing per-app mute (appSettings) until Phase 3 migrates it to rules.
  if (appSettings.get()[n.app_name]?.muted) return null

  const input: NotifInput = {
    appName: n.app_name || "Sistema",
    summary: n.summary || "",
    body: n.body || "",
    urgency: n.urgency ?? 1,
  }
  const { meta, suppress, rewrite } = evaluate(input, ruleIndex.get(), Date.now())
  if (suppress) return null

  // Text rewriting: placeholders resolve against the ORIGINAL notification fields + its hints.
  // appName === "" omits the app name; matching/dedup already used the original above.
  let appName = input.appName
  let summary = input.summary
  let body = input.body
  if (rewrite) {
    const fields = buildNotifFields(n as RawNotif, Date.now(), extractHints(n))
    if (rewrite.appName !== undefined) appName = applyTemplate(rewrite.appName, fields)
    if (rewrite.summary !== undefined) summary = applyTemplate(rewrite.summary, fields)
    if (rewrite.body !== undefined) body = applyTemplate(rewrite.body, fields)
  }

  const stored: StoredNotification = {
    id: n.id,
    appName: appName,
    appIcon: n.app_icon || "",
    summary: summary,
    body: body,
    timestamp: Date.now(),
    read: false,
    urgency: input.urgency,
    actions: (n.actions ?? []).map((a: any) => ({ id: a.id, label: a.label })),
    image: n.image_path || undefined,
    meta,
  }

  const current = notifications.get()
  // Dedup in the active list: drop any existing notif with the same dedupKey (supersede).
  const deduped = current.filter(x => {
    if (x.meta.dedupKey === stored.meta.dedupKey && x.id !== stored.id) { disposeConditions(x.id); return false }
    return true
  })
  const idx = deduped.findIndex(x => x.id === stored.id)
  const next = idx >= 0
    ? [...deduped.slice(0, idx), stored, ...deduped.slice(idx + 1)]
    : [...deduped, stored]

  setNotifications(next)
  scheduleStoreSave()
  recordNotification(stored)
  scheduleConditions(stored)

  return stored.meta.dontShow ? null : stored
}
