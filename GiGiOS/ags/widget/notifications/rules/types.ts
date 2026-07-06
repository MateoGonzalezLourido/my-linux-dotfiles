// widget/notifications/rules/types.ts
// Pure type declarations for the notification rule engine. No runtime imports.

export type Lifetime = "flash" | "timed" | "clear-on-boot" | "persistent"

export interface StringMatch {
  op: "contains" | "equals" | "regex"
  value: string
  ci?: boolean // case-insensitive (default true)
}

export interface MatchSpec {
  app?: StringMatch
  summary?: StringMatch
  body?: StringMatch
}

export type DedupKeySpec =
  | "app"
  | "app+summary"
  | "app+summary+body"
  | { template: string } // e.g. "{app}|{summary}"

export interface EffectSpec {
  lifetime?: Lifetime
  ttlMs?: number
  clearOnBoot?: boolean
  noHistory?: boolean
  suppress?: boolean
  muteAudio?: boolean
  dontShow?: boolean
  dedupKey?: DedupKeySpec
  conditions?: string[]
  // accent color override (hex, e.g. "#89b4fa"). Highest priority in color resolution:
  // rule color > per-app color > system default (getAppColor).
  color?: string
  // text rewriting templates (see rules/template.ts + rules/notifFields.ts).
  // appName === "" omits the app name entirely from popup/panel.
  rewrite?: { appName?: string; summary?: string; body?: string }
}

export interface NotifRule {
  id: string
  name: string
  enabled: boolean
  priority: number // higher wins on conflict
  source: "builtin" | "user"
  match: MatchSpec
  effects: EffectSpec
  stopOnMatch?: boolean
}

// The minimal notification shape the engine needs (decoupled from AstalNotifd / StoredNotification).
export interface NotifInput {
  appName: string
  summary: string
  body: string
  urgency: number
}

export interface NotifMeta {
  lifetime: Lifetime
  expiresAt?: number // ms epoch, only when lifetime === "timed"
  clearOnBoot: boolean
  noHistory: boolean
  muteAudio: boolean
  dontShow: boolean
  dedupKey: string
  conditions: string[]
  matchedRules: string[]
  color?: string // accent color from the highest-priority matched rule, baked at ingest
}

export interface EvalResult {
  meta: NotifMeta
  suppress: boolean // consumed by ingest; never persisted on the notification
  rewrite?: { appName?: string; summary?: string; body?: string }
}
