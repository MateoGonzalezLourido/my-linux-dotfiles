# Notification Cleanup — Phase 4 (Text-rewrite rules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a rule effect that rewrites a notification's **title** and/or **body** from a plain-text template with `{field}` placeholders referencing the notification's own data (e.g. `"hola que tal {summary}"`). Unknown `{placeholders}` are printed literally. The set of available fields is defined in ONE place and surfaced to the user in the rule editor.

**Architecture:** A pure template engine (`{key}` → value, unknown key → literal) plus a single source-of-truth field extractor (`buildNotifFields` + `NOTIF_FIELDS`). The rule engine folds a new `rewrite` effect; `ingest` applies the templates against the ORIGINAL notification fields when building the stored notification. Rewriting does NOT affect matching or dedup (those use original text). Editor gets a "Reescribir texto" section listing the available placeholders. Builds on Phases 1-3.

**Tech Stack:** TypeScript, AGS v2 (Astal)/GJS, GTK4. Pure logic tested with Node v26 (`node --test`); UI verified with `ags bundle`.

---

## Environment notes (read first)

- Tests: `node --test <file>` or quoted glob. NEVER `node --test <dir>` (broken in Node v26).
- Pure modules + tests MUST NOT import `gi://*` or `ags`. New pure modules: `rules/template.ts`, `rules/notifFields.ts`. The `.tsx` editor change is GJS (not node-tested).
- Local imports use explicit `.ts`/`.tsx` extensions.
- TS subset for pure modules: no `enum`, `namespace`, constructor parameter-properties.
- **No git. SKIP all "Commit" steps.** Do NOT run `ags run` (live instance exists). Controller verifies UI with `ags bundle app.ts <out>`.

## Existing context

- `widget/notifications/rules/types.ts` — `EffectSpec` (effects), `EvalResult` (`{ meta, suppress }`), `NotifInput`.
- `widget/notifications/rules/engine.ts` — `evaluate(input, index, now)` folds effects via `setOnce` (high→low). Add rewrite folding here.
- `widget/notifications/ingest.ts` — builds `input` from the live `AstalNotifd.Notification` `n` and constructs `stored`. `n` structurally has `app_name`, `summary`, `body`, `urgency`.
- `widget/notifications/settings/RuleEditor.tsx` — form editor; `patchEffects(p)` merges into `draft.effects`.
- `widget/notifications/settings/ruleFactory.ts` — `summarizeRule`.

## File structure (Phase 4)

Create (pure):
- `widget/notifications/rules/template.ts` — `applyTemplate`.
- `widget/notifications/rules/notifFields.ts` — `RawNotif`, `NOTIF_FIELDS`, `buildNotifFields`.

Modify:
- `widget/notifications/rules/types.ts` — `EffectSpec.rewrite`, `EvalResult.rewrite`.
- `widget/notifications/rules/engine.ts` — fold `rewrite`, return on result.
- `widget/notifications/ingest.ts` — apply rewrite when building `stored`.
- `widget/notifications/settings/RuleEditor.tsx` — "Reescribir texto" section.
- `widget/notifications/settings/ruleFactory.ts` — mention rewrite in `summarizeRule`.

---

## Task 1: Template engine (pure)

**Files:**
- Create: `widget/notifications/rules/template.ts`
- Test: `widget/notifications/rules/template.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/rules/template.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyTemplate } from "./template.ts"

const f = { app: "WhatsApp", summary: "usuario1", body: "hola", urgency: "1" }

test("replaces known placeholders", () => {
  assert.equal(applyTemplate("hola que tal {summary}", f), "hola que tal usuario1")
})

test("multiple placeholders", () => {
  assert.equal(applyTemplate("{app}: {summary} — {body}", f), "WhatsApp: usuario1 — hola")
})

test("unknown placeholder left literal", () => {
  assert.equal(applyTemplate("hey {nope} {summary}", f), "hey {nope} usuario1")
})

test("no placeholders is unchanged", () => {
  assert.equal(applyTemplate("texto plano", f), "texto plano")
})

test("empty-value field replaces with empty string", () => {
  assert.equal(applyTemplate("[{body}]", { body: "" }), "[]")
})

test("braces without word chars are left literal", () => {
  assert.equal(applyTemplate("a {} {1x} b", f), "a {} {1x} b")
})
```

> Note: `{1x}` starts with a digit; the regex `\{(\w+)\}` matches it as key "1x" which is not in `f`, so it stays literal — consistent with "unknown → literal".

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/rules/template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// widget/notifications/rules/template.ts
// Pure templating: replace {key} with fields[key]; unknown keys stay literal. No imports.

export function applyTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : whole,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/rules/template.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit** (skip — no git)

---

## Task 2: Notification fields (pure, single source of truth)

**Files:**
- Create: `widget/notifications/rules/notifFields.ts`
- Test: `widget/notifications/rules/notifFields.test.ts`

`NOTIF_FIELDS` (the list shown in the editor) and `buildNotifFields` (the runtime map) live together so they never drift. Adding a field later = one entry + one map line.

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/rules/notifFields.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildNotifFields, NOTIF_FIELDS } from "./notifFields.ts"

const NOON = new Date(2026, 0, 1, 9, 5).getTime()

test("builds all documented fields from a raw notification", () => {
  const out = buildNotifFields({ app_name: "WhatsApp", summary: "usuario1", body: "hola", urgency: 2 }, NOON)
  assert.equal(out.app, "WhatsApp")
  assert.equal(out.summary, "usuario1")
  assert.equal(out.body, "hola")
  assert.equal(out.urgency, "2")
  assert.equal(out.urgencyName, "urgente")
  assert.equal(out.time, "09:05")
})

test("missing fields become empty strings; urgency defaults to normal", () => {
  const out = buildNotifFields({}, NOON)
  assert.equal(out.app, "")
  assert.equal(out.summary, "")
  assert.equal(out.body, "")
  assert.equal(out.urgency, "1")
  assert.equal(out.urgencyName, "normal")
})

test("NOTIF_FIELDS keys exactly match the keys buildNotifFields produces", () => {
  const produced = Object.keys(buildNotifFields({}, NOON)).sort()
  const declared = NOTIF_FIELDS.map(f => f.key).sort()
  assert.deepEqual(declared, produced)
})

test("urgencyName maps 0→baja", () => {
  assert.equal(buildNotifFields({ urgency: 0 }, NOON).urgencyName, "baja")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/rules/notifFields.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// widget/notifications/rules/notifFields.ts
// Single source of truth for the placeholder fields available to text-rewrite templates.
// `NOTIF_FIELDS` is what the rule editor lists; `buildNotifFields` is the runtime value map.
// Keep the two in sync (one entry + one line per new field). Pure — no gi/ags imports.

/** Structural subset of AstalNotifd.Notification that we read. */
export interface RawNotif {
  app_name?: string | null
  summary?: string | null
  body?: string | null
  urgency?: number | null
}

export const NOTIF_FIELDS: { key: string; desc: string }[] = [
  { key: "app",         desc: "nombre de la app" },
  { key: "summary",     desc: "título original" },
  { key: "body",        desc: "cuerpo original" },
  { key: "urgency",     desc: "nivel (0/1/2)" },
  { key: "urgencyName", desc: "baja / normal / urgente" },
  { key: "time",        desc: "hora de llegada (HH:MM)" },
]

export function buildNotifFields(n: RawNotif, now: number): Record<string, string> {
  const u = n.urgency ?? 1
  const d = new Date(now)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return {
    app: n.app_name ?? "",
    summary: n.summary ?? "",
    body: n.body ?? "",
    urgency: String(u),
    urgencyName: u >= 2 ? "urgente" : u <= 0 ? "baja" : "normal",
    time: `${hh}:${mm}`,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/rules/notifFields.test.ts`
Expected: PASS (4 tests). The third test guards that `NOTIF_FIELDS` and `buildNotifFields` stay in sync.

- [ ] **Step 5: Commit** (skip — no git)

---

## Task 3: `rewrite` effect + engine folding

**Files:**
- Modify: `widget/notifications/rules/types.ts`
- Modify: `widget/notifications/rules/engine.ts`
- Test: `widget/notifications/rules/engine.rewrite.test.ts`

- [ ] **Step 1: Extend the types**

In `widget/notifications/rules/types.ts`, add a `rewrite` field to `EffectSpec` (place it alongside the other optional effect fields):

```ts
  // text rewriting templates (see rules/template.ts + rules/notifFields.ts)
  rewrite?: { summary?: string; body?: string }
```

And add an optional `rewrite` to `EvalResult` (the folded templates, applied later by ingest):

```ts
export interface EvalResult {
  meta: NotifMeta
  suppress: boolean
  rewrite?: { summary?: string; body?: string }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// widget/notifications/rules/engine.rewrite.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileRules, evaluate } from "./engine.ts"
import type { NotifRule, NotifInput } from "./types.ts"

const NOW = 0
const input: NotifInput = { appName: "WhatsApp", summary: "usuario1", body: "hola", urgency: 1 }
function rule(p: Partial<NotifRule>): NotifRule {
  return { id: "r", name: "r", enabled: true, priority: 0, source: "user", match: {}, effects: {}, ...p }
}

test("no rewrite rule → result.rewrite is undefined", () => {
  const r = evaluate(input, compileRules([]), NOW)
  assert.equal(r.rewrite, undefined)
})

test("rewrite summary+body templates surface on the result", () => {
  const rules = [rule({ id: "rw", effects: { rewrite: { summary: "Msg de {summary}", body: "{body}!" } } })]
  const r = evaluate(input, compileRules(rules), NOW)
  assert.deepEqual(r.rewrite, { summary: "Msg de {summary}", body: "{body}!" })
})

test("higher-priority rewrite sub-fields win set-once", () => {
  const rules = [
    rule({ id: "low", priority: 0, effects: { rewrite: { summary: "low-sum", body: "low-body" } } }),
    rule({ id: "high", priority: 10, effects: { rewrite: { summary: "high-sum" } } }),
  ]
  const r = evaluate(input, compileRules(rules), NOW)
  assert.equal(r.rewrite?.summary, "high-sum") // high wins summary
  assert.equal(r.rewrite?.body, "low-body")    // body falls through to low
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test widget/notifications/rules/engine.rewrite.test.ts`
Expected: FAIL — `rewrite` not on result / not folded.

- [ ] **Step 4: Fold `rewrite` in `evaluate`**

In `widget/notifications/rules/engine.ts`, inside `evaluate`, add two accumulators next to the existing ones (e.g. near `let dedupSpec`):

```ts
  let rewriteSummary: string | undefined
  let rewriteBody: string | undefined
```

Inside the `for (const r of matched)` fold loop, add:

```ts
    rewriteSummary = setOnce(rewriteSummary, r.effects.rewrite?.summary)
    rewriteBody    = setOnce(rewriteBody, r.effects.rewrite?.body)
```

After building `meta` (before `return`), assemble the result:

```ts
  const result: EvalResult = { meta, suppress: suppress ?? false }
  if (rewriteSummary !== undefined || rewriteBody !== undefined) {
    result.rewrite = {}
    if (rewriteSummary !== undefined) result.rewrite.summary = rewriteSummary
    if (rewriteBody !== undefined) result.rewrite.body = rewriteBody
  }
  return result
```

Replace the existing final `return { meta, suppress: suppress ?? false }` with the block above. (`EvalResult` is already imported in engine.ts.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test widget/notifications/rules/engine.rewrite.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Re-run the whole rules suite (no regressions)**

Run: `node --test 'widget/notifications/rules/*.test.ts'`
Expected: all PASS (previous rules tests + 6 template + 4 notifFields + 3 rewrite).

- [ ] **Step 7: Commit** (skip — no git)

---

## Task 4: Apply rewrite in `ingest`

**Files:**
- Modify: `widget/notifications/ingest.ts`

- [ ] **Step 1: Add imports**

At the top of `ingest.ts`, add:

```ts
import { applyTemplate } from "./rules/template.ts"
import { buildNotifFields, type RawNotif } from "./rules/notifFields.ts"
```

- [ ] **Step 2: Apply the rewrite when building `stored`**

In `ingest()`, change the destructuring of `evaluate(...)` to also capture `rewrite`, and compute the displayed text from the ORIGINAL fields. Replace:

```ts
  const { meta, suppress } = evaluate(input, ruleIndex.get(), Date.now())
  if (suppress) return null
```

with:

```ts
  const { meta, suppress, rewrite } = evaluate(input, ruleIndex.get(), Date.now())
  if (suppress) return null

  // Text rewriting: placeholders resolve against the ORIGINAL notification fields.
  let summary = input.summary
  let body = input.body
  if (rewrite) {
    const fields = buildNotifFields(n as RawNotif, Date.now())
    if (rewrite.summary !== undefined) summary = applyTemplate(rewrite.summary, fields)
    if (rewrite.body !== undefined) body = applyTemplate(rewrite.body, fields)
  }
```

Then in the `stored` object literal, change the `summary` and `body` lines to use the local variables:

```ts
    summary: summary,
    body: body,
```

(They were `summary: input.summary` / `body: input.body`. Leave `appName`, `urgency`, etc. as-is. The `dedupKey` in `meta` was already computed from the original input inside `evaluate`, so dedup is unaffected.)

- [ ] **Step 3: Controller bundle check** — `ags bundle app.ts <out>` exit 0.

- [ ] **Step 4: Commit** (skip — no git)

---

## Task 5: RuleEditor "Reescribir texto" section + summary

**Files:**
- Modify: `widget/notifications/settings/RuleEditor.tsx`
- Modify: `widget/notifications/settings/ruleFactory.ts`

- [ ] **Step 1: Add a rewrite helper + import in RuleEditor**

In `RuleEditor.tsx`, add the import:

```ts
import { NOTIF_FIELDS } from "../rules/notifFields.ts"
```

Add a helper near `patchEffects` (inside the component):

```ts
  const patchRewrite = (p: { summary?: string; body?: string }) => {
    const cur = draft.get().effects.rewrite ?? {}
    const merged = { ...cur, ...p }
    // drop empty strings; if nothing left, remove rewrite entirely
    const clean: { summary?: string; body?: string } = {}
    if (merged.summary) clean.summary = merged.summary
    if (merged.body) clean.body = merged.body
    const e = { ...draft.get().effects }
    if (clean.summary === undefined && clean.body === undefined) delete e.rewrite
    else e.rewrite = clean
    patch({ effects: e })
  }
```

- [ ] **Step 2: Add the section to the form**

In the JSX, after the dedup-key field block and before the advanced toggle, insert:

```tsx
          <label cssClasses={["re-section"]} label="Reescribir texto (opcional)" halign={Gtk.Align.START} />
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            <label cssClasses={["re-field-label"]} label="Nuevo título" halign={Gtk.Align.START} />
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.summary ?? ""}
              placeholderText="(vacío = sin cambios)"
              onChanged={(self) => patchRewrite({ summary: self.text })}
            />
            <label cssClasses={["re-field-label"]} label="Nuevo cuerpo" halign={Gtk.Align.START} />
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.body ?? ""}
              placeholderText="(vacío = sin cambios)"
              onChanged={(self) => patchRewrite({ body: self.text })}
            />
            <label
              cssClasses={["re-hint"]}
              label={`Campos: ${NOTIF_FIELDS.map(f => "{" + f.key + "}").join("  ")}`}
              halign={Gtk.Align.START}
              wrap={true}
            />
          </box>
```

- [ ] **Step 3: Mention rewrite in `summarizeRule`**

In `widget/notifications/settings/ruleFactory.ts`, inside `summarizeRule`, add to the effects list (after the `noHistory` push, before the conditions push):

```ts
  if (rule.effects.rewrite && (rule.effects.rewrite.summary || rule.effects.rewrite.body)) e.push("reescribe texto")
```

- [ ] **Step 4: Add `.re-hint` style**

In `style.scss`, near the other `.re-*` classes (append at end is fine):

```scss
.re-hint { font-size: 9px; color: rgba(226, 226, 226, 0.4); font-family: "MesloLGS Nerd Font"; }
```

- [ ] **Step 5: Controller verification**

Run: `ags bundle app.ts <out>` → exit 0.
Run: `node --test 'widget/notifications/rules/*.test.ts' 'widget/notifications/settings/*.test.ts'` → all PASS (summarizeRule tests still green — adding a clause doesn't break existing assertions; verify).

- [ ] **Step 6: Commit** (skip — no git)

---

## Phase 4 done — what works

- A rule can rewrite a notification's title and/or body via plain-text templates with `{field}` placeholders. Unknown placeholders print literally.
- Available fields are defined once (`NOTIF_FIELDS` + `buildNotifFields`) and listed in the editor's "Reescribir texto" section.
- Rewriting uses the original notification data and runs at ingest; matching and dedup are unaffected.

## Manual verification (user, after reload)

1. Settings → Reglas → New rule: match app = your terminal/app; under "Reescribir texto" set title `Aviso: {summary}` and body `{body} ({time})`. Save.
2. Trigger a matching notification → the popup/panel shows the rewritten text; `{unknownField}` would show literally.

## Self-review notes (addressed)

- **Field set is single-source:** `notifFields.test.ts` asserts `NOTIF_FIELDS` keys === `buildNotifFields` output keys, so the editor's hint can never drift from the runtime map.
- **Original-text semantics:** placeholders resolve against `n` (the live notification) in ingest, not the rewritten values; dedupKey was computed from original input in `evaluate`.
- **Type consistency:** `EffectSpec.rewrite` and `EvalResult.rewrite` share shape `{ summary?: string; body?: string }`; engine folds sub-fields set-once (high→low) like other effects; ingest consumes `result.rewrite`.
- **Pure/testable:** `template.ts` and `notifFields.ts` import nothing impure; their tests run under plain node.
