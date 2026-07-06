// widget/notifications/rules/engine.ts
// Pure rule engine: compile rules into an app-indexed structure, then evaluate a notification.
import type { NotifRule, NotifInput, NotifMeta, EvalResult } from "./types.ts"
import { matchInput } from "./match.ts"
import { computeDedupKey } from "./dedup.ts"

export interface CompiledRule {
  rule: NotifRule
  test(input: NotifInput): boolean
}

export interface RuleIndex {
  byApp: Map<string, CompiledRule[]>
  rest: CompiledRule[]
  candidatesFor(appName: string): CompiledRule[]
}

export function compileRules(rules: NotifRule[]): RuleIndex {
  const byApp = new Map<string, CompiledRule[]>()
  const rest: CompiledRule[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    const compiled: CompiledRule = { rule, test: (input) => matchInput(rule.match, input) }
    const app = rule.match.app
    if (app && app.op === "equals") {
      const key = (app.ci !== false ? app.value.toLowerCase() : app.value)
      const arr = byApp.get(key) ?? []
      arr.push(compiled)
      byApp.set(key, arr)
    } else {
      rest.push(compiled)
    }
  }
  return {
    byApp,
    rest,
    candidatesFor(appName: string) {
      const exact = byApp.get(appName.toLowerCase()) ?? []
      return [...exact, ...rest]
    },
  }
}

const DEFAULT_DEDUP = "app+summary" as const

export function evaluate(input: NotifInput, index: RuleIndex, now: number): EvalResult {
  // Matched rules, highest priority first. stopOnMatch cuts the rest.
  const matched: NotifRule[] = []
  const candidates = index.candidatesFor(input.appName)
    .filter(c => c.test(input))
    .sort((a, b) => b.rule.priority - a.rule.priority)
  for (const c of candidates) {
    matched.push(c.rule)
    if (c.rule.stopOnMatch) break
  }

  // Fold effects: iterate high→low, only set a field if not already set (higher priority wins).
  let lifetime: NotifMeta["lifetime"] | undefined
  let ttlMs: number | undefined
  let clearOnBoot: boolean | undefined
  let noHistory: boolean | undefined
  let muteAudio: boolean | undefined
  let dontShow: boolean | undefined
  let suppress: boolean | undefined
  let dedupSpec: NotifRule["effects"]["dedupKey"] | undefined
  let rewriteAppName: string | undefined
  let rewriteSummary: string | undefined
  let rewriteBody: string | undefined
  let color: string | undefined
  const conditions = new Set<string>()

  const setOnce = <T>(cur: T | undefined, val: T | undefined): T | undefined =>
    cur !== undefined ? cur : val

  for (const r of matched) {
    const e = r.effects
    lifetime    = setOnce(lifetime, e.lifetime)
    ttlMs       = setOnce(ttlMs, e.ttlMs)
    clearOnBoot = setOnce(clearOnBoot, e.clearOnBoot)
    noHistory   = setOnce(noHistory, e.noHistory)
    muteAudio   = setOnce(muteAudio, e.muteAudio)
    dontShow    = setOnce(dontShow, e.dontShow)
    suppress    = setOnce(suppress, e.suppress)
    dedupSpec      = setOnce(dedupSpec, e.dedupKey)
    rewriteAppName = setOnce(rewriteAppName, r.effects.rewrite?.appName)
    rewriteSummary = setOnce(rewriteSummary, r.effects.rewrite?.summary)
    rewriteBody    = setOnce(rewriteBody, r.effects.rewrite?.body)
    color       = setOnce(color, e.color)
    for (const cond of e.conditions ?? []) conditions.add(cond)
  }

  const finalLifetime = lifetime ?? "persistent"
  const finalClearOnBoot = (clearOnBoot ?? false) || finalLifetime === "clear-on-boot"
  const meta: NotifMeta = {
    lifetime: finalLifetime,
    clearOnBoot: finalClearOnBoot,
    noHistory: noHistory ?? false,
    muteAudio: muteAudio ?? false,
    dontShow: dontShow ?? false,
    dedupKey: computeDedupKey(dedupSpec ?? DEFAULT_DEDUP, input),
    conditions: [...conditions],
    matchedRules: matched.map(r => r.id),
  }
  if (color !== undefined) meta.color = color
  if (finalLifetime === "timed" && ttlMs !== undefined) {
    meta.expiresAt = now + ttlMs
  }
  const result: EvalResult = { meta, suppress: suppress ?? false }
  if (rewriteAppName !== undefined || rewriteSummary !== undefined || rewriteBody !== undefined) {
    result.rewrite = {}
    if (rewriteAppName !== undefined) result.rewrite.appName = rewriteAppName
    if (rewriteSummary !== undefined) result.rewrite.summary = rewriteSummary
    if (rewriteBody !== undefined) result.rewrite.body = rewriteBody
  }
  return result
}
