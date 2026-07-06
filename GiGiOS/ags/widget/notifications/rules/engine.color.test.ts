// widget/notifications/rules/engine.color.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileRules, evaluate } from "./engine.ts"
import type { NotifRule, NotifInput } from "./types.ts"

const NOW = 0
const input: NotifInput = { appName: "WhatsApp", summary: "usuario1", body: "hola", urgency: 1 }
function rule(p: Partial<NotifRule>): NotifRule {
  return { id: "r", name: "r", enabled: true, priority: 0, source: "user", match: {}, effects: {}, ...p }
}

test("no color rule → meta.color is undefined", () => {
  const r = evaluate(input, compileRules([]), NOW)
  assert.equal(r.meta.color, undefined)
})

test("a color effect surfaces on meta.color", () => {
  const rules = [rule({ effects: { color: "#f38ba8" } })]
  const r = evaluate(input, compileRules(rules), NOW)
  assert.equal(r.meta.color, "#f38ba8")
})

test("highest-priority rule wins the color (set-once fold)", () => {
  const rules = [
    rule({ id: "low", priority: 0, effects: { color: "#a6e3a1" } }),
    rule({ id: "high", priority: 10, effects: { color: "#89b4fa" } }),
  ]
  const r = evaluate(input, compileRules(rules), NOW)
  assert.equal(r.meta.color, "#89b4fa")
})

test("color falls through when the higher-priority rule sets no color", () => {
  const rules = [
    rule({ id: "low", priority: 0, effects: { color: "#a6e3a1" } }),
    rule({ id: "high", priority: 10, effects: { muteAudio: true } }),
  ]
  const r = evaluate(input, compileRules(rules), NOW)
  assert.equal(r.meta.color, "#a6e3a1")
})
