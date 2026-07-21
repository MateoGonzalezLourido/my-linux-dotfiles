import { test } from "node:test"
import assert from "node:assert/strict"
import { interpretarCaptura, tooltipCaptura } from "./capturaDatos.ts"

test("exige fuentes válidas para activar la captura", () => {
  assert.deepEqual(interpretarCaptura('{"active":true,"sources":[]}'), { active: false, sources: [] })
  assert.deepEqual(interpretarCaptura('{"active":true,"sources":[{"kind":"share","app":"Discord"}]}'), {
    active: true,
    sources: [{ kind: "share", app: "Discord" }],
  })
})

test("agrupa aplicaciones sin duplicados en el tooltip", () => {
  assert.equal(tooltipCaptura({ active: true, sources: [
    { kind: "share", app: "Discord" },
    { kind: "share", app: "Discord" },
    { kind: "record", app: "OBS" },
  ] }), "Compartiendo pantalla · Discord\nGrabando pantalla · OBS")
})
