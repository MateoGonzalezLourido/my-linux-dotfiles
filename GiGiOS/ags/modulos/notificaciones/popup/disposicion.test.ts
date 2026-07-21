import test from "node:test"
import assert from "node:assert/strict"
import { canFitPopup } from "./disposicion.ts"

test("caps the visible stack at five popups", () => {
  assert.equal(canFitPopup([80, 80, 80, 80, 80], 80, 1000, 5, 8), false)
})

test("rejects a popup when the visible stack would exceed the screen", () => {
  assert.equal(canFitPopup([140, 140, 140], 140, 500, 5, 8), false)
})

test("accepts another popup when both limits allow it", () => {
  assert.equal(canFitPopup([80, 80, 80], 80, 500, 5, 8), true)
})

test("allows one popup on an unusually short screen", () => {
  assert.equal(canFitPopup([], 200, 100, 5, 8), true)
})
