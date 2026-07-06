// widget/notifications/rules/match.ts
// Pure matchers for the rule engine. No runtime imports beyond types.
import type { StringMatch, MatchSpec, NotifInput } from "./types.ts"

export function matchString(spec: StringMatch, subject: string): boolean {
  const ci = spec.ci !== false
  const s = ci ? subject.toLowerCase() : subject
  const v = ci ? spec.value.toLowerCase() : spec.value
  switch (spec.op) {
    case "contains": return s.includes(v)
    case "equals":   return s === v
    case "regex":
      try { return new RegExp(spec.value, ci ? "i" : "").test(subject) }
      catch { return false }
  }
}

export function matchInput(spec: MatchSpec, input: NotifInput): boolean {
  if (spec.app && !matchString(spec.app, input.appName)) return false
  if (spec.summary && !matchString(spec.summary, input.summary)) return false
  if (spec.body && !matchString(spec.body, input.body)) return false
  return true
}
