// modulos/notificaciones/cleanup/partitions.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { keepAfterBoot, keepUnexpired, keepWithin7Days, SEVEN_DAYS_MS } from "./partitions.ts"

const mk = (over: any) => ({
  timestamp: 0,
  meta: { lifetime: "persistent", clearOnBoot: false, noHistory: false, muteAudio: false, dontShow: false, dedupKey: "k", conditions: [], matchedRules: [], ...over.meta },
  ...over,
})

test("keepAfterBoot drops clearOnBoot and expired-timed", () => {
  const items = [
    mk({ meta: { clearOnBoot: true } }),
    mk({ meta: { lifetime: "timed", expiresAt: 500 } }),
    mk({ meta: { lifetime: "persistent" } }),
  ]
  const kept = items.filter(n => keepAfterBoot(n, 1000))
  assert.equal(kept.length, 1)
})

test("keepUnexpired drops timed whose expiresAt passed", () => {
  assert.equal(keepUnexpired(mk({ meta: { lifetime: "timed", expiresAt: 500 } }), 1000), false)
  assert.equal(keepUnexpired(mk({ meta: { lifetime: "timed", expiresAt: 2000 } }), 1000), true)
  assert.equal(keepUnexpired(mk({ meta: { lifetime: "persistent" } }), 1000), true)
})

test("keepWithin7Days drops older than 7 days", () => {
  const now = SEVEN_DAYS_MS + 10
  assert.equal(keepWithin7Days(mk({ timestamp: 5 }), now), false)
  assert.equal(keepWithin7Days(mk({ timestamp: now }), now), true)
})
