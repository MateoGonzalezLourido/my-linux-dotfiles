import { test } from "node:test"
import assert from "node:assert/strict"
import { parseDuration, formatDuration } from "./duration.ts"

test("parses single units", () => {
  assert.equal(parseDuration("3min"), 180_000)
  assert.equal(parseDuration("15min"), 900_000)
  assert.equal(parseDuration("3h"), 10_800_000)
  assert.equal(parseDuration("2d"), 172_800_000)
  assert.equal(parseDuration("30s"), 30_000)
})

test("parses combined units in any spacing", () => {
  assert.equal(parseDuration("2d 4h 5min"), 172_800_000 + 14_400_000 + 300_000)
  assert.equal(parseDuration("4h5min"), 14_400_000 + 300_000)
})

test("'m' is minutes, 'min' is minutes (not m+in)", () => {
  assert.equal(parseDuration("5m"), 300_000)
  assert.equal(parseDuration("5min"), 300_000)
})

test("empty or junk → null", () => {
  assert.equal(parseDuration(""), null)
  assert.equal(parseDuration("   "), null)
  assert.equal(parseDuration("abc"), null)
})

test("formatDuration round-trips", () => {
  assert.equal(formatDuration(180_000), "3min")
  assert.equal(formatDuration(172_800_000 + 14_400_000 + 300_000), "2d 4h 5min")
  assert.equal(formatDuration(10_800_000), "3h")
  assert.equal(formatDuration(30_000), "30s")
})

test("formatDuration of zero/negative is empty", () => {
  assert.equal(formatDuration(0), "")
  assert.equal(formatDuration(-5), "")
})
