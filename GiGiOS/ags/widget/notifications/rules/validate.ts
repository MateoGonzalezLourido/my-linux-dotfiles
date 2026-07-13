// widget/notifications/rules/validate.ts
// Pure validation of a rule before saving. Returns a list of human-readable error messages
// (empty array = valid). No imports beyond types.
import type { NotifRule, StringMatch } from "./types.ts"
import { POPUP_STYLES } from "./types.ts"
import { isValidHex } from "./color.ts"

function regexValid(value: string): boolean {
  try { new RegExp(value); return true } catch { return false }
}

export function validateRule(rule: NotifRule): string[] {
  const errors: string[] = []
  const e = rule.effects

  // A "timed" rule needs a positive duration.
  if (e.lifetime === "timed" && !(typeof e.ttlMs === "number" && e.ttlMs > 0)) {
    errors.push("La regla es temporal: indica una duración válida (ej: 2d 4h 5min, 15min, 3h).")
  }

  // Regex match fields must compile.
  const fields: [string, StringMatch | undefined][] = [
    ["aplicación", rule.match.app],
    ["título", rule.match.summary],
    ["cuerpo", rule.match.body],
    ["origen", rule.match.source],
  ]
  for (const [label, sm] of fields) {
    if (sm && sm.op === "regex" && !regexValid(sm.value)) {
      errors.push(`Expresión regular inválida en ${label}: "${sm.value}".`)
    }
  }

  // A color effect, if present, must be a valid hex.
  if (e.color !== undefined && !isValidHex(e.color)) {
    errors.push(`Color inválido: "${e.color}" (usa un hex como #89b4fa).`)
  }

  // A style effect, if present, must be a known skin (el JSON de reglas es editable a mano).
  if (e.style !== undefined && !POPUP_STYLES.includes(e.style)) {
    errors.push(`Estilo de popup desconocido: "${e.style}" (usa ${POPUP_STYLES.join(" o ")}).`)
  }

  return errors
}
