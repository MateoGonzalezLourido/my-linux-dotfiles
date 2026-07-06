// widget/notifications/rules/template.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyTemplate } from "./template.ts"

const f = { app: "WhatsApp", summary: "usuario1", body: "hola", urgency: "1" }

test("replaces known placeholders", () => {
  assert.equal(applyTemplate("hola que tal {summary}", f), "hola que tal usuario1")
})

test("multiple placeholders", () => {
  assert.equal(applyTemplate("{app}: {summary} — {body}", f), "WhatsApp: usuario1 — hola")
})

test("unknown placeholder left literal", () => {
  assert.equal(applyTemplate("hey {nope} {summary}", f), "hey {nope} usuario1")
})

test("no placeholders is unchanged", () => {
  assert.equal(applyTemplate("texto plano", f), "texto plano")
})

test("empty-value field replaces with empty string", () => {
  assert.equal(applyTemplate("[{body}]", { body: "" }), "[]")
})

test("braces without word chars are left literal", () => {
  assert.equal(applyTemplate("a {} {1x} b", f), "a {} {1x} b")
})
