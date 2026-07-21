import test from "node:test"
import assert from "node:assert/strict"
import { PopupBurstGuard } from "./rafaga.ts"

test("starts a burst only after exceeding the threshold", () => {
  const guard = new PopupBurstGuard(20, 8000)

  for (let i = 0; i < 20; i += 1) {
    assert.equal(guard.record(i * 100).bursting, false)
  }

  assert.deepEqual(guard.record(2000), { bursting: true, triggered: true, count: 21 })
})

test("counts every notification received while a burst is active", () => {
  const guard = new PopupBurstGuard(2, 8000)

  guard.record(0)
  guard.record(100)
  guard.record(200)

  assert.deepEqual(guard.record(9000), { bursting: true, triggered: false, count: 4 })
  assert.equal(guard.finish(), 4)
})

test("forgets notifications outside the detection window", () => {
  const guard = new PopupBurstGuard(2, 8000)

  guard.record(0)
  guard.record(100)

  assert.deepEqual(guard.record(9000), { bursting: false, triggered: false, count: 1 })
})
