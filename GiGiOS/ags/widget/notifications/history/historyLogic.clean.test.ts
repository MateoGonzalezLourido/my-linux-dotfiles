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
