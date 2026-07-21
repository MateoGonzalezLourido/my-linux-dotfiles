import { test } from "node:test"
import assert from "node:assert/strict"
import { buildNotifFields } from "./notifFields.ts"

const NOON = new Date(2026, 0, 1, 9, 5).getTime()

test("extra hints are exposed as fields", () => {
  const out = buildNotifFields({ app_name: "Bat" }, NOON, { "time-remaining": "3h 26min", value: "99" })
  assert.equal(out["time-remaining"], "3h 26min")
  assert.equal(out.value, "99")
  assert.equal(out.app, "Bat")
})

test("core fields win over a colliding hint key", () => {
  const out = buildNotifFields({ summary: "real" }, NOON, { summary: "hint-shadow" })
  assert.equal(out.summary, "real")
})

test("no extra arg keeps behavior unchanged", () => {
  const out = buildNotifFields({ app_name: "x" }, NOON)
  assert.equal(out.app, "x")
  assert.equal(Object.keys(out).sort().join(","), "app,body,summary,time,urgency,urgencyName")
})
