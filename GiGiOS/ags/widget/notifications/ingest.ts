// widget/notifications/ingest.ts
// Single entry point for incoming notifications: classify via rules → apply on-receive cleanup
// (suppress, dedup) → store → schedule dynamic conditions. The popup/daemon calls only this.
import AstalNotifd from "gi://AstalNotifd"
import { notifications, setNotifications, removeNotification, scheduleStoreSave, appSettings, NOTIF_CAP, type StoredNotification } from "./store.ts"
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

/** Lee SOLO el hint `x-gigios-source` (lo ponen los scripts de `hypr/scripts/`).
 *  Deliberadamente NO pasa por `extractHints()`: ese hace `recursiveUnpack()` de todo el a{sv},
 *  y un `image-data` trae los píxeles en crudo — materializarlos en JS por cada notificación
 *  saldría caro. Hoy solo se libra porque únicamente corre cuando una regla reescribe texto.
 *  `lookup_value` sobre el diccionario desenvuelve la 'v' él solo. */
function readSourceHint(n: AstalNotifd.Notification): string | undefined {
  try {
    const v = (n as any).hints?.lookup_value?.("x-gigios-source", null)
    if (!v) return undefined
    return (v.get_type_string() === "s" ? v.get_string()[0] : String(v.deep_unpack())) || undefined
  } catch (_) { return undefined }
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

  // El origen se lee ANTES de evaluar: las reglas pueden casar por él (`match.source`), y de eso
  // depende la builtin que da el skin dunst a lo que sale de hypr/scripts.
  const source = readSourceHint(n)

  const input: NotifInput = {
    appName: n.app_name || "Sistema",
    summary: n.summary || "",
    body: n.body || "",
    urgency: n.urgency ?? 1,
    source,
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
    // Lo pide NotificationPopup para dar más vida al popup cuando trae acciones: el
    // botón solo existe mientras el popup está en pantalla (las notificaciones de
    // hypr/scripts no llegan al historial), así que con los 5,5 s fijos de siempre no
    // daba tiempo ni a leerlo. En el spec 0 = "no expira nunca"; el popup lo acota.
    expireTimeout: typeof n.expire_timeout === "number" ? n.expire_timeout : undefined,
    image: n.image_path || undefined,
    source,
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

  // El tope se aplica aquí, en memoria, y no solo al serializar: guardar `slice(-NOTIF_CAP)`
  // acotaba el fichero pero dejaba crecer el array (y todo map/filter sobre él) durante la sesión.
  const overflow = next.length - NOTIF_CAP
  const capped = overflow > 0 ? next.slice(overflow) : next
  if (overflow > 0) for (const x of next.slice(0, overflow)) disposeConditions(x.id)

  setNotifications(capped)
  scheduleStoreSave()
  recordNotification(stored)
  scheduleConditions(stored)

  return stored.meta.dontShow ? null : stored
}
