import assert from "node:assert/strict"
import test from "node:test"
import { getBluetoothTileInfo } from "./tileState.ts"

test("shows incompatible when no Bluetooth adapter exists", () => {
  assert.deepEqual(
    getBluetoothTileInfo(false, false, []),
    { label: "Incompatible", icon: "󰂲" },
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
