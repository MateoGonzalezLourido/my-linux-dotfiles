# Notification Cleanup — Phase 3 (Settings UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the single-purpose notification settings subpanel with a 3-tab UI — **Apps**, **Historial**, **Reglas** — that lets the user view notification types they haven't configured, see/edit ALL rules (built-in + user) through a friendly form (no JSON), and manage per-app behavior. Plus a one-time migration of the legacy `appSettings.muted` into rules.

**Architecture:** Pure, testable helpers (`ruleFactory`, `migration`) drive rule construction; GTK4/AGS-JSX components render the tabs and a form-based `RuleEditor`. All rule reads/writes go through the existing reactive `rulesStore` (Phase 1) and `historyStore` (Phase 2) — one source of truth. Builds on the spec `docs/superpowers/specs/2026-06-27-notification-cleanup-system-design.md`.

**Tech Stack:** TypeScript, AGS v2 (Astal)/GJS, GTK4, SCSS. Pure helpers tested on Node v26 (`node --test`); components verified by `ags bundle` + manual in-app check.

---

## Environment notes (read first)

- **Tests:** `node --test <file>` or quoted glob `node --test 'widget/notifications/settings/*.test.ts'`. NEVER `node --test <dir>` (broken in Node v26).
- Pure modules (`settings/ruleFactory.ts`, `settings/migration.ts`) + their tests MUST NOT import `gi://*` or `ags`. The `.tsx` components are GJS-bound (not node-tested).
- Local imports use explicit `.ts`/`.tsx` extensions in the new modules (repo convention; `ags bundle` resolves them). NOTE: existing files like `NotificationPanel.tsx` import some siblings WITHOUT extension (e.g. `from "./NotificationSettings"`). When you ADD imports to those existing files, match the new-module convention (`.tsx`) only for the new files; leave existing extensionless imports alone.
- TS subset for pure modules: no `enum`, `namespace`, or constructor parameter-properties.
- **No git. SKIP all "Commit" steps.** **Do NOT run `ags run`** (a live instance exists). Verify with `ags bundle app.ts <out>` (exit 0). Controller runs the bundle check.
- These components can't be auto-verified for visual/logic correctness — `ags bundle` only proves they compile. Flag anything uncertain as DONE_WITH_CONCERNS.

## AGS-JSX patterns to follow (from existing code)

- Intrinsic elements lowercase: `<box>`, `<button>`, `<label>`. GTK widgets capitalized: `<Gtk.Entry>`, `<Gtk.ScrolledWindow>`, `<Gtk.Revealer>`.
- Props: `cssClasses={[...]}`, `onClicked={() => ...}`, `label="..."`, `hexpand`, `halign={Gtk.Align.START}`, `orientation={Gtk.Orientation.VERTICAL}`, `spacing={n}`, `visible={state((v)=>...)}`.
- Reactive value in a prop: `label={someState((v) => String(v))}`. Reactive class set: `cssClasses={s((v)=> v ? ["a","active"] : ["a"])}`.
- Lists: `import { For } from "ags"`, then `<For each={listState}>{(item) => <Row .../>}</For>`.
- Local reactive state: `import { createState } from "ags"; const [v, setV] = createState(initial)`.
- Text input (uncontrolled; read on change): `<Gtk.Entry text={initialString} onChanged={(self) => patch(self.text)} placeholderText="..." />`. Do NOT bind `text` to a state you also set from onChanged (fights typing) — set the initial value once.
- Segmented selector = a row of `<button>`s whose active class is reactive (see existing `.ns-importance-btn` usage in `NotificationSettings.tsx`).

## File structure (Phase 3)

Create (pure):
- `widget/notifications/settings/ruleFactory.ts` — `blankRule`, `ruleFromHistoryEntry`, `summarizeRule`.
- `widget/notifications/settings/migration.ts` — `migrateAppSettingsToRules`.

Create (GJS):
- `widget/notifications/settings/RuleEditor.tsx`
- `widget/notifications/settings/RulesTab.tsx`
- `widget/notifications/settings/HistoryTab.tsx`
- `widget/notifications/settings/AppsTab.tsx`
- `widget/notifications/settings/SettingsTabs.tsx`
- `widget/notifications/settings/runMigration.ts`

Modify:
- `widget/notifications/NotificationSettings.tsx` — header stays; body becomes `<SettingsTabs/>`.
- `app.ts` — call `runAppSettingsMigration()` in `main()`.
- `style.scss` — append `.st-*` / `.re-*` classes.

Test:
- `widget/notifications/settings/ruleFactory.test.ts`, `widget/notifications/settings/migration.test.ts`.

---

## Task 1: `ruleFactory.ts` (pure)

**Files:**
- Create: `widget/notifications/settings/ruleFactory.ts`
- Test: `widget/notifications/settings/ruleFactory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/settings/ruleFactory.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { blankRule, ruleFromHistoryEntry, summarizeRule } from "./ruleFactory.ts"

test("blankRule is a disabled-effects user rule with given id", () => {
  const r = blankRule("user.123")
  assert.equal(r.id, "user.123")
  assert.equal(r.source, "user")
  assert.equal(r.enabled, true)
  assert.equal(r.priority, 100)
  assert.deepEqual(r.match, {})
  assert.deepEqual(r.effects, {})
})

test("ruleFromHistoryEntry prefills equals-app + contains-summary", () => {
  const r = ruleFromHistoryEntry("user.1", { app: "WhatsApp", summary: "usuario1" })
  assert.equal(r.match.app?.op, "equals")
  assert.equal(r.match.app?.value, "WhatsApp")
  assert.equal(r.match.summary?.op, "contains")
  assert.equal(r.match.summary?.value, "usuario1")
  assert.equal(r.source, "user")
})

test("summarizeRule with no match says 'cualquier notificación'", () => {
  assert.match(summarizeRule(blankRule("x")), /cualquier notificación → sin efectos/)
})

test("summarizeRule lists match clauses and effects", () => {
  const s = summarizeRule({
    id: "x", name: "x", enabled: true, priority: 100, source: "user",
    match: { app: { op: "equals", value: "kitty" }, summary: { op: "contains", value: "claude" } },
    effects: { lifetime: "clear-on-boot", muteAudio: true },
  })
  assert.match(s, /app equals "kitty"/)
  assert.match(s, /título contains "claude"/)
  assert.match(s, /clear-on-boot/)
  assert.match(s, /sin audio/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/settings/ruleFactory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// widget/notifications/settings/ruleFactory.ts
// Pure helpers to build and describe rules. No runtime imports.
import type { NotifRule } from "../rules/types.ts"

export function blankRule(id: string): NotifRule {
  return { id, name: "Nueva regla", enabled: true, priority: 100, source: "user", match: {}, effects: {} }
}

export function ruleFromHistoryEntry(id: string, entry: { app: string; summary: string }): NotifRule {
  const name = `${entry.app}: ${entry.summary}`.slice(0, 60)
  return {
    id, name, enabled: true, priority: 100, source: "user",
    match: {
      app: { op: "equals", value: entry.app },
      summary: { op: "contains", value: entry.summary },
    },
    effects: {},
  }
}

/** One-line human-readable summary for list rows. */
export function summarizeRule(rule: NotifRule): string {
  const m: string[] = []
  if (rule.match.app) m.push(`app ${rule.match.app.op} "${rule.match.app.value}"`)
  if (rule.match.summary) m.push(`título ${rule.match.summary.op} "${rule.match.summary.value}"`)
  if (rule.match.body) m.push(`cuerpo ${rule.match.body.op} "${rule.match.body.value}"`)
  if (rule.match.urgency && rule.match.urgency.length) m.push(`urgencia ∈ [${rule.match.urgency.join(",")}]`)
  const matchStr = m.length ? m.join(" · ") : "cualquier notificación"

  const e: string[] = []
  if (rule.effects.lifetime) e.push(rule.effects.lifetime)
  if (rule.effects.suppress) e.push("ocultar")
  if (rule.effects.dontShow) e.push("sin popup")
  if (rule.effects.muteAudio) e.push("sin audio")
  if (rule.effects.noHistory) e.push("sin historial")
  if (rule.effects.conditions && rule.effects.conditions.length) e.push(`condiciones: ${rule.effects.conditions.join("+")}`)
  const effStr = e.length ? e.join(", ") : "sin efectos"

  return `${matchStr} → ${effStr}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/settings/ruleFactory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** (skip — no git)

---

## Task 2: `migration.ts` (pure)

**Files:**
- Create: `widget/notifications/settings/migration.ts`
- Test: `widget/notifications/settings/migration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// widget/notifications/settings/migration.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { migrateAppSettingsToRules } from "./migration.ts"

test("creates a suppress rule per muted app, ignores unmuted", () => {
  const rules = migrateAppSettingsToRules({
    Discord: { muted: true },
    WhatsApp: { muted: false },
    Slack: { muted: true },
  })
  const ids = rules.map(r => r.id).sort()
  assert.deepEqual(ids, ["user.mute.Discord", "user.mute.Slack"])
  for (const r of rules) {
    assert.equal(r.effects.suppress, true)
    assert.equal(r.match.app?.op, "equals")
    assert.equal(r.source, "user")
  }
})

test("empty settings → no rules", () => {
  assert.deepEqual(migrateAppSettingsToRules({}), [])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test widget/notifications/settings/migration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// widget/notifications/settings/migration.ts
// Pure: convert legacy per-app mute settings into equivalent suppress rules.
// (Legacy `importance`/`showOnLockscreen` had no functional effect and are dropped.)
import type { NotifRule } from "../rules/types.ts"

export function migrateAppSettingsToRules(
  appSettings: Record<string, { muted?: boolean }>,
): NotifRule[] {
  const rules: NotifRule[] = []
  for (const [app, s] of Object.entries(appSettings)) {
    if (!s?.muted) continue
    rules.push({
      id: `user.mute.${app}`,
      name: `Silenciar ${app}`,
      enabled: true, priority: 100, source: "user",
      match: { app: { op: "equals", value: app } },
      effects: { suppress: true },
    })
  }
  return rules
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test widget/notifications/settings/migration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run both pure settings tests**

Run: `node --test 'widget/notifications/settings/*.test.ts'`
Expected: all PASS (6 tests).

- [ ] **Step 6: Commit** (skip — no git)

---

## Task 3: `RuleEditor.tsx` (form-based editor)

**Files:**
- Create: `widget/notifications/settings/RuleEditor.tsx`

A friendly form that edits a working copy of a rule and saves it. Mounted fresh per edit (so uncontrolled `Gtk.Entry` initial values are correct). For `source === "builtin"`, Save writes an override via `setBuiltinOverride`; Delete reverts via `clearBuiltinOverride`. For user rules, Save = `upsertUserRule`, Delete = `removeUserRule`.

- [ ] **Step 1: Write the component**

```tsx
// widget/notifications/settings/RuleEditor.tsx
// Form editor for a single rule. No JSON exposed. Mounted fresh per edit.
import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import type { NotifRule, StringMatch, Lifetime, DedupKeySpec } from "../rules/types.ts"
import { upsertUserRule, removeUserRule, setBuiltinOverride, clearBuiltinOverride } from "../rules/rulesStore.ts"

const OPS: StringMatch["op"][] = ["contains", "equals", "regex"]
const OP_LABEL: Record<StringMatch["op"], string> = { contains: "contiene", equals: "igual", regex: "regex" }
const LIFETIMES: (Lifetime | "none")[] = ["none", "flash", "timed", "clear-on-boot", "persistent"]
const LIFE_LABEL: Record<string, string> = { none: "—", flash: "flash", timed: "temporal", "clear-on-boot": "borrar al reinicio", persistent: "persistente" }
const DEDUPS: ("app" | "app+summary" | "app+summary+body")[] = ["app", "app+summary", "app+summary+body"]
const CONDITIONS = ["battery-resolved", "superseded"]

export default function RuleEditor({ rule, onClose }: { rule: NotifRule; onClose: () => void }) {
  // Working copy held as one state; helpers patch it.
  const [draft, setDraft] = createState<NotifRule>(JSON.parse(JSON.stringify(rule)))
  const patch = (p: Partial<NotifRule>) => setDraft({ ...draft.get(), ...p })
  const patchMatch = (p: Partial<NotifRule["match"]>) => patch({ match: { ...draft.get().match, ...p } })
  const patchEffects = (p: Partial<NotifRule["effects"]>) => patch({ effects: { ...draft.get().effects, ...p } })
  const isBuiltin = rule.source === "builtin"

  // Build a StringMatch field block (operator selector + value entry). Empty value removes the field.
  function MatchField(props: { key: "app" | "summary" | "body"; title: string }) {
    const cur = (): StringMatch | undefined => draft.get().match[props.key]
    return (
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
        <label cssClasses={["re-field-label"]} label={props.title} halign={Gtk.Align.START} />
        <box spacing={4}>
          {OPS.map(op => (
            <button
              cssClasses={draft((d) => d.match[props.key]?.op === op ? ["re-seg", "active"] : ["re-seg"])}
              onClicked={() => {
                const c = cur()
                patchMatch({ [props.key]: { op, value: c?.value ?? "", ci: c?.ci } } as any)
              }}
            >
              <label label={OP_LABEL[op]} />
            </button>
          ))}
        </box>
        <Gtk.Entry
          cssClasses={["re-entry"]}
          text={cur()?.value ?? ""}
          placeholderText="(vacío = ignorar este campo)"
          onChanged={(self) => {
            const v = self.text
            if (!v) { const m = { ...draft.get().match }; delete (m as any)[props.key]; patch({ match: m }) }
            else { const c = cur(); patchMatch({ [props.key]: { op: c?.op ?? "contains", value: v } } as any) }
          }}
        />
      </box>
    )
  }

  function Toggle(props: { label: string; get: () => boolean; set: (v: boolean) => void }) {
    return (
      <button
        cssClasses={draft((_) => props.get() ? ["re-toggle", "active"] : ["re-toggle"])}
        onClicked={() => props.set(!props.get())}
      >
        <label label={props.label} />
      </button>
    )
  }

  const [advanced, setAdvanced] = createState(false)

  function save() {
    const d = draft.get()
    if (isBuiltin) {
      // Persist only the editable fields as an override keyed by builtin id.
      setBuiltinOverride(d.id, { enabled: d.enabled, name: d.name, match: d.match, effects: d.effects, priority: d.priority, stopOnMatch: d.stopOnMatch })
    } else {
      upsertUserRule(d)
    }
    onClose()
  }
  function del() {
    if (isBuiltin) clearBuiltinOverride(rule.id)
    else removeUserRule(rule.id)
    onClose()
  }

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["re-panel"]}>
      <box spacing={6} valign={Gtk.Align.CENTER}>
        <button cssClasses={["ns-back-btn"]} onClicked={onClose}><label label="󰅁" /></button>
        <label cssClasses={["ns-title"]} label={isBuiltin ? "Editar regla (built-in)" : "Editar regla"} hexpand halign={Gtk.Align.START} />
        <button cssClasses={draft((d) => d.enabled ? ["re-toggle", "active"] : ["re-toggle"])} onClicked={() => patch({ enabled: !draft.get().enabled })}>
          <label label={draft((d) => d.enabled ? "Activa" : "Inactiva")} />
        </button>
      </box>

      <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vexpand>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={10}>
          {/* Name */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            <label cssClasses={["re-field-label"]} label="Nombre" halign={Gtk.Align.START} />
            <Gtk.Entry cssClasses={["re-entry"]} text={rule.name} onChanged={(self) => patch({ name: self.text })} />
          </box>

          <label cssClasses={["re-section"]} label="Cuándo aplica" halign={Gtk.Align.START} />
          <MatchField key="app" title="Aplicación" />
          <MatchField key="summary" title="Título" />
          <MatchField key="body" title="Cuerpo" />

          {/* urgency multi-select */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            <label cssClasses={["re-field-label"]} label="Urgencia" halign={Gtk.Align.START} />
            <box spacing={4}>
              {[0, 1, 2].map(u => (
                <button
                  cssClasses={draft((d) => (d.match.urgency ?? []).includes(u) ? ["re-seg", "active"] : ["re-seg"])}
                  onClicked={() => {
                    const cur = new Set(draft.get().match.urgency ?? [])
                    if (cur.has(u)) cur.delete(u); else cur.add(u)
                    const arr = [...cur]
                    const m = { ...draft.get().match }
                    if (arr.length) m.urgency = arr; else delete m.urgency
                    patch({ match: m })
                  }}
                >
                  <label label={u === 0 ? "baja" : u === 1 ? "normal" : "urgente"} />
                </button>
              ))}
            </box>
          </box>

          <label cssClasses={["re-section"]} label="Qué hacer" halign={Gtk.Align.START} />
          {/* lifetime */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            <label cssClasses={["re-field-label"]} label="Ciclo de vida" halign={Gtk.Align.START} />
            <box spacing={4}>
              {LIFETIMES.map(lt => (
                <button
                  cssClasses={draft((d) => (d.effects.lifetime ?? "none") === lt ? ["re-seg", "active"] : ["re-seg"])}
                  onClicked={() => {
                    const e = { ...draft.get().effects }
                    if (lt === "none") delete e.lifetime; else e.lifetime = lt
                    patch({ effects: e })
                  }}
                >
                  <label label={LIFE_LABEL[lt]} />
                </button>
              ))}
            </box>
          </box>

          {/* ttl (only when timed) */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]} visible={draft((d) => d.effects.lifetime === "timed")}>
            <label cssClasses={["re-field-label"]} label="Expira tras (días)" halign={Gtk.Align.START} />
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.ttlMs ? String(rule.effects.ttlMs / 86_400_000) : ""}
              placeholderText="ej: 2"
              onChanged={(self) => {
                const days = parseFloat(self.text)
                patchEffects({ ttlMs: Number.isFinite(days) ? days * 86_400_000 : undefined })
              }}
            />
          </box>

          {/* effect toggles */}
          <box spacing={4} cssClasses={["re-field"]}>
            <Toggle label="Ocultar" get={() => !!draft.get().effects.suppress} set={(v) => patchEffects({ suppress: v })} />
            <Toggle label="Sin popup" get={() => !!draft.get().effects.dontShow} set={(v) => patchEffects({ dontShow: v })} />
            <Toggle label="Sin audio" get={() => !!draft.get().effects.muteAudio} set={(v) => patchEffects({ muteAudio: v })} />
            <Toggle label="Sin historial" get={() => !!draft.get().effects.noHistory} set={(v) => patchEffects({ noHistory: v })} />
          </box>

          {/* dedup key */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            <label cssClasses={["re-field-label"]} label="Agrupar duplicados por" halign={Gtk.Align.START} />
            <box spacing={4}>
              {DEDUPS.map(dk => (
                <button
                  cssClasses={draft((d) => (typeof d.effects.dedupKey === "string" ? d.effects.dedupKey : "app+summary") === dk ? ["re-seg", "active"] : ["re-seg"])}
                  onClicked={() => patchEffects({ dedupKey: dk as DedupKeySpec })}
                >
                  <label label={dk} />
                </button>
              ))}
            </box>
          </box>

          {/* advanced: conditions */}
          <button cssClasses={["re-advanced-toggle"]} onClicked={() => setAdvanced(!advanced.get())}>
            <label label={advanced((a) => a ? "󰅀 Avanzado" : "󰅂 Avanzado")} halign={Gtk.Align.START} />
          </button>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]} visible={advanced((a) => a)}>
            <label cssClasses={["re-field-label"]} label="Condiciones dinámicas" halign={Gtk.Align.START} />
            <box spacing={4}>
              {CONDITIONS.map(c => (
                <button
                  cssClasses={draft((d) => (d.effects.conditions ?? []).includes(c) ? ["re-toggle", "active"] : ["re-toggle"])}
                  onClicked={() => {
                    const cur = new Set(draft.get().effects.conditions ?? [])
                    if (cur.has(c)) cur.delete(c); else cur.add(c)
                    const arr = [...cur]
                    const e = { ...draft.get().effects }
                    if (arr.length) e.conditions = arr; else delete e.conditions
                    patch({ effects: e })
                  }}
                >
                  <label label={c} />
                </button>
              ))}
            </box>
          </box>
        </box>
      </Gtk.ScrolledWindow>

      {/* footer */}
      <box spacing={6}>
        <button cssClasses={["re-save"]} onClicked={save} hexpand><label label="Guardar" /></button>
        <button cssClasses={["re-delete"]} onClicked={del}>
          <label label={isBuiltin ? "Revertir" : "Borrar"} />
        </button>
      </box>
    </box>
  )
}
```

- [ ] **Step 2: Static check** — confirm imports resolve (`../rules/types.ts`, `../rules/rulesStore.ts` exports `upsertUserRule`/`removeUserRule`/`setBuiltinOverride`/`clearBuiltinOverride`). Balanced braces.

- [ ] **Step 3: Commit** (skip — no git)

---

## Task 4: `RulesTab.tsx` (list all rules)

**Files:**
- Create: `widget/notifications/settings/RulesTab.tsx`

Lists ALL rules (built-in + user) via `allRules()`, reactive on `rulesFile`. Each row: enabled toggle, name, one-line summary, edit button. "+" adds a new user rule and opens the editor. Editing shows `RuleEditor` mounted fresh.

- [ ] **Step 1: Write the component**

```tsx
// widget/notifications/settings/RulesTab.tsx
import { Gtk } from "ags/gtk4"
import { createState, For } from "ags"
import type { NotifRule } from "../rules/types.ts"
import { rulesFile, allRules, upsertUserRule, setBuiltinOverride } from "../rules/rulesStore.ts"
import { blankRule, summarizeRule } from "./ruleFactory.ts"
import RuleEditor from "./RuleEditor.tsx"

export default function RulesTab() {
  const [editing, setEditing] = createState<NotifRule | null>(null)
  const [rules, setRules] = createState<NotifRule[]>(allRules())
  rulesFile.subscribe(() => setRules(allRules()))

  function toggleEnabled(r: NotifRule) {
    if (r.source === "builtin") setBuiltinOverride(r.id, { enabled: !r.enabled })
    else upsertUserRule({ ...r, enabled: !r.enabled })
  }

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      {/* editor overlay */}
      <box visible={editing((e) => e !== null)}>
        {editing((e) => e ? <RuleEditor rule={e} onClose={() => setEditing(null)} /> : <box />)}
      </box>

      {/* list */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} visible={editing((e) => e === null)}>
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <label cssClasses={["st-tab-hint"]} label="Reglas (built-in + tuyas)" hexpand halign={Gtk.Align.START} />
          <button cssClasses={["st-add-btn"]} onClicked={() => setEditing(blankRule(`user.${Date.now()}`))}>
            <label label="󰐕 Nueva" />
          </button>
        </box>

        <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vexpand>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <For each={rules}>
              {(r: NotifRule) => (
                <box cssClasses={["re-row"]} spacing={8} valign={Gtk.Align.CENTER}>
                  <button cssClasses={r.enabled ? ["re-toggle", "active"] : ["re-toggle"]} onClicked={() => toggleEnabled(r)}>
                    <label label={r.enabled ? "󰔡" : "󰨙"} />
                  </button>
                  <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
                    <box spacing={6}>
                      <label cssClasses={["re-row-name"]} label={r.name} halign={Gtk.Align.START} ellipsize={3} />
                      {r.source === "builtin" && <label cssClasses={["re-badge"]} label="built-in" />}
                    </box>
                    <label cssClasses={["re-row-summary"]} label={summarizeRule(r)} halign={Gtk.Align.START} ellipsize={3} wrap={false} />
                  </box>
                  <button cssClasses={["re-edit-btn"]} onClicked={() => setEditing(r)}><label label="󰏫" /></button>
                </box>
              )}
            </For>
          </box>
        </Gtk.ScrolledWindow>
      </box>
    </box>
  )
}
```

- [ ] **Step 2: Static check** — imports resolve; `allRules`, `rulesFile`, `upsertUserRule`, `setBuiltinOverride` exported by rulesStore. Balanced braces.

- [ ] **Step 3: Commit** (skip — no git)

---

## Task 5: `HistoryTab.tsx`

**Files:**
- Create: `widget/notifications/settings/HistoryTab.tsx`

Lists `historyEntries` (types with no rule yet). Each row: app · summary, count, last-seen, and a "crear regla" button that opens a `RuleEditor` prefilled from the entry.

- [ ] **Step 1: Write the component**

```tsx
// widget/notifications/settings/HistoryTab.tsx
import { Gtk } from "ags/gtk4"
import { createState, For } from "ags"
import type { NotifRule } from "../rules/types.ts"
import { historyEntries } from "../history/historyStore.ts"
import type { HistoryEntry } from "../history/historyLogic.ts"
import { ruleFromHistoryEntry } from "./ruleFactory.ts"
import RuleEditor from "./RuleEditor.tsx"

export default function HistoryTab() {
  const [editing, setEditing] = createState<NotifRule | null>(null)
  const empty = historyEntries((e) => (e?.length ?? 0) === 0)

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      <box visible={editing((e) => e !== null)}>
        {editing((e) => e ? <RuleEditor rule={e} onClose={() => setEditing(null)} /> : <box />)}
      </box>

      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} visible={editing((e) => e === null)}>
        <label cssClasses={["st-tab-hint"]} label="Tipos sin regla — crea una para gestionarlos" halign={Gtk.Align.START} />

        <box orientation={Gtk.Orientation.VERTICAL} spacing={8} valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER} vexpand visible={empty} css="padding: 32px 0;">
          <label cssClasses={["ns-empty-icon"]} label="󰂚" />
          <label cssClasses={["ns-empty-label"]} label="Historial vacío" />
        </box>

        <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vexpand visible={empty((e) => !e)}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <For each={historyEntries}>
              {(entry: HistoryEntry) => (
                <box cssClasses={["re-row"]} spacing={8} valign={Gtk.Align.CENTER}>
                  <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
                    <box spacing={6}>
                      <label cssClasses={["re-row-name"]} label={entry.app} halign={Gtk.Align.START} ellipsize={3} />
                      <label cssClasses={["re-badge"]} label={`×${entry.count}`} />
                    </box>
                    <label cssClasses={["re-row-summary"]} label={entry.summary || "(sin título)"} halign={Gtk.Align.START} ellipsize={3} />
                  </box>
                  <button cssClasses={["st-add-btn"]} onClicked={() => setEditing(ruleFromHistoryEntry(`user.${Date.now()}`, entry))}>
                    <label label="󰐕 Regla" />
                  </button>
                </box>
              )}
            </For>
          </box>
        </Gtk.ScrolledWindow>
      </box>
    </box>
  )
}
```

- [ ] **Step 2: Static check** — `historyEntries` exported by historyStore; `HistoryEntry` by historyLogic; `ruleFromHistoryEntry` by ruleFactory. Balanced braces.

- [ ] **Step 3: Commit** (skip — no git)

---

## Task 6: `AppsTab.tsx`

**Files:**
- Create: `widget/notifications/settings/AppsTab.tsx`

Lists apps seen in history + apps that have rules. Per app: a quick mute toggle (creates/removes a `user.mute.<app>` suppress rule) and a count of rules targeting that app.

- [ ] **Step 1: Write the component**

```tsx
// widget/notifications/settings/AppsTab.tsx
import { Gtk } from "ags/gtk4"
import { createState, For } from "ags"
import type { NotifRule } from "../rules/types.ts"
import { rulesFile, allRules, upsertUserRule, removeUserRule } from "../rules/rulesStore.ts"
import { historyEntries } from "../history/historyStore.ts"
import { getAppColor, getAppIcon } from "../store.ts"

function muteId(app: string): string { return `user.mute.${app}` }

export default function AppsTab() {
  const computeApps = (): string[] => {
    const set = new Set<string>()
    for (const e of historyEntries.get()) set.add(e.app)
    for (const r of allRules()) if (r.match.app?.op === "equals") set.add(r.match.app.value)
    return [...set].sort((a, b) => a.localeCompare(b))
  }
  const [apps, setApps] = createState<string[]>(computeApps())
  const refresh = () => setApps(computeApps())
  historyEntries.subscribe(refresh)
  rulesFile.subscribe(refresh)

  function isMuted(app: string): boolean {
    return allRules().some(r => r.id === muteId(app) && r.enabled && r.effects.suppress)
  }
  function toggleMute(app: string) {
    if (isMuted(app)) {
      removeUserRule(muteId(app))
    } else {
      const rule: NotifRule = {
        id: muteId(app), name: `Silenciar ${app}`, enabled: true, priority: 100, source: "user",
        match: { app: { op: "equals", value: app } }, effects: { suppress: true },
      }
      upsertUserRule(rule)
    }
    refresh()
  }
  function ruleCount(app: string): number {
    return allRules().filter(r => r.match.app?.op === "equals" && r.match.app.value === app).length
  }

  const empty = apps((a) => (a?.length ?? 0) === 0)

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <label cssClasses={["st-tab-hint"]} label="Apps vistas — silencia o revisa sus reglas" halign={Gtk.Align.START} />

      <box orientation={Gtk.Orientation.VERTICAL} spacing={8} valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER} vexpand visible={empty} css="padding: 32px 0;">
        <label cssClasses={["ns-empty-icon"]} label="󰂚" />
        <label cssClasses={["ns-empty-label"]} label="Sin apps todavía" />
      </box>

      <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vexpand visible={empty((e) => !e)}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
          <For each={apps}>
            {(app: string) => (
              <box cssClasses={["ns-app-row"]} spacing={8} valign={Gtk.Align.CENTER}>
                <box cssClasses={["ns-app-icon-wrap"]} css={`background: rgba(${hexToRgb(getAppColor(app))}, 0.15);`}>
                  <label cssClasses={["ns-app-icon"]} label={getAppIcon(app)} css={`color: ${getAppColor(app)};`} />
                </box>
                <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
                  <label cssClasses={["ns-app-name"]} label={app} halign={Gtk.Align.START} ellipsize={3} />
                  <label cssClasses={["re-row-summary"]} label={`${ruleCount(app)} regla(s)`} halign={Gtk.Align.START} />
                </box>
                <button
                  cssClasses={isMuted(app) ? ["ns-mute-btn", "muted"] : ["ns-mute-btn"]}
                  tooltipText={isMuted(app) ? "Reactivar app" : "Silenciar app"}
                  onClicked={() => toggleMute(app)}
                >
                  <label cssClasses={["ns-mute-icon"]} label={isMuted(app) ? "󰂛" : "󰂚"} />
                </button>
              </box>
            )}
          </For>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "")
  if (h.length !== 6) return "255,255,255"
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`
}
```

> Note: the mute toggle's `isMuted`/`ruleCount` read `allRules()` imperatively inside render; they re-run because `refresh()` updates `apps`, which re-renders the `For`. Acceptable for this list size.

- [ ] **Step 2: Static check** — `getAppColor`/`getAppIcon` exported by store.ts (they are). imports resolve. Balanced braces.

- [ ] **Step 3: Commit** (skip — no git)

---

## Task 7: `SettingsTabs.tsx` + rewrite `NotificationSettings.tsx` + migration runner + app.ts

**Files:**
- Create: `widget/notifications/settings/SettingsTabs.tsx`
- Create: `widget/notifications/settings/runMigration.ts`
- Modify: `widget/notifications/NotificationSettings.tsx`
- Modify: `app.ts`

- [ ] **Step 1: Write `SettingsTabs.tsx`**

```tsx
// widget/notifications/settings/SettingsTabs.tsx
import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import AppsTab from "./AppsTab.tsx"
import HistoryTab from "./HistoryTab.tsx"
import RulesTab from "./RulesTab.tsx"

type TabId = "apps" | "history" | "rules"
const TABS: { id: TabId; label: string }[] = [
  { id: "apps", label: "Apps" },
  { id: "history", label: "Historial" },
  { id: "rules", label: "Reglas" },
]

export default function SettingsTabs() {
  const [tab, setTab] = createState<TabId>("rules")
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box cssClasses={["st-tabbar"]} spacing={4}>
        {TABS.map(t => (
          <button
            cssClasses={tab((cur) => cur === t.id ? ["st-tab", "active"] : ["st-tab"])}
            hexpand
            onClicked={() => setTab(t.id)}
          >
            <label label={t.label} />
          </button>
        ))}
      </box>
      <box visible={tab((t) => t === "apps")}><AppsTab /></box>
      <box visible={tab((t) => t === "history")}><HistoryTab /></box>
      <box visible={tab((t) => t === "rules")}><RulesTab /></box>
    </box>
  )
}
```

- [ ] **Step 2: Write `runMigration.ts`**

```ts
// widget/notifications/settings/runMigration.ts
// One-time migration of legacy appSettings.muted → suppress rules. Guarded by a marker file.
import GLib from "gi://GLib"
import { appSettings } from "../store.ts"
import { upsertUserRule } from "../rules/rulesStore.ts"
import { migrateAppSettingsToRules } from "./migration.ts"

const MARKER = `${GLib.get_user_config_dir()}/ags/config/notif-migrated.json`

export function runAppSettingsMigration(): void {
  if (GLib.file_test(MARKER, GLib.FileTest.EXISTS)) return
  try {
    const rules = migrateAppSettingsToRules(appSettings.get() as any)
    for (const r of rules) upsertUserRule(r)
    GLib.file_set_contents(MARKER, JSON.stringify({ migrated: true, at: Date.now(), count: rules.length }))
    console.log(`[notif] appSettings migration: created ${rules.length} mute rule(s)`)
  } catch (e) { console.error("[notif] migration failed:", e) }
}
```

- [ ] **Step 3: Rewrite the body of `NotificationSettings.tsx`**

Replace the ENTIRE contents of `widget/notifications/NotificationSettings.tsx` with the following (keeps the same default export + `onBack` prop so `NotificationPanel.tsx` is unchanged; header preserved; per-app body replaced by tabs):

```tsx
// widget/notifications/NotificationSettings.tsx
// Settings subpanel: header + 3 tabs (Apps / Historial / Reglas).
import { Gtk } from "ags/gtk4"
import SettingsTabs from "./settings/SettingsTabs.tsx"

export default function NotificationSettings({ onBack }: { onBack: () => void }) {
  return (
    <box cssClasses={["ns-panel"]} orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      <box cssClasses={["ns-header"]} spacing={8} valign={Gtk.Align.CENTER}>
        <button cssClasses={["ns-back-btn"]} onClicked={onBack}><label label="󰅁" /></button>
        <label cssClasses={["ns-title"]} label="Ajustes de notificaciones" hexpand halign={Gtk.Align.START} />
      </box>
      <box vexpand><SettingsTabs /></box>
    </box>
  )
}
```

> The old per-app helper (`AppSettingRow`) and the legacy `importance`/`lockscreen` UI are removed by this replacement, as decided. `appSettings`/`updateAppSettings` remain in `store.ts` (still referenced by `NotificationItem.tsx`'s mute action and the migration); do NOT delete them.

- [ ] **Step 4: Wire migration into `app.ts`**

Add near the other notification imports in `app.ts`:

```ts
import { runAppSettingsMigration } from "./widget/notifications/settings/runMigration"
```

Inside `main()`, after `startCleanupEngine()`, add:

```ts
runAppSettingsMigration()
```

(Extensionless import to match `app.ts` style.)

- [ ] **Step 5: Static check** — all imports resolve; `appSettings` exported by store.ts; balanced braces.

- [ ] **Step 6: Commit** (skip — no git)

---

## Task 8: SCSS + bundle verification

**Files:**
- Modify: `style.scss` (append)

- [ ] **Step 1: Append the new style classes to `style.scss`**

```scss
/* ── Notification settings tabs (Phase 3) ───────────────────────────── */
.st-tabbar { padding: 2px; }
.st-tab {
  background: transparent;
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  color: rgba(226, 226, 226, 0.5);
  font-family: "MesloLGS Nerd Font";
  font-size: 12px;
  transition: all 120ms ease;
  &:hover { background: rgba(255, 255, 255, 0.05); color: #e2e2e2; }
  &.active { background: rgba(203, 166, 247, 0.15); color: #cba6f7; }
}
.st-tab-hint { font-size: 10px; color: rgba(226, 226, 226, 0.4); font-family: "MesloLGS Nerd Font"; }
.st-add-btn {
  background: rgba(166, 227, 161, 0.12);
  border: 1px solid rgba(166, 227, 161, 0.3);
  border-radius: 6px;
  padding: 4px 10px;
  color: #a6e3a1;
  font-family: "MesloLGS Nerd Font";
  font-size: 11px;
  &:hover { background: rgba(166, 227, 161, 0.2); }
}

/* ── Rule rows + editor (Phase 3) ───────────────────────────────────── */
.re-row {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px 10px;
}
.re-row-name { font-size: 12px; color: #e2e2e2; font-family: "MesloLGS Nerd Font"; font-weight: 500; }
.re-row-summary { font-size: 10px; color: rgba(226, 226, 226, 0.45); font-family: "MesloLGS Nerd Font"; }
.re-badge {
  font-size: 9px; color: rgba(226, 226, 226, 0.5);
  background: rgba(255, 255, 255, 0.06); border-radius: 4px; padding: 1px 5px;
  font-family: "MesloLGS Nerd Font";
}
.re-edit-btn, .re-delete, .re-save, .re-advanced-toggle, .re-seg, .re-toggle {
  font-family: "MesloLGS Nerd Font"; transition: all 100ms ease; border-radius: 6px;
}
.re-edit-btn {
  background: transparent; border: 1px solid rgba(255, 255, 255, 0.08);
  min-width: 30px; min-height: 30px; color: rgba(226, 226, 226, 0.6);
  &:hover { background: rgba(255, 255, 255, 0.08); color: #e2e2e2; }
}
.re-panel { padding: 4px 2px; }
.re-section { font-size: 11px; color: #cba6f7; font-family: "MesloLGS Nerd Font"; font-weight: 600; margin-top: 4px; }
.re-field { }
.re-field-label { font-size: 10px; color: rgba(226, 226, 226, 0.5); font-family: "MesloLGS Nerd Font"; }
.re-entry {
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px; padding: 4px 8px; font-size: 11px; color: #e2e2e2; font-family: "MesloLGS Nerd Font";
}
.re-seg, .re-toggle {
  background: transparent; border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 3px 8px; font-size: 10px; color: rgba(226, 226, 226, 0.55);
  &:hover { background: rgba(255, 255, 255, 0.06); color: #e2e2e2; }
  &.active { background: rgba(137, 180, 250, 0.18); border-color: rgba(137, 180, 250, 0.4); color: #89b4fa; }
}
.re-advanced-toggle { background: transparent; border: none; color: rgba(226, 226, 226, 0.5); font-size: 11px; padding: 2px 0; }
.re-save {
  background: rgba(137, 180, 250, 0.15); border: 1px solid rgba(137, 180, 250, 0.3);
  padding: 6px; color: #89b4fa; font-size: 12px;
  &:hover { background: rgba(137, 180, 250, 0.25); }
}
.re-delete {
  background: rgba(243, 139, 168, 0.12); border: 1px solid rgba(243, 139, 168, 0.3);
  padding: 6px 12px; color: #f38ba8; font-size: 12px;
  &:hover { background: rgba(243, 139, 168, 0.22); }
}
```

- [ ] **Step 2: Bundle verification (controller)**

Run: `ags bundle app.ts /tmp/phase3-bundle-check.js`
Expected: exit 0, output written, no errors.

- [ ] **Step 3: Full pure test suite**

Run: `node --test 'widget/notifications/rules/*.test.ts' 'widget/notifications/cleanup/*.test.ts' 'widget/notifications/history/*.test.ts' 'widget/notifications/settings/*.test.ts'`
Expected: all PASS.

- [ ] **Step 4: Commit** (skip — no git)

---

## Phase 3 done — what works

- The notification settings subpanel now has 3 tabs: **Apps** (per-app mute via rules + rule count), **Historial** (un-ruled types with "create rule"), **Reglas** (all built-in + user rules, edit via friendly form, enable/disable/delete/revert).
- `RuleEditor` exposes match (app/summary/body + operator + urgency) and effects (lifetime, ttl-when-timed, suppress/dontShow/muteAudio/noHistory toggles, dedupKey, conditions in an advanced section) — no JSON.
- Legacy `appSettings.muted` is migrated once to `user.mute.<app>` suppress rules (guarded by `config/notif-migrated.json`).

## Manual verification checklist (after reloading the shell — user)

1. Open the notification panel → settings (gear). Three tabs appear; "Reglas" lists built-ins (screenshot, crash, reboot, battery, whatsapp) + any user rules.
2. Edit a built-in's effect → reopen → change persisted (stored as override in `notif-rules.json`); "Revertir" restores it.
3. Trigger a never-seen notification → it appears in "Historial"; "Regla" opens the editor prefilled; save → it leaves Historial and appears in Reglas.
4. In "Apps", toggle mute on an app → that app's notifications stop appearing.

## Self-review notes (addressed)

- **Spec coverage:** 3 tabs ✓; Apps per-app + mute-as-rule ✓ (Task 6); Historial of un-ruled types + create-rule ✓ (Task 5); Reglas shows ALL rules incl. built-ins, editable ✓ (Task 4 + 3); built-in edits as overrides ✓ (Task 3 save branch); friendly form, no JSON ✓ (Task 3); migration ✓ (Task 2 + 7). Per-type sub-rows are surfaced via the Historial "create rule" flow rather than nested rows in Apps — simpler, same outcome (a rule per type).
- **Type consistency:** `RuleEditor` props `{ rule: NotifRule; onClose: () => void }` used identically by RulesTab/HistoryTab; `blankRule(id)`/`ruleFromHistoryEntry(id, entry)`/`summarizeRule(rule)` signatures match Tasks 1/4/5; rulesStore mutators (`upsertUserRule`/`removeUserRule`/`setBuiltinOverride`/`clearBuiltinOverride`) match Phase 1 exports.
- **Purity:** `ruleFactory.ts`/`migration.ts` import only types; tests import only them.
- **Risk:** components are verified by `ags bundle` (compile) only; visual/interaction correctness needs the user's manual checklist. `Gtk.Entry` initial values are set uncontrolled from the freshly-mounted `rule` prop (editor re-mounts per edit because RulesTab/HistoryTab render it conditionally).
```
