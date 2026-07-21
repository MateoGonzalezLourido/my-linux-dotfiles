import { test } from "node:test"
import assert from "node:assert/strict"
import { obtenerGlifoAplicacion } from "./glifos.ts"

test("resuelve el JSON versionado sin depender de una ruta en HOME", () => {
  assert.equal(obtenerGlifoAplicacion("spotify.desktop"), "󰓇")
  assert.equal(obtenerGlifoAplicacion("org.mozilla.Firefox"), "󰈹")
})

test("respeta el orden de identificadores y devuelve null si no hay glifo", () => {
  assert.equal(obtenerGlifoAplicacion("kitty", "firefox"), "󰄛")
  assert.equal(obtenerGlifoAplicacion("aplicacion-inexistente"), null)
})
