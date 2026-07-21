import { test } from "node:test"
import assert from "node:assert/strict"
import {
  candidatosIdentificadorAplicacion,
  nombreBaseAplicacion,
  sinExtensionAplicacion,
} from "./identificadores.ts"

test("normaliza ids desktop, clases namespaced y ejecutables de Wine", () => {
  assert.equal(sinExtensionAplicacion(" Spotify.DESKTOP "), "spotify")
  assert.equal(nombreBaseAplicacion("org.factorio.Factorio"), "factorio")
  assert.equal(nombreBaseAplicacion("EldenRing.EXE"), "eldenring")
})

test("los candidatos conservan prioridad y eliminan duplicados", () => {
  assert.deepEqual(candidatosIdentificadorAplicacion("org.mozilla.Firefox.desktop"), [
    "firefox",
    "org.mozilla.firefox.desktop",
    "org.mozilla.firefox",
  ])
  assert.deepEqual(candidatosIdentificadorAplicacion("spotify.desktop"), [
    "spotify.desktop",
    "spotify",
  ])
})
