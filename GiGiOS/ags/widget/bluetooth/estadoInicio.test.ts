import assert from "node:assert/strict"
import test from "node:test"
import {
  resolverRestauracionBluetooth,
  valorBluetoothParaGuardar,
} from "./estadoInicio.ts"

test("espera al adaptador antes de restaurar el estado Bluetooth", () => {
  assert.deepEqual(
    resolverRestauracionBluetooth(false, false, true),
    { accion: null, completada: false },
  )
  assert.deepEqual(
    resolverRestauracionBluetooth(false, true, true),
    { accion: false, completada: false },
  )
})

test("completa la restauración cuando el adaptador alcanza el estado guardado", () => {
  assert.deepEqual(
    resolverRestauracionBluetooth(false, true, false),
    { accion: null, completada: true },
  )
  assert.deepEqual(
    resolverRestauracionBluetooth(null, false, false),
    { accion: null, completada: true },
  )
})

test("conserva el valor guardado mientras el adaptador todavía no está listo", () => {
  assert.equal(valorBluetoothParaGuardar(false, false, false, true), false)
  assert.equal(valorBluetoothParaGuardar(false, false, true, true), false)
  assert.equal(valorBluetoothParaGuardar(false, true, false, true), false)
  assert.equal(valorBluetoothParaGuardar(false, true, true, false), false)
  assert.equal(valorBluetoothParaGuardar(null, true, false, false), null)
})
