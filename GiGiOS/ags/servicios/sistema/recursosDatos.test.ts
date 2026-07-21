import { test } from "node:test"
import assert from "node:assert/strict"
import {
  calcularUsoCpu,
  formatearProcesoCpu,
  formatearProcesoRam,
  interpretarMuestraCpu,
  interpretarRamUsadaGiB,
} from "./recursosDatos.ts"

test("interpreta /proc/stat y calcula CPU por delta", () => {
  const anterior = interpretarMuestraCpu("cpu  100 0 50 850 0 0 0 0\n")!
  const actual = interpretarMuestraCpu("cpu  150 0 50 900 0 0 0 0\n")!
  assert.deepEqual(anterior, { total: 1000, inactivo: 850 })
  assert.equal(calcularUsoCpu(anterior, actual), 50)
})

test("interpreta RAM usada mediante MemAvailable", () => {
  const usada = interpretarRamUsadaGiB("MemTotal: 8388608 kB\nMemAvailable: 6291456 kB\n")
  assert.equal(usada, 2)
  assert.equal(interpretarRamUsadaGiB("MemTotal: 42 kB\n"), null)
})

test("formatea los procesos superiores defensivamente", () => {
  assert.equal(formatearProcesoCpu("12.5 firefox"), "firefox (12.5%)")
  assert.equal(formatearProcesoRam("1048576 firefox"), "firefox (1.0G)")
  assert.equal(formatearProcesoCpu(""), null)
})
