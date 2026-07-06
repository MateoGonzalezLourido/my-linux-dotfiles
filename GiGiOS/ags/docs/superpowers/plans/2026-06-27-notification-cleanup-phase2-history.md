# Notification Cleanup — Phase 2 (History store) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a separate, persistent **history** of unique notification "types" (capped at 500), deduped by `dedupKey`, that **excludes** any notification matched by a rule — so history shows only notification types the user hasn't configured yet. This is the data source the Phase 3 settings UI consumes.

**Architecture:** Pure history logic (upsert/trim/collapse/rule-exclusion) in a dependency-free module unit-tested with `node --test`; a thin GJS persistence + reactive wrapper; one call wired into the existing `ingest()` funnel; a `cleanHistory()` maintenance pass triggered when the settings panel opens. Builds on Phase 1 (`docs/superpowers/plans/2026-06-27-notification-cleanup-phase1-core.md`) and the spec (`docs/superpowers/specs/2026-06-27-notification-cleanup-system-design.md`).

**Tech Stack:** TypeScript, AGS v2 (Astal)/GJS, GLib. Tests on Node v26 (`node --test`).

---

## Environment notes (read first)

- **Tests:** `node --test <file>`. For several files use a quoted glob: `node --test 'widget/notifications/history/*.test.ts'`. `node --test <dir>` does NOT work in Node v26 (loads the dir as a module).
- Pure modules + test files MUST NOT import `gi://*` or `ags`. `historyLogic.ts` is pure; `historyStore.ts` is GJS-bound (not node-tested).
- Local imports between project `.ts` files use the explicit `.ts` extension (the repo already relies on this; `ags bundle` resolves it).
- TS subset for pure modules: no `enum`, `namespace`, or constructor parameter-properties.
- **No git in this repo. SKIP every "Commit" step.**
- **No competing GUI:** Do NOT run `ags run` (a live instance exists). Verify the full app still compiles with `ags bundle app.ts <outfile>` (exit 0 = module graph + syntax OK). The controller runs the bundle check.

## Existing context this builds on

- `widget/notifications/ingest.ts` exports `ingest(n)` and is the single funnel. After it stores a notification into the active list it currently does NOT touch history — Task 5 adds that.
- `widget/notifications/store.ts` exports `StoredNotification` (with required `meta: NotifMeta`) and the reactive `notifSettingsVisible` state (toggled by the existing settings button).
- `widget/notifications/rules/rulesStore.ts` exports the reactive `ruleIndex` (`ruleIndex.get()` → `RuleIndex`).
- `widget/notifications/rules/engine.ts` exports `evaluate(input, index, now)` → `{ meta, suppress }`; `meta.matchedRules` is the list of rule ids that matched.
- A notification's `meta.matchedRules.length === 0` means "no rule touched it" → it belongs in history.

## File structure (Phase 2)

Create:
- `widget/notifications/history/historyLogic.ts` — pure: types + `shouldIndex`, `upsertEntry`, `trimByRecency`, `collapseDuplicates`, `applyRuleExclusion`.
- `widget/notifications/history/historyStore.ts` — GJS: load/save `config/notif-history.json`, reactive `historyEntries`, `recordNotification(stored)`, `cleanHistory()`, settings-open subscription.
- Test: `widget/notifications/history/historyLogic.test.ts`.

Modify:
- `widget/notifications/ingest.ts` — call `recordNotification(stored)` after storing.

---

## Task 1: History types + `shouldIndex`

**Files:**
- Create: `widget/notifications/history/historyLogic.ts`
- Test: `widget/notifications/history/historyLogic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/history/historyLogic.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldIndex, HISTORY_CAP } from "./historyLogic.ts"

test("HISTORY_CAP is 500", () => {
  assert.equal(HISTORY_CAP, 500)
})

test("shouldIndex true only when no rule matched", () => {
  assert.equal(shouldIndex({ dedupKey: "k", app: "a", summary: "s", body: "b", appIcon: "", matchedRulesCount: 0 }), true)
  assert.equal(shouldIndex({ dedupKey: "k", app: "a", summary: "s", body: "b", appIcon: "", matchedRulesCount: 1 }), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/history/historyLogic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/history/historyLogic.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit** (skip — no git)

---

## Task 2: `upsertEntry` + `trimByRecency`

**Files:**
- Modify: `widget/notifications/history/historyLogic.ts`
- Test: `widget/notifications/history/historyLogic.upsert.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/history/historyLogic.upsert.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { upsertEntry, trimByRecency, type HistoryEntry, type HistoryInput } from "./historyLogic.ts"

function input(over: Partial<HistoryInput> = {}): HistoryInput {
  return { dedupKey: "whatsapp usuario1", app: "WhatsApp", summary: "usuario1", body: "hola", appIcon: "ic", matchedRulesCount: 0, ...over }
}

test("adds a new entry with count 1", () => {
  const out = upsertEntry([], input(), 1000, 500)
  assert.equal(out.length, 1)
  assert.equal(out[0].count, 1)
  assert.equal(out[0].firstSeen, 1000)
  assert.equal(out[0].lastSeen, 1000)
  assert.equal(out[0].dedupKey, "whatsapp usuario1")
})

test("increments count and updates lastSeen/body for same dedupKey", () => {
  const first = upsertEntry([], input({ body: "hola" }), 1000, 500)
  const second = upsertEntry(first, input({ body: "adios" }), 2000, 500)
  assert.equal(second.length, 1)
  assert.equal(second[0].count, 2)
  assert.equal(second[0].firstSeen, 1000)
  assert.equal(second[0].lastSeen, 2000)
  assert.equal(second[0].sampleBody, "adios")
})

test("matched-rule input removes existing entry and never adds", () => {
  const first = upsertEntry([], input(), 1000, 500)
  const ruled = upsertEntry(first, input({ matchedRulesCount: 1 }), 2000, 500)
  assert.equal(ruled.length, 0)
})

test("matched-rule input on absent dedupKey returns the SAME array reference (no-op)", () => {
  const entries: HistoryEntry[] = []
  const out = upsertEntry(entries, input({ dedupKey: "other", matchedRulesCount: 2 }), 1000, 500)
  assert.equal(out, entries)
})

test("trims to cap keeping most recent by lastSeen", () => {
  const entries: HistoryEntry[] = []
  const e = (k: string, t: number): HistoryEntry => ({ dedupKey: k, app: "a", summary: k, sampleBody: "", appIcon: "", count: 1, firstSeen: t, lastSeen: t })
  const list = [e("a", 1), e("b", 2), e("c", 3)]
  const out = trimByRecency(list, 2)
  assert.deepEqual(out.map(x => x.dedupKey), ["c", "b"])
})

test("trimByRecency returns input unchanged when under cap", () => {
  const list: HistoryEntry[] = [{ dedupKey: "a", app: "a", summary: "", sampleBody: "", appIcon: "", count: 1, firstSeen: 1, lastSeen: 1 }]
  assert.equal(trimByRecency(list, 500), list)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/history/historyLogic.upsert.test.ts`
Expected: FAIL — `upsertEntry`/`trimByRecency` not exported.

- [ ] **Step 3: Append implementation to `historyLogic.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/history/historyLogic.upsert.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit** (skip — no git)

---

## Task 3: `collapseDuplicates` + `applyRuleExclusion`

**Files:**
- Modify: `widget/notifications/history/historyLogic.ts`
- Test: `widget/notifications/history/historyLogic.clean.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/history/historyLogic.clean.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { collapseDuplicates, applyRuleExclusion, type HistoryEntry } from "./historyLogic.ts"

const e = (over: Partial<HistoryEntry>): HistoryEntry => ({
  dedupKey: "k", app: "a", summary: "s", sampleBody: "b", appIcon: "", count: 1, firstSeen: 0, lastSeen: 0, ...over,
})

test("collapseDuplicates merges same dedupKey: sums count, widens time span, keeps newest text", () => {
  const out = collapseDuplicates([
    e({ dedupKey: "k", count: 2, firstSeen: 10, lastSeen: 20, summary: "old", sampleBody: "oldbody" }),
    e({ dedupKey: "k", count: 3, firstSeen: 5, lastSeen: 50, summary: "new", sampleBody: "newbody" }),
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].count, 5)
  assert.equal(out[0].firstSeen, 5)
  assert.equal(out[0].lastSeen, 50)
  assert.equal(out[0].summary, "new")
  assert.equal(out[0].sampleBody, "newbody")
})

test("collapseDuplicates keeps distinct keys", () => {
  const out = collapseDuplicates([e({ dedupKey: "a" }), e({ dedupKey: "b" })])
  assert.equal(out.length, 2)
})

test("applyRuleExclusion drops entries the predicate flags", () => {
  const out = applyRuleExclusion(
    [e({ dedupKey: "keep" }), e({ dedupKey: "drop" })],
    (x) => x.dedupKey === "drop",
  )
  assert.deepEqual(out.map(x => x.dedupKey), ["keep"])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/history/historyLogic.clean.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Append implementation to `historyLogic.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/history/historyLogic.clean.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole history suite**

Run: `node --test 'widget/notifications/history/*.test.ts'`
Expected: all PASS (11 tests total across the three files).

- [ ] **Step 6: Commit** (skip — no git)

---

## Task 4: History store (GJS, persistence + reactive + maintenance)

**Files:**
- Create: `widget/notifications/history/historyStore.ts`

GJS-bound; no node test. Verified statically + by `ags bundle` at the end.

- [ ] **Step 1: Write the module**

```ts
// widget/notifications/history/historyStore.ts
// Persistent, reactive history of unique notification types (capped). Excludes anything a rule
// matched. Populated from ingest; re-cleaned when the settings panel opens.
import { createState } from "ags"
import GLib from "gi://GLib"
import type { StoredNotification } from "../store.ts"
import { notifSettingsVisible } from "../store.ts"
import { ruleIndex } from "../rules/rulesStore.ts"
import { evaluate } from "../rules/engine.ts"
import {
  type HistoryEntry, type HistoryInput, HISTORY_CAP,
  upsertEntry, collapseDuplicates, trimByRecency, applyRuleExclusion,
} from "./historyLogic.ts"

const HISTORY_PATH = `${GLib.get_user_config_dir()}/ags/config/notif-history.json`

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
    try {
      const dir = GLib.path_get_dirname(HISTORY_PATH)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
      GLib.file_set_contents(HISTORY_PATH, JSON.stringify({ entries: historyEntries.get() }))
    } catch (e) { console.error("[notif] save history failed:", e) }
    saveTimer = null
    return GLib.SOURCE_REMOVE
  })
}

export const [historyEntries, setHistoryEntries] = createState<HistoryEntry[]>(loadHistory())

/** Record an incoming (already-stored) notification into history. No-op if a rule matched it. */
export function recordNotification(n: StoredNotification): void {
  const input: HistoryInput = {
    dedupKey: n.meta.dedupKey,
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
```

> Note: `cleanHistory` re-evaluates each entry with `urgency: 1` (history doesn't retain the original urgency). Urgency-only rules therefore won't be re-applied during cleanup — acceptable; on-receive exclusion already handled them via `recordNotification`.

- [ ] **Step 2: Static checks**

Confirm local imports resolve: `../store.ts` (exports `StoredNotification`, `notifSettingsVisible`), `../rules/rulesStore.ts` (`ruleIndex`), `../rules/engine.ts` (`evaluate`), `./historyLogic.ts` (all named exports). Grep each export exists.

- [ ] **Step 3: Commit** (skip — no git)

---

## Task 5: Wire history into the ingest funnel

**Files:**
- Modify: `widget/notifications/ingest.ts`

- [ ] **Step 1: Add the import**

At the top of `ingest.ts`, after the existing imports, add:

```ts
import { recordNotification } from "./history/historyStore.ts"
```

- [ ] **Step 2: Call `recordNotification` after the active-list store**

In `ingest()`, immediately after the existing `scheduleStoreSave()` line and before `scheduleConditions(stored)`, add `recordNotification(stored)`. The block becomes:

```ts
  setNotifications(next)
  scheduleStoreSave()
  recordNotification(stored)
  scheduleConditions(stored)

  return stored.meta.dontShow ? null : stored
```

(Note: suppressed and muted notifications already returned earlier, so they never reach history. `recordNotification` itself skips anything a rule matched.)

- [ ] **Step 3: Verify the module graph compiles (controller does this)**

Run: `ags bundle app.ts /tmp/phase2-bundle-check.js`
Expected: exit 0, output file written, no errors.

- [ ] **Step 4: Re-run the full pure test suite**

Run: `node --test 'widget/notifications/rules/*.test.ts' 'widget/notifications/cleanup/*.test.ts' 'widget/notifications/history/*.test.ts'`
Expected: all PASS.

- [ ] **Step 5: Commit** (skip — no git)

---

## Phase 2 done — what works now

- Every ingested notification with **no matching rule** is recorded in `config/notif-history.json` as a unique entry keyed by `dedupKey`, with a hit `count` and first/last-seen timestamps.
- Notifications that match **any** rule are kept OUT of history (and any stale entry is removed on next sighting).
- History is capped at 500 (oldest-by-lastSeen dropped) and re-cleaned (collapse + rule-exclusion + trim) whenever the settings panel opens.

## Deferred to Phase 3

- Settings UI tabs (Apps / Historial / Reglas) + `RuleEditor`, which read `historyEntries` and `allRules()`, and `appSettings` → rules migration.

## Self-review notes (addressed)

- **Spec coverage:** separate store ✓ (Task 4), unique-by-dedupKey + count ✓ (Task 2), exclude rule-matched ✓ (`shouldIndex` Task 1 + `applyRuleExclusion` Task 3), cap 500 + trim ✓ (Task 2), re-clean on settings open ✓ (Task 4 subscription), noHistory: subsumed by rule-exclusion (anything with `noHistory` matched a rule → `matchedRulesCount > 0`).
- **Type consistency:** `HistoryEntry`/`HistoryInput`/`HISTORY_CAP` and the function signatures (`upsertEntry(entries, input, now, cap)`, `trimByRecency(entries, cap)`, `collapseDuplicates(entries)`, `applyRuleExclusion(entries, pred)`) match across Tasks 1-5; `recordNotification(StoredNotification)` maps `meta.matchedRules.length` → `matchedRulesCount`.
- **Purity:** `historyLogic.ts` imports nothing; its tests import only it. `historyStore.ts` holds all GJS/`ags` deps.
