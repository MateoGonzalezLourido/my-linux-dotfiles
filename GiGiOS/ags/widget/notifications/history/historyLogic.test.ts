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
