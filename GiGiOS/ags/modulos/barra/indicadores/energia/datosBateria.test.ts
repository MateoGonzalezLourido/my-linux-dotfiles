import { test } from "node:test"
import assert from "node:assert/strict"
import {
  claseEstadoBateria,
  clasesSegmentosBateria,
  formatearTiempoBateria,
} from "./datosBateria.ts"

test("formatea tiempos de batería", () => {
  assert.equal(formatearTiempoBateria(90), "1m")
  assert.equal(formatearTiempoBateria(3660), "1h 1m")
})

test("clasifica carga normal y baja", () => {
  assert.equal(claseEstadoBateria(9, false), "low")
  assert.equal(claseEstadoBateria(50, false), "normal")
  assert.equal(claseEstadoBateria(9, true), "charging")
})

test("marca el segmento animado al cargar y el primero al estar baja", () => {
  assert.ok(clasesSegmentosBateria(50, true, false)[2].includes("charging-blink"))
  const baja = clasesSegmentosBateria(5, false, false)[0]
  assert.ok(baja.includes("filled"))
  assert.ok(baja.includes("low-blink"))
})
