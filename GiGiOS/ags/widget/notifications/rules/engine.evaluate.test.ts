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
  assert.equal(r.meta.dedupKey, "whatsapp usuario1")
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
