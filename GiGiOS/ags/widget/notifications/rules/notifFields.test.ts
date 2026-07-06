// widget/notifications/rules/notifFields.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildNotifFields, NOTIF_FIELDS } from "./notifFields.ts"

const NOON = new Date(2026, 0, 1, 9, 5).getTime()

test("builds all documented fields from a raw notification", () => {
  const out = buildNotifFields({ app_name: "WhatsApp", summary: "usuario1", body: "hola", urgency: 2 }, NOON)
  assert.equal(out.app, "WhatsApp")
  assert.equal(out.summary, "usuario1")
  assert.equal(out.body, "hola")
  assert.equal(out.urgency, "2")
  assert.equal(out.urgencyName, "urgente")
  assert.equal(out.time, "09:05")
})

test("missing fields become empty strings; urgency defaults to normal", () => {
  const out = buildNotifFields({}, NOON)
  assert.equal(out.app, "")
  assert.equal(out.summary, "")
  assert.equal(out.body, "")
  assert.equal(out.urgency, "1")
  assert.equal(out.urgencyName, "normal")
})

test("NOTIF_FIELDS keys exactly match the keys buildNotifFields produces", () => {
  const produced = Object.keys(buildNotifFields({}, NOON)).sort()
  const declared = NOTIF_FIELDS.map(f => f.key).sort()
  assert.deepEqual(declared, produced)
})

test("urgencyName maps 0→baja", () => {
  assert.equal(buildNotifFields({ urgency: 0 }, NOON).urgencyName, "baja")
})
