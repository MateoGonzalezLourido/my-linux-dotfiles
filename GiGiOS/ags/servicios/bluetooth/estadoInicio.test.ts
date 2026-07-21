import assert from "node:assert/strict"
import test from "node:test"
import {
  resolverRestauracionBluetooth,
  valorBluetoothParaGuardar,
} from "./estadoInicio.ts"

test("espera al adaptador antes de restaurar el estado Bluetooth", () => {
  assert.deepEqual(
    resolverRestauracionBluetooth(false, false, true, true),
    { accion: null, completada: false },
  )
  assert.deepEqual(
    resolverRestauracionBluetooth(false, true, true, true),
    { accion: false, completada: false },
  )
})

test("completa la restauración cuando el adaptador alcanza el estado guardado", () => {
  assert.deepEqual(
    resolverRestauracionBluetooth(false, true, false, true),
    { accion: null, completada: true },
  )
  assert.deepEqual(
    resolverRestauracionBluetooth(null, false, false, true),
    { accion: null, completada: true },
  )
})

// El AutoEnable de BlueZ enciende el controlador DESPUÉS de registrar el adaptador.
// Cerrar la restauración en esa ventana (adaptador ya visible, todavía apagado) hacía
// que el encendido posterior se guardara como si lo hubiera pedido el usuario.
test("no cierra la restauración mientras el adaptador no se haya asentado", () => {
  assert.deepEqual(
    resolverRestauracionBluetooth(false, true, false, false),
    { accion: null, completada: false },
  )
})

test("corrige el encendido automático de BlueZ mientras la restauración sigue viva", () => {
  assert.deepEqual(
    resolverRestauracionBluetooth(false, true, true, false),
    { accion: false, completada: false },
  )
})

test("sin estado guardado no hay nada que restaurar ni que esperar", () => {
  assert.deepEqual(
    resolverRestauracionBluetooth(null, true, true, false),
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
