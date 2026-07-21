import assert from "node:assert/strict"
import test from "node:test"
import { getBluetoothTileInfo } from "./tileState.ts"

test("shows incompatible when no Bluetooth adapter exists", () => {
  assert.deepEqual(
    getBluetoothTileInfo(false, false, []),
    { label: "Incompatible", icon: "󰂲", active: false },
  )
})

// El CSS y el texto describen el mismo hecho, así que salen del mismo objeto: el tile
// no puede pintarse encendido con un texto de apagado (que es justo lo que pasaba
// cuando el CSS se derivaba por su cuenta de `notify::is-powered`).
test("el CSS activo va de la mano del texto, nunca al revés", () => {
  assert.equal(getBluetoothTileInfo(false, true, []).active, false)
  assert.equal(getBluetoothTileInfo(true, false, []).active, false)
  assert.equal(getBluetoothTileInfo(true, true, []).active, true)
  assert.equal(
    getBluetoothTileInfo(true, true, [{ connected: true, name: "Headphones" }]).active,
    true,
  )
})

test("adapter compatibility takes precedence over stale powered/device state", () => {
  assert.equal(
    getBluetoothTileInfo(false, true, [{ connected: true, name: "Headphones" }]).label,
    "Incompatible",
  )
})

test("keeps the normal off and disconnected states for supported adapters", () => {
  assert.equal(getBluetoothTileInfo(true, false, []).label, "Desactivado")
  assert.equal(getBluetoothTileInfo(true, true, []).label, "Desconectado")
})
