// widget/notifications/settings/ruleFactory.ts
// Pure helpers to build and describe rules.
import type { NotifRule, StringMatch } from "../rules/types.ts"
import { formatDuration } from "../rules/duration.ts"

const OP_TXT: Record<StringMatch["op"], string> = {
  contains: "contiene",
  equals: "es",
  regex: "coincide con (regex)",
}
const LIFE_TXT: Record<string, string> = {
  flash: "flash",
  persistent: "persistente",
  "clear-on-boot": "se limpia al reiniciar",
}
const COND_TXT: Record<string, string> = {
  "battery-resolved": "se resuelve al cargar la batería",
  "superseded": "reemplazada por otra igual",
  "update-applied": "tras aplicar la actualización",
}

export function blankRule(id: string): NotifRule {
  return { id, name: "Nueva regla", enabled: true, priority: 100, source: "user", match: {}, effects: {} }
}

export function ruleFromHistoryEntry(id: string, entry: { app: string; summary: string; sampleBody?: string }): NotifRule {
  const name = `${entry.app}: ${entry.summary}`.slice(0, 60)
  const match: NotifRule["match"] = {
    app: { op: "equals", value: entry.app },
    summary: { op: "contains", value: entry.summary },
  }
  // Carry the body so the rule targets this exact variant — history differentiates by body,
  // and without this a created rule would match (and hide) every body under the same app+title.
  if (entry.sampleBody) match.body = { op: "contains", value: entry.sampleBody }
  return { id, name, enabled: true, priority: 100, source: "user", match, effects: {} }
}

/** One-line human-readable summary (Spanish) for list rows. Reads like a sentence:
 *  "Si <condiciones> → <acciones>". */
export function summarizeRule(rule: NotifRule): string {
  const m: string[] = []
  if (rule.match.app) m.push(`la app ${OP_TXT[rule.match.app.op]} «${rule.match.app.value}»`)
  if (rule.match.summary) m.push(`el título ${OP_TXT[rule.match.summary.op]} «${rule.match.summary.value}»`)
  if (rule.match.body) m.push(`el cuerpo ${OP_TXT[rule.match.body.op]} «${rule.match.body.value}»`)
  if (rule.match.source) {
    m.push(rule.match.source.op === "equals" && rule.match.source.value === "system"
      ? "viene de un script del sistema"
      : `el origen ${OP_TXT[rule.match.source.op]} «${rule.match.source.value}»`)
  }
  const matchStr = m.length ? `Si ${m.join(" y ")}` : "Cualquier notificación"

  const e: string[] = []
  const lt = rule.effects.lifetime
  if (lt === "timed") {
    e.push(rule.effects.ttlMs ? `expira en ${formatDuration(rule.effects.ttlMs)}` : "expira (sin duración)")
  } else if (lt) {
    e.push(LIFE_TXT[lt] ?? lt)
  }
  if (rule.effects.clearOnBoot) e.push("se limpia al reiniciar el sistema")
  if (rule.effects.suppress) e.push("no se muestra ni se guarda")
  if (rule.effects.dontShow) e.push("sin popup")
  if (rule.effects.muteAudio) e.push("sin sonido")
  if (rule.effects.noHistory) e.push("sin historial")
  const rw = rule.effects.rewrite
  if (rw && rw.appName === "") e.push("oculta el nombre de la app")
  else if (rw && rw.appName !== undefined) e.push("renombra la app")
  if (rw && (rw.summary !== undefined || rw.body !== undefined)) e.push("reescribe el texto")
  if (rule.effects.color) e.push(`color ${rule.effects.color}`)
  if (rule.effects.style === "dunst") e.push("popup con estilo dunst")
  else if (rule.effects.style === "default") e.push("popup con el estilo del shell")
  if (rule.effects.conditions && rule.effects.conditions.length) {
    e.push(rule.effects.conditions.map(c => COND_TXT[c] ?? c).join(", "))
  }
  const effStr = e.length ? e.join(", ") : "no hace nada"

  return `${matchStr} → ${effStr}`
}
