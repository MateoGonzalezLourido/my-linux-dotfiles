import { test } from "node:test"
import assert from "node:assert/strict"
import { crearReglaAplicacion, idReglaAplicacion } from "./reglasAplicacion.ts"

test("crea de forma uniforme las reglas rápidas por aplicación", () => {
  const bloqueo = crearReglaAplicacion("bloqueo", "Discord")
  const silencio = crearReglaAplicacion("silencio", "Discord")

  assert.equal(bloqueo.id, idReglaAplicacion("bloqueo", "Discord"))
  assert.deepEqual(bloqueo.match.app, { op: "equals", value: "Discord" })
  assert.equal(bloqueo.effects.suppress, true)
  assert.equal(silencio.id, "user.muteaudio.Discord")
  assert.equal(silencio.effects.muteAudio, true)
})
