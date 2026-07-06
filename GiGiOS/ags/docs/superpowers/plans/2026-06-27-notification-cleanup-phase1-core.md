# Notification Cleanup — Phase 1 (Core engine + cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the rule-driven classification + cleanup core for AGS notifications (no UI yet): a pure rule engine that computes per-notification metadata once, built-in rules, boot/periodic cleanup, dynamic-condition watchers, and a single `ingest()` funnel — wired into the existing notification daemon path.

**Architecture:** Approach A (declarative data rules + named condition/effect registries) from the spec `docs/superpowers/specs/2026-06-27-notification-cleanup-system-design.md`. Pure logic (matching, merge, dedup-key, boot-time parse, cleanup partitions) lives in dependency-free modules unit-tested with `node --test`. GJS/GTK-bound modules (rules store IO, conditions, ingest wiring) are verified manually via `ags run`.

**Tech Stack:** TypeScript, AGS v2 (Astal) / GJS runtime, GTK4, GLib, AstalNotifd/AstalBattery. Tests run on Node v26 (`node --test`, native TS).

---

## Environment notes (read first)

- **Tests:** Node v26 runs `.ts` directly. Run a single test file with `node --test <path>`. To run several, use a quoted glob — `node --test 'widget/notifications/rules/*.test.ts'`. Note: `node --test <dir>` does NOT work in Node v26 (it tries to load the directory as a module); always pass file paths or a quoted glob. Pure modules MUST NOT import `gi://*` or `ags` (those only exist in the GJS runtime), or `node --test` will fail to import them. Keep pure modules importing only other pure modules + `node:`/no imports.
- **TS subset for pure modules:** Node strip-types rejects `enum`, `namespace`, and constructor parameter-properties. Use `type`/`interface`/plain functions only in pure modules.
- **git:** This repo is NOT a git repository. Commit steps below are written for completeness. If you want commit checkpoints, run `git init` once before Task 1; otherwise skip every "Commit" step. Do not push.
- **Runtime check:** After GJS-bound tasks, verify with `ags run ~/.config/ags/app.ts` and observe logs/behavior. There is no headless test for GTK widgets here.
- **No `enum`/index micro-opt regressions:** the rule index is keyed by lowercased app for rules whose `match.app.op === "equals"`; everything else goes in `rest`.

---

## File structure (Phase 1)

Create:
- `widget/notifications/rules/types.ts` — all shared types (pure, no imports).
- `widget/notifications/rules/match.ts` — `matchString`, `matchInput` (pure).
- `widget/notifications/rules/dedup.ts` — `computeDedupKey` (pure).
- `widget/notifications/rules/engine.ts` — `compileRules`, `evaluate` (pure).
- `widget/notifications/rules/defaults.ts` — built-in rules (pure data).
- `widget/notifications/cleanup/bootDetect.ts` — `parseBtime` (pure) + `readBtime`/marker IO (GLib).
- `widget/notifications/cleanup/partitions.ts` — pure cleanup helpers.
- `widget/notifications/rules/rulesStore.ts` — load/save rules + overrides, reactive (GLib + ags).
- `widget/notifications/rules/conditions.ts` — condition provider registry + providers (GJS).
- `widget/notifications/ingest.ts` — single ingest funnel (GJS).
- `widget/notifications/cleanup/cleanupEngine.ts` — boot deep-clean + periodic sweep orchestration (GJS).
- Test files co-located: `*.test.ts` next to each pure module.

Modify:
- `widget/notifications/store.ts` — add `meta` to `StoredNotification`; expose mutation helpers used by cleanup/ingest; one-time `appSettings` → rules migration.
- `widget/notifications/NotificationPopup.tsx` — `notified` handler calls `ingest(n)` instead of building `StoredNotification` inline.

---

## Task 1: Shared types

**Files:**
- Create: `widget/notifications/rules/types.ts`
- Test: `widget/notifications/rules/types.test.ts`

- [ ] **Step 1: Write the types file**

```ts
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
  urgency?: number[] // any-of; matches if notif.urgency is in this list
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
}

export interface EvalResult {
  meta: NotifMeta
  suppress: boolean // consumed by ingest; never persisted on the notification
}
```

- [ ] **Step 2: Write a smoke test that the module imports and types are usable at runtime**

```ts
// widget/notifications/rules/types.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import type { NotifRule, NotifInput } from "./types.ts"

test("types module imports without runtime error", () => {
  const rule: NotifRule = {
    id: "x", name: "x", enabled: true, priority: 0, source: "user",
    match: {}, effects: {},
  }
  const input: NotifInput = { appName: "a", summary: "s", body: "b", urgency: 1 }
  assert.equal(rule.id, "x")
  assert.equal(input.appName, "a")
})
```

- [ ] **Step 3: Run test**

Run: `node --test widget/notifications/rules/types.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/types.ts widget/notifications/rules/types.test.ts
git commit -m "feat(notif): rule engine shared types"
```

---

## Task 2: String matcher

**Files:**
- Create: `widget/notifications/rules/match.ts`
- Test: `widget/notifications/rules/match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/rules/match.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { matchString, matchInput } from "./match.ts"
import type { MatchSpec } from "./types.ts"

test("contains is case-insensitive by default", () => {
  assert.equal(matchString({ op: "contains", value: "Claude" }, "claude code login"), true)
})

test("contains respects ci:false", () => {
  assert.equal(matchString({ op: "contains", value: "Claude", ci: false }, "claude"), false)
})

test("equals matches whole string", () => {
  assert.equal(matchString({ op: "equals", value: "kitty" }, "kitty"), true)
  assert.equal(matchString({ op: "equals", value: "kitty" }, "kitty term"), false)
})

test("regex matches", () => {
  assert.equal(matchString({ op: "regex", value: "^perm" }, "permission needed"), true)
})

test("invalid regex returns false instead of throwing", () => {
  assert.equal(matchString({ op: "regex", value: "(" }, "anything"), false)
})

test("matchInput ANDs all present fields", () => {
  const spec: MatchSpec = { app: { op: "equals", value: "kitty" }, summary: { op: "contains", value: "claude" } }
  assert.equal(matchInput(spec, { appName: "kitty", summary: "Claude Code", body: "", urgency: 1 }), true)
  assert.equal(matchInput(spec, { appName: "kitty", summary: "other", body: "", urgency: 1 }), false)
})

test("matchInput urgency any-of", () => {
  const spec: MatchSpec = { urgency: [2] }
  assert.equal(matchInput(spec, { appName: "x", summary: "", body: "", urgency: 2 }), true)
  assert.equal(matchInput(spec, { appName: "x", summary: "", body: "", urgency: 1 }), false)
})

test("empty matchspec matches everything", () => {
  assert.equal(matchInput({}, { appName: "x", summary: "", body: "", urgency: 0 }), true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/rules/match.test.ts`
Expected: FAIL — `Cannot find module './match.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
  if (spec.urgency && !spec.urgency.includes(input.urgency)) return false
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/rules/match.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/match.ts widget/notifications/rules/match.test.ts
git commit -m "feat(notif): rule string/input matchers"
```

---

## Task 3: Dedup key computation

**Files:**
- Create: `widget/notifications/rules/dedup.ts`
- Test: `widget/notifications/rules/dedup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/rules/dedup.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { computeDedupKey } from "./dedup.ts"

const n = { appName: "WhatsApp", summary: "usuario1", body: "hola", urgency: 1 }

test("default app+summary", () => {
  assert.equal(computeDedupKey("app+summary", n), "whatsapp usuario1")
})

test("app only", () => {
  assert.equal(computeDedupKey("app", n), "whatsapp")
})

test("app+summary+body", () => {
  assert.equal(computeDedupKey("app+summary+body", n), "whatsapp usuario1 hola")
})

test("template", () => {
  assert.equal(computeDedupKey({ template: "{app}|{summary}" }, n), "whatsapp|usuario1")
})

test("template unknown placeholder left literal", () => {
  assert.equal(computeDedupKey({ template: "{app}-{nope}" }, n), "whatsapp-{nope}")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/rules/dedup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// widget/notifications/rules/dedup.ts
// Pure dedup-key computation. Keys are lowercased and NUL-joined to avoid collisions.
import type { DedupKeySpec, NotifInput } from "./types.ts"

const SEP = " "

export function computeDedupKey(spec: DedupKeySpec, input: NotifInput): string {
  const app = input.appName.toLowerCase()
  const summary = input.summary.toLowerCase()
  const body = input.body.toLowerCase()
  if (typeof spec === "object") {
    return spec.template
      .replace(/\{app\}/g, app)
      .replace(/\{summary\}/g, summary)
      .replace(/\{body\}/g, body)
  }
  switch (spec) {
    case "app": return app
    case "app+summary": return [app, summary].join(SEP)
    case "app+summary+body": return [app, summary, body].join(SEP)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/rules/dedup.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/dedup.ts widget/notifications/rules/dedup.test.ts
git commit -m "feat(notif): dedup key computation"
```

---

## Task 4: Compile rules into an index

**Files:**
- Create: `widget/notifications/rules/engine.ts` (compile half)
- Test: `widget/notifications/rules/engine.compile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/rules/engine.compile.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileRules } from "./engine.ts"
import type { NotifRule } from "./types.ts"

function rule(p: Partial<NotifRule>): NotifRule {
  return { id: "r", name: "r", enabled: true, priority: 0, source: "user", match: {}, effects: {}, ...p }
}

test("equals-app rules indexed by lowercased app; others in rest", () => {
  const rules = [
    rule({ id: "a", match: { app: { op: "equals", value: "Kitty" } } }),
    rule({ id: "b", match: { app: { op: "contains", value: "fire" } } }),
    rule({ id: "c", match: {} }),
  ]
  const idx = compileRules(rules)
  assert.deepEqual(idx.byApp.get("kitty")?.map(c => c.rule.id), ["a"])
  assert.deepEqual(idx.rest.map(c => c.rule.id), ["b", "c"])
})

test("disabled rules are excluded", () => {
  const idx = compileRules([rule({ id: "a", enabled: false })])
  assert.equal(idx.rest.length, 0)
})

test("candidatesFor returns byApp + rest", () => {
  const rules = [
    rule({ id: "a", match: { app: { op: "equals", value: "kitty" } } }),
    rule({ id: "c", match: {} }),
  ]
  const idx = compileRules(rules)
  const ids = idx.candidatesFor("kitty").map(c => c.rule.id).sort()
  assert.deepEqual(ids, ["a", "c"])
  assert.deepEqual(idx.candidatesFor("firefox").map(c => c.rule.id), ["c"])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/rules/engine.compile.test.ts`
Expected: FAIL — module not found / `compileRules` undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/rules/engine.compile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/engine.ts widget/notifications/rules/engine.compile.test.ts
git commit -m "feat(notif): compile rules into app index"
```

---

## Task 5: Evaluate a notification → metadata

**Files:**
- Modify: `widget/notifications/rules/engine.ts` (add `evaluate`)
- Test: `widget/notifications/rules/engine.evaluate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/rules/engine.evaluate.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileRules, evaluate } from "./engine.ts"
import type { NotifRule, NotifInput } from "./types.ts"

const NOW = 1_000_000
function rule(p: Partial<NotifRule>): NotifRule {
  return { id: "r", name: "r", enabled: true, priority: 0, source: "user", match: {}, effects: {}, ...p }
}
const wa: NotifInput = { appName: "WhatsApp", summary: "usuario1", body: "hola", urgency: 1 }

test("no matching rule → persistent defaults, dedup app+summary", () => {
  const r = evaluate(wa, compileRules([]), NOW)
  assert.equal(r.suppress, false)
  assert.equal(r.meta.lifetime, "persistent")
  assert.equal(r.meta.clearOnBoot, false)
  assert.equal(r.meta.dedupKey, "whatsapp usuario1")
  assert.deepEqual(r.meta.matchedRules, [])
})

test("timed rule sets expiresAt = now + ttl", () => {
  const rules = [rule({ id: "wa", match: { app: { op: "equals", value: "whatsapp" } }, effects: { lifetime: "timed", ttlMs: 1000 } })]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.equal(r.meta.lifetime, "timed")
  assert.equal(r.meta.expiresAt, NOW + 1000)
})

test("higher priority overrides lower, field by field", () => {
  const rules = [
    rule({ id: "low", priority: 0, effects: { lifetime: "persistent", muteAudio: true } }),
    rule({ id: "high", priority: 10, effects: { lifetime: "clear-on-boot" } }),
  ]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.equal(r.meta.lifetime, "clear-on-boot") // high wins
  assert.equal(r.meta.muteAudio, true)           // low still contributes unset field
  assert.equal(r.meta.clearOnBoot, true)         // derived from lifetime (see impl)
})

test("matchedRules lists all matched in descending priority", () => {
  const rules = [
    rule({ id: "low", priority: 0 }),
    rule({ id: "high", priority: 10 }),
  ]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.deepEqual(r.meta.matchedRules, ["high", "low"])
})

test("stopOnMatch halts lower-priority rules", () => {
  const rules = [
    rule({ id: "low", priority: 0, effects: { muteAudio: true } }),
    rule({ id: "high", priority: 10, stopOnMatch: true, effects: { dontShow: true } }),
  ]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.equal(r.meta.dontShow, true)
  assert.equal(r.meta.muteAudio, false) // low never applied
  assert.deepEqual(r.meta.matchedRules, ["high"])
})

test("suppress effect surfaces on result", () => {
  const rules = [rule({ id: "s", effects: { suppress: true } })]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.equal(r.suppress, true)
})

test("rule-specified dedupKey wins over default", () => {
  const rules = [rule({ id: "d", effects: { dedupKey: "app" } })]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.equal(r.meta.dedupKey, "whatsapp")
})

test("conditions are unioned across matched rules", () => {
  const rules = [
    rule({ id: "a", priority: 1, effects: { conditions: ["battery-resolved"] } }),
    rule({ id: "b", priority: 2, effects: { conditions: ["superseded"] } }),
  ]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.deepEqual([...r.meta.conditions].sort(), ["battery-resolved", "superseded"])
})

test("clear-on-boot lifetime implies clearOnBoot flag", () => {
  const rules = [rule({ id: "c", effects: { lifetime: "clear-on-boot" } })]
  const r = evaluate(wa, compileRules(rules), NOW)
  assert.equal(r.meta.clearOnBoot, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/rules/engine.evaluate.test.ts`
Expected: FAIL — `evaluate` is not exported.

- [ ] **Step 3: Add `evaluate` to `engine.ts`**

Append to `widget/notifications/rules/engine.ts`:

```ts
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
    dedupSpec   = setOnce(dedupSpec, e.dedupKey)
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
  if (finalLifetime === "timed" && ttlMs !== undefined) {
    meta.expiresAt = now + ttlMs
  }
  return { meta, suppress: suppress ?? false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/rules/engine.evaluate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the whole rules test suite**

Run: `node --test 'widget/notifications/rules/*.test.ts'`
Expected: all PASS.

- [ ] **Step 6: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/engine.ts widget/notifications/rules/engine.evaluate.test.ts
git commit -m "feat(notif): evaluate notification to metadata"
```

---

## Task 6: Built-in default rules

**Files:**
- Create: `widget/notifications/rules/defaults.ts`
- Test: `widget/notifications/rules/defaults.test.ts`

Built-ins (low priority so user rules override). Covers the system cases named in the spec.

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/rules/defaults.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { BUILTIN_RULES } from "./defaults.ts"
import { compileRules, evaluate } from "./engine.ts"

const idx = compileRules(BUILTIN_RULES)
const NOW = 0

test("all builtin rules are source=builtin, enabled, low priority", () => {
  for (const r of BUILTIN_RULES) {
    assert.equal(r.source, "builtin")
    assert.equal(r.enabled, true)
    assert.ok(r.priority < 100, `${r.id} priority should be <100`)
  }
})

test("builtin ids are unique", () => {
  const ids = BUILTIN_RULES.map(r => r.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("screenshot → suppress + noHistory", () => {
  const r = evaluate({ appName: "notify-send", summary: "Captura de pantalla", body: "", urgency: 1 }, idx, NOW)
  assert.equal(r.suppress, true)
})

test("app crash → clear-on-boot", () => {
  const r = evaluate({ appName: "notify-send", summary: "App crasheada", body: "Proceso: python3 (coredump)", urgency: 2 }, idx, NOW)
  assert.equal(r.meta.lifetime, "clear-on-boot")
  assert.equal(r.meta.clearOnBoot, true)
})

test("reboot recommended → clear-on-boot", () => {
  const r = evaluate({ appName: "CachyOS Update", summary: "Reboot recommended!", body: "Reboot is recommended", urgency: 2 }, idx, NOW)
  assert.equal(r.meta.clearOnBoot, true)
})

test("low battery → flash + battery-resolved condition", () => {
  const r = evaluate({ appName: "notify-send", summary: "Batería baja", body: "5% restante", urgency: 2 }, idx, NOW)
  assert.equal(r.meta.lifetime, "flash")
  assert.ok(r.meta.conditions.includes("battery-resolved"))
})

test("whatsapp → timed 2 days, dedup app+summary", () => {
  const r = evaluate({ appName: "WhatsApp", summary: "usuario1", body: "hola", urgency: 1 }, idx, NOW)
  assert.equal(r.meta.lifetime, "timed")
  assert.equal(r.meta.expiresAt, 2 * 24 * 60 * 60 * 1000)
  assert.equal(r.meta.dedupKey, "whatsapp usuario1")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/rules/defaults.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// widget/notifications/rules/defaults.ts
// Built-in seed rules. Low priority (<100) so user rules and overrides win.
// Editing/disabling a builtin is done via overrides in config/notif-rules.json (rulesStore).
import type { NotifRule } from "./types.ts"

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000

export const BUILTIN_RULES: NotifRule[] = [
  {
    id: "builtin.screenshot",
    name: "Capturas de pantalla (flash)",
    enabled: true, priority: 50, source: "builtin", stopOnMatch: true,
    match: { summary: { op: "contains", value: "captura" } },
    effects: { suppress: true, noHistory: true },
  },
  {
    id: "builtin.app-crash",
    name: "Crash de apps (limpiar en reinicio)",
    enabled: true, priority: 40, source: "builtin",
    match: { summary: { op: "contains", value: "crash" } },
    effects: { lifetime: "clear-on-boot" },
  },
  {
    id: "builtin.coredump",
    name: "Coredumps (limpiar en reinicio)",
    enabled: true, priority: 40, source: "builtin",
    match: { body: { op: "contains", value: "coredump" } },
    effects: { lifetime: "clear-on-boot" },
  },
  {
    id: "builtin.reboot-recommended",
    name: "Reinicio recomendado (limpiar en reinicio)",
    enabled: true, priority: 40, source: "builtin",
    match: { summary: { op: "contains", value: "reboot" } },
    effects: { lifetime: "clear-on-boot" },
  },
  {
    id: "builtin.low-battery",
    name: "Batería baja (flash, se resuelve al cargar)",
    enabled: true, priority: 30, source: "builtin",
    match: { summary: { op: "contains", value: "batería" } },
    effects: { lifetime: "flash", conditions: ["battery-resolved"] },
  },
  {
    id: "builtin.whatsapp",
    name: "WhatsApp (expira 2 días)",
    enabled: true, priority: 20, source: "builtin",
    match: { app: { op: "contains", value: "whatsapp" } },
    effects: { lifetime: "timed", ttlMs: TWO_DAYS_MS, dedupKey: "app+summary" },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/rules/defaults.test.ts`
Expected: PASS (7 tests).

> Note: `builtin.reboot-recommended` matches summary containing "reboot"; the test notification summary is "Reboot recommended!" (case-insensitive contains). Good.

- [ ] **Step 5: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/defaults.ts widget/notifications/rules/defaults.test.ts
git commit -m "feat(notif): built-in default rules"
```

---

## Task 7: Boot detection (btime parse + IO)

**Files:**
- Create: `widget/notifications/cleanup/bootDetect.ts`
- Test: `widget/notifications/cleanup/bootDetect.test.ts`

- [ ] **Step 1: Write the failing test (pure parse only)**

```ts
// widget/notifications/cleanup/bootDetect.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseBtime } from "./bootDetect.ts"

test("parses btime line from /proc/stat content", () => {
  const stat = ["cpu  1 2 3", "intr 999", "btime 1782570000", "processes 42"].join("\n")
  assert.equal(parseBtime(stat), 1782570000)
})

test("returns null when btime absent", () => {
  assert.equal(parseBtime("cpu 1 2 3\nintr 5"), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/cleanup/bootDetect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation (pure parse + GLib IO; only the parse is imported by the test)**

```ts
// widget/notifications/cleanup/bootDetect.ts
// Detect a real machine boot by comparing the kernel boot time (btime from /proc/stat)
// against a marker file. AGS config reloads do NOT change btime, so they don't trigger boot.
import GLib from "gi://GLib"

const MARKER_PATH = `${GLib.get_user_config_dir()}/ags/config/notif-cleanup-state.json`

/** Pure: extract the `btime <seconds>` value from /proc/stat content. */
export function parseBtime(statContent: string): number | null {
  for (const line of statContent.split("\n")) {
    if (line.startsWith("btime ")) {
      const v = parseInt(line.slice(6).trim(), 10)
      return Number.isFinite(v) ? v : null
    }
  }
  return null
}

export function readBtime(): number | null {
  try {
    const [ok, content] = GLib.file_get_contents("/proc/stat")
    if (!ok) return null
    return parseBtime(new TextDecoder().decode(content))
  } catch { return null }
}

interface CleanupState { btime: number | null; lastSweep: number }

function readState(): CleanupState {
  try {
    const [ok, content] = GLib.file_get_contents(MARKER_PATH)
    if (ok) return JSON.parse(new TextDecoder().decode(content))
  } catch {}
  return { btime: null, lastSweep: 0 }
}

function writeState(state: CleanupState): void {
  try {
    const dir = GLib.path_get_dirname(MARKER_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    GLib.file_set_contents(MARKER_PATH, JSON.stringify(state))
  } catch (e) { console.error("[notif] writeState failed:", e) }
}

/**
 * Returns true exactly once per real boot. On a new boot it records the new btime
 * and returns true; on AGS reloads within the same boot it returns false.
 */
export function isNewBoot(): boolean {
  const current = readBtime()
  const state = readState()
  if (current !== null && current !== state.btime) {
    writeState({ ...state, btime: current })
    return true
  }
  return false
}

export function markSwept(now: number): void {
  const state = readState()
  writeState({ ...state, lastSweep: now })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/cleanup/bootDetect.test.ts`
Expected: PASS (2 tests).

> The GLib-dependent functions (`readBtime`, `isNewBoot`, `markSwept`) are NOT imported by the test (the test imports only `parseBtime`). Node still loads the module, which `import GLib from "gi://GLib"` — that WILL fail under node. **Fix:** keep `parseBtime` in this file but ensure the test does not transitively load GLib. Since ESM evaluates the whole module on import, move `parseBtime` to a separate pure file.

- [ ] **Step 5: Split out the pure parse to avoid loading GLib in tests**

Create `widget/notifications/cleanup/btime.ts`:

```ts
// widget/notifications/cleanup/btime.ts — pure, no GLib.
export function parseBtime(statContent: string): number | null {
  for (const line of statContent.split("\n")) {
    if (line.startsWith("btime ")) {
      const v = parseInt(line.slice(6).trim(), 10)
      return Number.isFinite(v) ? v : null
    }
  }
  return null
}
```

Edit `widget/notifications/cleanup/bootDetect.ts` to import and re-export it, and remove the inline `parseBtime`:

```ts
import { parseBtime } from "./btime.ts"
export { parseBtime }
```

Edit the test import to `import { parseBtime } from "./btime.ts"`.

- [ ] **Step 6: Re-run test**

Run: `node --test widget/notifications/cleanup/bootDetect.test.ts`
Expected: PASS (2 tests), with no GLib import error.

- [ ] **Step 7: Commit** (skip if not using git)

```bash
git add widget/notifications/cleanup/btime.ts widget/notifications/cleanup/bootDetect.ts widget/notifications/cleanup/bootDetect.test.ts
git commit -m "feat(notif): real-boot detection via btime"
```

---

## Task 8: Cleanup partition helpers (pure)

**Files:**
- Create: `widget/notifications/cleanup/partitions.ts`
- Test: `widget/notifications/cleanup/partitions.test.ts`

These operate on a minimal `{ timestamp, meta }` shape so they stay pure and decoupled from the full `StoredNotification`.

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/cleanup/partitions.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { keepAfterBoot, keepUnexpired, keepWithin7Days, SEVEN_DAYS_MS } from "./partitions.ts"

const mk = (over: any) => ({
  timestamp: 0,
  meta: { lifetime: "persistent", clearOnBoot: false, noHistory: false, muteAudio: false, dontShow: false, dedupKey: "k", conditions: [], matchedRules: [], ...over.meta },
  ...over,
})

test("keepAfterBoot drops clearOnBoot and expired-timed", () => {
  const items = [
    mk({ meta: { clearOnBoot: true } }),
    mk({ meta: { lifetime: "timed", expiresAt: 500 } }),
    mk({ meta: { lifetime: "persistent" } }),
  ]
  const kept = items.filter(n => keepAfterBoot(n, 1000))
  assert.equal(kept.length, 1)
})

test("keepUnexpired drops timed whose expiresAt passed", () => {
  assert.equal(keepUnexpired(mk({ meta: { lifetime: "timed", expiresAt: 500 } }), 1000), false)
  assert.equal(keepUnexpired(mk({ meta: { lifetime: "timed", expiresAt: 2000 } }), 1000), true)
  assert.equal(keepUnexpired(mk({ meta: { lifetime: "persistent" } }), 1000), true)
})

test("keepWithin7Days drops older than 7 days", () => {
  const now = SEVEN_DAYS_MS + 10
  assert.equal(keepWithin7Days(mk({ timestamp: 5 }), now), false)
  assert.equal(keepWithin7Days(mk({ timestamp: now }), now), true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/cleanup/partitions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// widget/notifications/cleanup/partitions.ts
// Pure predicates for cleanup. `true` = keep the notification.
import type { NotifMeta } from "../rules/types.ts"

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

interface Cleanable { timestamp: number; meta: NotifMeta }

export function keepUnexpired(n: Cleanable, now: number): boolean {
  if (n.meta.lifetime === "timed" && n.meta.expiresAt !== undefined) return n.meta.expiresAt > now
  return true
}

export function keepWithin7Days(n: Cleanable, now: number): boolean {
  return now - n.timestamp < SEVEN_DAYS_MS
}

/** Deep-clean predicate run once per real boot. */
export function keepAfterBoot(n: Cleanable, now: number): boolean {
  if (n.meta.clearOnBoot) return false
  if (!keepUnexpired(n, now)) return false
  if (!keepWithin7Days(n, now)) return false
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/cleanup/partitions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (skip if not using git)

```bash
git add widget/notifications/cleanup/partitions.ts widget/notifications/cleanup/partitions.test.ts
git commit -m "feat(notif): pure cleanup partition predicates"
```

---

## Task 9: Rules store (load/save + reactive index) — manual verification

**Files:**
- Create: `widget/notifications/rules/rulesStore.ts`

This is GJS/GLib-bound; no `node --test`. Verify via `ags run`.

- [ ] **Step 1: Write the module**

```ts
// widget/notifications/rules/rulesStore.ts
// Loads built-in rules + user rules/overrides from config/notif-rules.json, exposes a
// reactive compiled index. Editing/disabling a builtin = an override entry keyed by builtin id.
import { createState } from "ags"
import GLib from "gi://GLib"
import type { NotifRule } from "./types.ts"
import { BUILTIN_RULES } from "./defaults.ts"
import { compileRules, type RuleIndex } from "./engine.ts"

const RULES_PATH = `${GLib.get_user_config_dir()}/ags/config/notif-rules.json`

interface RulesFile {
  userRules: NotifRule[]
  builtinOverrides: Record<string, Partial<NotifRule>> // keyed by builtin id
}

function loadFile(): RulesFile {
  try {
    const [ok, content] = GLib.file_get_contents(RULES_PATH)
    if (ok) {
      const data = JSON.parse(new TextDecoder().decode(content))
      return { userRules: data.userRules ?? [], builtinOverrides: data.builtinOverrides ?? {} }
    }
  } catch (e) { console.error("[notif] loadFile failed:", e) }
  return { userRules: [], builtinOverrides: {} }
}

let saveTimer: number | null = null
function scheduleSave(file: RulesFile): void {
  if (saveTimer !== null) GLib.source_remove(saveTimer)
  saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
    try {
      const dir = GLib.path_get_dirname(RULES_PATH)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
      GLib.file_set_contents(RULES_PATH, JSON.stringify(file, null, 2))
    } catch (e) { console.error("[notif] save rules failed:", e) }
    saveTimer = null
    return GLib.SOURCE_REMOVE
  })
}

/** Compose builtin seeds (with overrides applied) + user rules into one list. */
function composeRules(file: RulesFile): NotifRule[] {
  const builtins = BUILTIN_RULES.map(b => {
    const ov = file.builtinOverrides[b.id]
    return ov ? { ...b, ...ov, effects: { ...b.effects, ...(ov.effects ?? {}) }, match: { ...b.match, ...(ov.match ?? {}) } } : b
  })
  return [...builtins, ...file.userRules]
}

const initialFile = loadFile()

// Reactive: the full rule list and the compiled index.
export const [rulesFile, setRulesFile] = createState<RulesFile>(initialFile)
export const [ruleIndex, setRuleIndex] = createState<RuleIndex>(compileRules(composeRules(initialFile)))

function recompile(file: RulesFile): void {
  setRulesFile(file)
  setRuleIndex(compileRules(composeRules(file)))
  scheduleSave(file)
}

export function allRules(): NotifRule[] { return composeRules(rulesFile.get()) }

export function upsertUserRule(rule: NotifRule): void {
  const f = rulesFile.get()
  const idx = f.userRules.findIndex(r => r.id === rule.id)
  const userRules = idx >= 0
    ? [...f.userRules.slice(0, idx), rule, ...f.userRules.slice(idx + 1)]
    : [...f.userRules, rule]
  recompile({ ...f, userRules })
}

export function removeUserRule(id: string): void {
  const f = rulesFile.get()
  recompile({ ...f, userRules: f.userRules.filter(r => r.id !== id) })
}

export function setBuiltinOverride(id: string, patch: Partial<NotifRule>): void {
  const f = rulesFile.get()
  recompile({ ...f, builtinOverrides: { ...f.builtinOverrides, [id]: patch } })
}

export function clearBuiltinOverride(id: string): void {
  const f = rulesFile.get()
  const { [id]: _, ...rest } = f.builtinOverrides
  recompile({ ...f, builtinOverrides: rest })
}
```

- [ ] **Step 2: Manual verification**

Run: `ags run ~/.config/ags/app.ts`
Expected: shell starts with no errors referencing `rulesStore`. (No behavioral change yet — `ingest` wiring comes next.) Stop with Ctrl-C.

- [ ] **Step 3: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/rulesStore.ts
git commit -m "feat(notif): reactive rules store with builtin overrides"
```

---

## Task 10: Condition provider registry + providers — manual verification

**Files:**
- Create: `widget/notifications/rules/conditions.ts`

- [ ] **Step 1: Write the module**

```ts
// widget/notifications/rules/conditions.ts
// Registry of dynamic condition providers (the "flash" resolvers). A provider watches a stored
// notification and calls resolve() when the condition is met; the notification is then removed.
import AstalBattery from "gi://AstalBattery"
import type { StoredNotification } from "../store.ts"

export interface ConditionProvider {
  name: string
  watch(notif: StoredNotification, resolve: () => void): () => void // returns disposer
}

const registry = new Map<string, ConditionProvider>()
export function registerCondition(p: ConditionProvider): void { registry.set(p.name, p) }
export function getCondition(name: string): ConditionProvider | undefined { return registry.get(name) }

// battery-resolved: remove a low-battery notification once battery percentage rises.
registerCondition({
  name: "battery-resolved",
  watch(_notif, resolve) {
    const bat = AstalBattery.get_default()
    const baseline = bat.percentage
    const handler = bat.connect("notify::percentage", () => {
      if (bat.percentage > baseline) resolve()
    })
    return () => bat.disconnect(handler)
  },
})

// superseded: resolved imperatively by ingest when a newer notif with the same dedupKey arrives.
// Registered as a no-op watcher so the name is known; ingest handles the actual removal.
registerCondition({
  name: "superseded",
  watch(_notif, _resolve) { return () => {} },
})

// Hook for future, currently-infeasible conditions (e.g. "update-applied"): register as no-op
// so rules can reference them without error; implement when feasible.
registerCondition({ name: "update-applied", watch() { return () => {} } })
```

- [ ] **Step 2: Manual verification**

Run: `ags run ~/.config/ags/app.ts`
Expected: starts without errors. Stop with Ctrl-C.

- [ ] **Step 3: Commit** (skip if not using git)

```bash
git add widget/notifications/rules/conditions.ts
git commit -m "feat(notif): condition provider registry (battery/superseded)"
```

---

## Task 11: Extend store + single ingest funnel — manual verification

**Files:**
- Modify: `widget/notifications/store.ts`
- Create: `widget/notifications/ingest.ts`
- Modify: `widget/notifications/NotificationPopup.tsx`

- [ ] **Step 1: Add `meta` to `StoredNotification` and a default-meta helper in `store.ts`**

In `widget/notifications/store.ts`, modify the `StoredNotification` interface (around line 14-25) to add `meta`:

```ts
import type { NotifMeta } from "./rules/types.ts"

export interface StoredNotification {
  id: number
  appName: string
  appIcon: string
  summary: string
  body: string
  timestamp: number
  read: boolean
  urgency: number
  actions: { id: string; label: string }[]
  image?: string
  meta: NotifMeta
}
```

Add a fallback meta for old persisted notifications loaded without one. In `loadStore()` (around line 37-49), map loaded notifications to ensure `meta` exists:

```ts
const DEFAULT_META: NotifMeta = {
  lifetime: "persistent", clearOnBoot: false, noHistory: false,
  muteAudio: false, dontShow: false, dedupKey: "", conditions: [], matchedRules: [],
}

function withMeta(n: any): StoredNotification {
  return { ...n, meta: n.meta ?? { ...DEFAULT_META, dedupKey: `${(n.appName ?? "").toLowerCase()} ${(n.summary ?? "").toLowerCase()}` } }
}
```

And in `loadStore`, change `notifications: data.notifications ?? []` to `notifications: (data.notifications ?? []).map(withMeta)`.

- [ ] **Step 2: Add a `replaceNotifications` helper to `store.ts` for cleanup to use**

Append to `store.ts`:

```ts
/** Replace the entire active list (used by the cleanup engine). */
export function replaceNotifications(next: StoredNotification[]): void {
  setNotifications(next)
  scheduleStoreSave()
}
```

- [ ] **Step 3: Write `ingest.ts`**

```ts
// widget/notifications/ingest.ts
// Single entry point for incoming notifications: classify via rules → apply on-receive cleanup
// (suppress, dedup) → store → schedule dynamic conditions. The popup/daemon calls only this.
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
import { notifications, setNotifications, removeNotification, scheduleStoreSave, type StoredNotification } from "./store.ts"
import { ruleIndex } from "./rules/rulesStore.ts"
import { evaluate } from "./rules/engine.ts"
import { getCondition } from "./rules/conditions.ts"
import type { NotifInput } from "./rules/types.ts"

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
  const input: NotifInput = {
    appName: n.app_name || "Sistema",
    summary: n.summary || "",
    body: n.body || "",
    urgency: n.urgency ?? 1,
  }
  const { meta, suppress } = evaluate(input, ruleIndex.get(), Date.now())
  if (suppress) return null

  const stored: StoredNotification = {
    id: n.id,
    appName: input.appName,
    appIcon: n.app_icon || "",
    summary: input.summary,
    body: input.body,
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
  scheduleConditions(stored)

  return stored.meta.dontShow ? null : stored
}
```

> `scheduleStoreSave` is currently a private function in `store.ts`. Export it: change `function scheduleStoreSave()` to `export function scheduleStoreSave()`.

- [ ] **Step 4: Export `scheduleStoreSave` and `setNotifications` from `store.ts`**

In `store.ts`, ensure `export function scheduleStoreSave()` (add `export`). `setNotifications` and `notifications` are already exported via `createState` destructuring at line 77 — confirm `notifications` and `setNotifications` are exported (they are: `export const [notifications, setNotifications] = ...`).

- [ ] **Step 5: Wire `NotificationPopup.tsx` to call `ingest`**

In `widget/notifications/NotificationPopup.tsx`, replace the `notified` handler (lines ~237-260) with:

```tsx
import { ingest } from "./ingest.ts"
// ... keep other imports; remove the now-unused inline StoredNotification build.

notifd.connect("notified", (_self, id) => {
  const n = notifd.get_notification(id)
  if (!n) return
  const stored = ingest(n)
  if (!stored) return            // suppressed or dontShow
  if (notifd.dontDisturb) return
  addPopup(stored)
  scheduleAutoDismiss(id)
})
```

Remove the now-dead `addNotification`/`appSettings.muted` import usage in this handler (the engine handles muting via `dontShow`/`suppress`).

- [ ] **Step 6: Manual verification**

Run: `ags run ~/.config/ags/app.ts`
Then trigger test notifications and observe:

```bash
notify-send "Captura de pantalla" "test"      # should NOT appear (suppressed)
notify-send "Hola" "mensaje normal"           # should appear as popup + in panel
notify-send "Hola" "otro mensaje"             # should DEDUP: replaces previous "Hola" in panel
```

Expected: screenshot suppressed; normal notification shows; second "Hola" (same app+summary) collapses the first in the panel. Open the panel and confirm. Stop with Ctrl-C.

- [ ] **Step 7: Commit** (skip if not using git)

```bash
git add widget/notifications/store.ts widget/notifications/ingest.ts widget/notifications/NotificationPopup.tsx
git commit -m "feat(notif): single ingest funnel with classify + dedup"
```

---

## Task 12: Cleanup engine orchestration (boot deep-clean + periodic sweep) — manual verification

**Files:**
- Create: `widget/notifications/cleanup/cleanupEngine.ts`
- Modify: `widget/notifications/store.ts` (call boot clean on load) OR `app.ts` (init). Use `cleanupEngine` init from `ingest`/store import side-effect.

- [ ] **Step 1: Write the cleanup engine**

```ts
// widget/notifications/cleanup/cleanupEngine.ts
// Orchestrates cleanup: a one-time deep clean on real boot, and a periodic sweep of expired/old.
import GLib from "gi://GLib"
import { notifications, replaceNotifications } from "../store.ts"
import { isNewBoot, markSwept } from "./bootDetect.ts"
import { keepAfterBoot, keepUnexpired, keepWithin7Days } from "./partitions.ts"

let started = false

function periodicSweep(): void {
  const now = Date.now()
  const kept = notifications.get().filter(n => keepUnexpired(n, now) && keepWithin7Days(n, now))
  if (kept.length !== notifications.get().length) replaceNotifications(kept)
  markSwept(now)
}

/** Call once at startup (e.g. from app.ts main or a store import). Idempotent. */
export function startCleanupEngine(): void {
  if (started) return
  started = true

  // Deep clean once per real boot.
  if (isNewBoot()) {
    const now = Date.now()
    const kept = notifications.get().filter(n => keepAfterBoot(n, now))
    replaceNotifications(kept)
    console.log(`[notif] boot deep-clean: kept ${kept.length}`)
  }

  // Initial sweep + every 60s thereafter.
  periodicSweep()
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60_000, () => { periodicSweep(); return GLib.SOURCE_CONTINUE })
}
```

- [ ] **Step 2: Call `startCleanupEngine()` from `app.ts` main**

In `app.ts`, add the import and call inside `main()` (after the window registrations is fine):

```ts
import { startCleanupEngine } from "./widget/notifications/cleanup/cleanupEngine"
// ... inside main():
startCleanupEngine()
```

- [ ] **Step 3: Manual verification (boot clean is hard to test without rebooting; verify sweep + no errors)**

Run: `ags run ~/.config/ags/app.ts`
Expected: log line `[notif] boot deep-clean: kept N` appears only if this is the first AGS start since a real reboot (likely on first run after editing the marker; on subsequent `ags run` within the same boot it does NOT appear). No errors. Trigger a crash-style notification and confirm it stays this session:

```bash
notify-send "App crasheada" "Proceso: python3 (coredump)"
```

Expected: appears in panel now; it will be removed on the NEXT real reboot (clear-on-boot). To sanity-check the marker logic without rebooting: delete `config/notif-cleanup-state.json`, restart AGS, and confirm the deep-clean log line appears (simulates a new boot). Stop with Ctrl-C.

- [ ] **Step 4: Run the full pure test suite one more time**

Run: `node --test 'widget/notifications/rules/*.test.ts' 'widget/notifications/cleanup/*.test.ts'`
Expected: all PASS.

- [ ] **Step 5: Commit** (skip if not using git)

```bash
git add widget/notifications/cleanup/cleanupEngine.ts app.ts
git commit -m "feat(notif): boot deep-clean + periodic sweep orchestration"
```

---

## Phase 1 done — what works now

- Every incoming notification is classified once by the rule engine; metadata is stored with it.
- Built-in rules handle screenshots (suppressed), crashes/reboots (clear-on-boot), low battery (flash + battery-resolved), WhatsApp (timed 2-day, dedup).
- Active-list dedup collapses same-dedupKey notifications.
- Real-boot deep clean (btime marker) wipes clear-on-boot + expired + >7-day; a 60s sweep removes expired/old during the session.
- Rules + builtin overrides persist in `config/notif-rules.json` (editable by hand for now; UI is Phase 3).

## Deferred to later plans

- **Phase 2:** `history/historyStore.ts` — separate 500-unique store, dedup, exclude notifications that match any rule (`meta.matchedRules.length > 0`), trim at 500 / on settings open.
- **Phase 3:** Settings UI — `settings/` tabs (Apps / Historial / Reglas) + `RuleEditor`, plus one-time `appSettings` → rules migration.

## Self-review notes (addressed)

- **Spec coverage:** metadata model ✓ (Task 1/5), rule engine ✓ (4/5), built-ins/system cases ✓ (6), boot detection = real boot ✓ (7), clear-on-boot/expiry/7-day cleanup ✓ (8/12), dedup default app+summary + per-rule ✓ (3/5), conditions registry (battery/superseded + hook) ✓ (10), single ingest funnel removing the double-build ✓ (11). History (Phase 2) and UI (Phase 3) intentionally deferred.
- **Type consistency:** `evaluate(input, index, now)` and `compileRules` signatures match across Tasks 4/5/6/11; `NotifMeta`/`StoredNotification.meta` consistent across Tasks 1/8/11/12; `replaceNotifications`, `scheduleStoreSave`, `ruleIndex`, `getCondition` referenced match their definitions.
- **GLib-in-tests pitfall:** explicitly handled by splitting `btime.ts` (Task 7) from `bootDetect.ts`; all pure test files import only pure modules.
