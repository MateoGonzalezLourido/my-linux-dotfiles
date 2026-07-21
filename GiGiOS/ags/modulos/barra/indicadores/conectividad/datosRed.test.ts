import { test } from "node:test"
import assert from "node:assert/strict"
import { barrasActivas, clasesBarrasRed, determinarTipoRed } from "./datosRed.ts"

test("da preferencia a la red primaria y después al cable", () => {
  assert.equal(determinarTipoRed("wifi", true, true), "wifi")
  assert.equal(determinarTipoRed("unknown", true, true), "wired")
  assert.equal(determinarTipoRed("wired", false, true), "wifi")
  assert.equal(determinarTipoRed("unknown", false, false), "none")
})

test("calcula los cuatro niveles de intensidad", () => {
  assert.equal(barrasActivas(14), 0)
  assert.equal(barrasActivas(15), 1)
  assert.equal(barrasActivas(60), 3)
  assert.equal(barrasActivas(80), 4)
})

test("el cable no enciende barras wifi", () => {
  assert.equal(clasesBarrasRed(100, "wired").some((clases) => clases.includes("active")), false)
})
