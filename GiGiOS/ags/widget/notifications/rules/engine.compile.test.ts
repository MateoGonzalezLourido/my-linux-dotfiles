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
