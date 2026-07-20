import test from "node:test"
import assert from "node:assert/strict"
import { alternarModoDaltonismo, normalizarModoDaltonismo } from "./daltonismo.ts"

test("normaliza valores persistidos desconocidos al modo desactivado", () => {
  assert.equal(normalizarModoDaltonismo("protanopia"), "protanopia")
  assert.equal(normalizarModoDaltonismo("tripanopia"), "ninguno")
  assert.equal(normalizarModoDaltonismo(null), "ninguno")
})

test("activar un modo sustituye al anterior", () => {
  assert.equal(alternarModoDaltonismo("protanopia", "deuteranopia"), "deuteranopia")
})

test("pulsar el modo activo desactiva la corrección", () => {
  assert.equal(alternarModoDaltonismo("tritanopia", "tritanopia"), "ninguno")
})
