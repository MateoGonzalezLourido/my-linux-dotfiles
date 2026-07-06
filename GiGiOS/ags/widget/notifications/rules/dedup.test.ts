// widget/notifications/rules/dedup.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { computeDedupKey } from "./dedup.ts"

const n = { appName: "WhatsApp", summary: "usuario1", body: "hola", urgency: 1 }

test("default app+summary", () => {
  assert.equal(computeDedupKey("app+summary", n), "whatsapp usuario1")
})

test("app only", () => {
  assert.equal(computeDedupKey("app", n), "whatsapp")
})

test("app+summary+body", () => {
  assert.equal(computeDedupKey("app+summary+body", n), "whatsapp usuario1 hola")
})

test("template", () => {
  assert.equal(computeDedupKey({ template: "{app}|{summary}" }, n), "whatsapp|usuario1")
})

test("template unknown placeholder left literal", () => {
  assert.equal(computeDedupKey({ template: "{app}-{nope}" }, n), "whatsapp-{nope}")
})
