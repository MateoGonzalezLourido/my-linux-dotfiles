// modulos/notificaciones/rules/color.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { isValidHex, normalizeHex, hexToRgb, COLOR_PRESETS } from "./color.ts"

test("isValidHex accepts #rgb and #rrggbb, rejects the rest", () => {
  assert.equal(isValidHex("#fff"), true)
  assert.equal(isValidHex("#89b4fa"), true)
  assert.equal(isValidHex("#89B4FA"), true)
  assert.equal(isValidHex("89b4fa"), false)   // missing #
  assert.equal(isValidHex("#12"), false)      // wrong length
  assert.equal(isValidHex("#1234"), false)    // wrong length
  assert.equal(isValidHex("#gggggg"), false)  // non-hex
  assert.equal(isValidHex(""), false)
})

test("normalizeHex canonicalizes to lowercase #rrggbb, expands shorthand, adds #", () => {
  assert.equal(normalizeHex("#89B4FA"), "#89b4fa")
  assert.equal(normalizeHex("89b4fa"), "#89b4fa")
  assert.equal(normalizeHex("  #FFF  "), "#ffffff")
  assert.equal(normalizeHex("f0a"), "#ff00aa")
})

test("normalizeHex returns undefined for empty/invalid (means 'auto')", () => {
  assert.equal(normalizeHex(""), undefined)
  assert.equal(normalizeHex("   "), undefined)
  assert.equal(normalizeHex("#12"), undefined)
  assert.equal(normalizeHex("nope"), undefined)
})

test("all presets are valid, canonical hex", () => {
  for (const p of COLOR_PRESETS) {
    assert.equal(isValidHex(p.hex), true, `${p.name} invalid`)
    assert.equal(normalizeHex(p.hex), p.hex, `${p.name} not canonical`)
  }
})

test("hexToRgb splits into r,g,b and falls back on bad input", () => {
  assert.equal(hexToRgb("#89b4fa"), "137,180,250")
  assert.equal(hexToRgb("#ffffff"), "255,255,255")
  assert.equal(hexToRgb("#fff"), "255,255,255") // wrong length → fallback
})
