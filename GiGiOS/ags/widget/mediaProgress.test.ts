import assert from "node:assert/strict"
import test from "node:test"
import { resolveMediaLengthSeconds, safeMediaPosition } from "./mediaProgress.ts"

test("uses Astal's duration when it is already initialized", () => {
  assert.equal(resolveMediaLengthSeconds(265, 120_000_000), 265)
})

test("falls back to the raw Firefox MPRIS duration", () => {
  assert.equal(resolveMediaLengthSeconds(0, 265_000_000), 265)
})

test("accepts playerctl's textual mpris:length output", () => {
  assert.equal(resolveMediaLengthSeconds(0, "265000000\n"), 265)
})

test("does not invent a duration when neither source has one", () => {
  assert.equal(resolveMediaLengthSeconds(0, ""), null)
  assert.equal(resolveMediaLengthSeconds(-1, undefined), null)
})

test("normalizes unsupported and out-of-range positions", () => {
  assert.equal(safeMediaPosition(-1, 265), 0)
  assert.equal(safeMediaPosition(300, 265), 265)
  assert.equal(safeMediaPosition(75.5, 265), 75.5)
})
