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
