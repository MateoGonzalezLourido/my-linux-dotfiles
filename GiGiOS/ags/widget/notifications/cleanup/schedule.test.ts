// widget/notifications/cleanup/schedule.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { nextWakeAt } from "./schedule.ts"
import { SEVEN_DAYS_MS } from "./partitions.ts"

const mk = (over: any) => ({
  timestamp: 0,
  meta: { lifetime: "persistent", clearOnBoot: false, noHistory: false, muteAudio: false, dontShow: false, dedupKey: "k", conditions: [], matchedRules: [], ...over.meta },
  ...over,
})

test("nextWakeAt returns null for an empty list (no timer needed)", () => {
  assert.equal(nextWakeAt([], 1000), null)
})

test("nextWakeAt for a single persistent notif is its 7-day boundary", () => {
  assert.equal(nextWakeAt([mk({ timestamp: 1000 })], 1000), 1000 + SEVEN_DAYS_MS)
})

test("nextWakeAt for a timed notif is its expiresAt when sooner than 7 days", () => {
  const n = mk({ timestamp: 1000, meta: { lifetime: "timed", expiresAt: 5000 } })
  assert.equal(nextWakeAt([n], 1000), 5000)
})

test("nextWakeAt picks the earliest boundary across notifs", () => {
  const persistent = mk({ timestamp: 1000 })                                       // -> 1000 + 7d
  const timedSoon  = mk({ timestamp: 1000, meta: { lifetime: "timed", expiresAt: 3000 } })
  const timedLater = mk({ timestamp: 1000, meta: { lifetime: "timed", expiresAt: 9000 } })
  assert.equal(nextWakeAt([persistent, timedLater, timedSoon], 1000), 3000)
})

test("nextWakeAt never returns a time in the past (clamped to now)", () => {
  const expired = mk({ timestamp: 0, meta: { lifetime: "timed", expiresAt: 500 } })
  assert.equal(nextWakeAt([expired], 1000), 1000)
})

test("nextWakeAt treats a timed notif without expiresAt as persistent (7-day)", () => {
  const n = mk({ timestamp: 1000, meta: { lifetime: "timed" } })
  assert.equal(nextWakeAt([n], 1000), 1000 + SEVEN_DAYS_MS)
})
