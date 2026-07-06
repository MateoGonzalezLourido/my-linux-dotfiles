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
