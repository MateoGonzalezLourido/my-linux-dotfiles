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
  assert.equal(r.match.body, undefined) // no body → no body match
})

test("ruleFromHistoryEntry adds a body match when the entry has a sampleBody", () => {
  const r = ruleFromHistoryEntry("user.1", { app: "kitty", summary: "Claude Code", sampleBody: "needs your permission" })
  assert.equal(r.match.body?.op, "contains")
  assert.equal(r.match.body?.value, "needs your permission")
})

test("summarizeRule with no match says 'Cualquier notificación → no hace nada'", () => {
  assert.match(summarizeRule(blankRule("x")), /Cualquier notificación → no hace nada/)
})

test("summarizeRule lists match clauses and effects in Spanish", () => {
  const s = summarizeRule({
    id: "x", name: "x", enabled: true, priority: 100, source: "user",
    match: { app: { op: "equals", value: "kitty" }, summary: { op: "contains", value: "claude" } },
    effects: { clearOnBoot: true, muteAudio: true },
  })
  assert.match(s, /la app es «kitty»/)
  assert.match(s, /el título contiene «claude»/)
  assert.match(s, /se limpia al reiniciar el sistema/)
  assert.match(s, /sin sonido/)
})

test("summarizeRule shows the duration for a timed rule", () => {
  const s = summarizeRule({
    id: "x", name: "x", enabled: true, priority: 100, source: "user",
    match: { app: { op: "contains", value: "whatsapp" } },
    effects: { lifetime: "timed", ttlMs: 900_000 },
  })
  assert.match(s, /la app contiene «whatsapp»/)
  assert.match(s, /expira en 15min/)
})
