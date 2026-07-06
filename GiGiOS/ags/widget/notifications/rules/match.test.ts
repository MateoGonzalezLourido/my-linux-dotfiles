// widget/notifications/rules/match.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { matchString, matchInput } from "./match.ts"
import type { MatchSpec } from "./types.ts"

test("contains is case-insensitive by default", () => {
  assert.equal(matchString({ op: "contains", value: "Claude" }, "claude code login"), true)
})

test("contains respects ci:false", () => {
  assert.equal(matchString({ op: "contains", value: "Claude", ci: false }, "claude"), false)
})

test("equals matches whole string", () => {
  assert.equal(matchString({ op: "equals", value: "kitty" }, "kitty"), true)
  assert.equal(matchString({ op: "equals", value: "kitty" }, "kitty term"), false)
})

test("regex matches", () => {
  assert.equal(matchString({ op: "regex", value: "^perm" }, "permission needed"), true)
})

test("invalid regex returns false instead of throwing", () => {
  assert.equal(matchString({ op: "regex", value: "(" }, "anything"), false)
})

test("matchInput ANDs all present fields", () => {
  const spec: MatchSpec = { app: { op: "equals", value: "kitty" }, summary: { op: "contains", value: "claude" } }
  assert.equal(matchInput(spec, { appName: "kitty", summary: "Claude Code", body: "", urgency: 1 }), true)
  assert.equal(matchInput(spec, { appName: "kitty", summary: "other", body: "", urgency: 1 }), false)
})

test("empty matchspec matches everything", () => {
  assert.equal(matchInput({}, { appName: "x", summary: "", body: "", urgency: 0 }), true)
})
