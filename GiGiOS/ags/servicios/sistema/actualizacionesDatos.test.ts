import { test } from "node:test"
import assert from "node:assert/strict"
import { interpretarActualizaciones } from "./actualizacionesDatos.ts"

test("normaliza un JSON de actualizaciones válido", () => {
  const datos = interpretarActualizaciones(JSON.stringify({
    system: 2,
    kernel: [{ name: "linux", from: "1", to: "2" }, { roto: true }],
    gpu: [{ name: "mesa" }],
    updateCmd: "sudo pacman -Syu",
    systemSample: ["foo", 2],
  }))
  assert.equal(datos.system, 2)
  assert.deepEqual(datos.kernel, [{ name: "linux", from: "1", to: "2" }])
  assert.deepEqual(datos.gpu, [{ name: "mesa", from: "", to: "" }])
  assert.deepEqual(datos.systemSample, ["foo"])
})

test("un JSON corrupto degrada a datos vacíos", () => {
  assert.deepEqual(interpretarActualizaciones("{"), {
    system: 0, kernel: [], gpu: [], updateCmd: "", systemSample: [],
  })
})
