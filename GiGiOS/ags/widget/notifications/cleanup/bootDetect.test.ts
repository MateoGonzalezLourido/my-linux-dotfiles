// widget/notifications/cleanup/bootDetect.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseBtime } from "./btime.ts"

test("parses btime line from /proc/stat content", () => {
  const stat = ["cpu  1 2 3", "intr 999", "btime 1782570000", "processes 42"].join("\n")
  assert.equal(parseBtime(stat), 1782570000)
})

test("returns null when btime absent", () => {
  assert.equal(parseBtime("cpu 1 2 3\nintr 5"), null)
})
