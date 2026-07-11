import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHM, isWithinSchedule, activeRule } from "./schedule.ts"

test("parseHM convierte HH:MM a minutos", () => {
  assert.equal(parseHM("00:00"), 0)
  assert.equal(parseHM("21:30"), 21 * 60 + 30)
  assert.equal(parseHM("07:00"), 420)
})

test("isWithinSchedule ventana normal (misma jornada)", () => {
  const s = { enabled: true, start: "09:00", end: "17:00" }
  assert.equal(isWithinSchedule({ h: 12, m: 0 }, s), true)
  assert.equal(isWithinSchedule({ h: 8, m: 0 }, s), false)
  assert.equal(isWithinSchedule({ h: 17, m: 0 }, s), false) // fin exclusivo
})

test("isWithinSchedule ventana que cruza medianoche", () => {
  const s = { enabled: true, start: "21:00", end: "07:00" }
  assert.equal(isWithinSchedule({ h: 23, m: 0 }, s), true)
  assert.equal(isWithinSchedule({ h: 3, m: 0 }, s), true)
  assert.equal(isWithinSchedule({ h: 12, m: 0 }, s), false)
})

test("isWithinSchedule desactivado siempre false", () => {
  assert.equal(isWithinSchedule({ h: 23, m: 0 }, { enabled: false, start: "21:00", end: "07:00" }), false)
})

test("activeRule elige la última regla que ya pasó", () => {
  const rules = [{ time: "10:00", temp: 5000 }, { time: "22:00", temp: 3000 }, { time: "18:00", temp: 4000 }]
  assert.equal(activeRule({ h: 11, m: 0 }, rules).temp, 5000) // tras 10:00
  assert.equal(activeRule({ h: 19, m: 30 }, rules).temp, 4000) // tras 18:00
  assert.equal(activeRule({ h: 23, m: 0 }, rules).temp, 3000) // tras 22:00
})

test("activeRule antes de la primera regla envuelve a la última del día", () => {
  const rules = [{ time: "10:00", temp: 5000 }, { time: "22:00", temp: 3000 }]
  assert.equal(activeRule({ h: 3, m: 0 }, rules).temp, 3000) // 22:00 de ayer sigue vigente
})

test("activeRule sin reglas devuelve null", () => {
  assert.equal(activeRule({ h: 12, m: 0 }, []), null)
})
