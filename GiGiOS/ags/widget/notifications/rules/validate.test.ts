import { test } from "node:test"
import assert from "node:assert/strict"
import { validateRule } from "./validate.ts"
import type { NotifRule } from "./types.ts"

function rule(p: Partial<NotifRule>): NotifRule {
  return { id: "r", name: "r", enabled: true, priority: 100, source: "user", match: {}, effects: {}, ...p }
}

test("a plain rule is valid", () => {
  assert.deepEqual(validateRule(rule({ effects: { muteAudio: true } })), [])
})

test("timed without a valid duration is invalid", () => {
  assert.equal(validateRule(rule({ effects: { lifetime: "timed" } })).length, 1)
  assert.equal(validateRule(rule({ effects: { lifetime: "timed", ttlMs: 0 } })).length, 1)
})

test("timed with a positive duration is valid", () => {
  assert.deepEqual(validateRule(rule({ effects: { lifetime: "timed", ttlMs: 900_000 } })), [])
})

test("non-timed lifetime doesn't require a duration", () => {
  assert.deepEqual(validateRule(rule({ effects: { lifetime: "flash" } })), [])
})

test("invalid regex in a match field is reported", () => {
  const errs = validateRule(rule({ match: { summary: { op: "regex", value: "(" } } }))
  assert.equal(errs.length, 1)
  assert.match(errs[0], /Expresión regular inválida en título/)
})

test("valid regex passes; non-regex op is never checked", () => {
  assert.deepEqual(validateRule(rule({ match: { app: { op: "regex", value: "^foo$" } } })), [])
  assert.deepEqual(validateRule(rule({ match: { app: { op: "contains", value: "(" } } })), [])
})

test("multiple problems are all reported", () => {
  const errs = validateRule(rule({
    effects: { lifetime: "timed" },
    match: { body: { op: "regex", value: "[" } },
  }))
  assert.equal(errs.length, 2)
})
