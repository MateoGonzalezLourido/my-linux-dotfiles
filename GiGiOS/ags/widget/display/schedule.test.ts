import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHM, isWithinSchedule, isWithinWindow, activeSetpoint, activeRuleFor, normalizeRules } from "./schedule.ts"

test("parseHM convierte HH:MM a minutos", () => {
  assert.equal(parseHM("00:00"), 0)
  assert.equal(parseHM("21:30"), 21 * 60 + 30)
  assert.equal(parseHM("07:00"), 420)
})

test("isWithinWindow ventana normal (misma jornada)", () => {
  assert.equal(isWithinWindow({ h: 12, m: 0 }, "09:00", "17:00"), true)
  assert.equal(isWithinWindow({ h: 8, m: 0 }, "09:00", "17:00"), false)
  assert.equal(isWithinWindow({ h: 17, m: 0 }, "09:00", "17:00"), false) // fin exclusivo
})

test("isWithinWindow ventana que cruza medianoche", () => {
  assert.equal(isWithinWindow({ h: 23, m: 0 }, "21:00", "07:00"), true)
  assert.equal(isWithinWindow({ h: 3, m: 0 }, "21:00", "07:00"), true)
  assert.equal(isWithinWindow({ h: 12, m: 0 }, "21:00", "07:00"), false)
})

test("isWithinWindow con inicio == fin es ventana vacía", () => {
  assert.equal(isWithinWindow({ h: 10, m: 0 }, "10:00", "10:00"), false)
})

test("isWithinSchedule desactivado siempre false", () => {
  assert.equal(isWithinSchedule({ h: 23, m: 0 }, { enabled: false, start: "21:00", end: "07:00" }), false)
  assert.equal(isWithinSchedule({ h: 23, m: 0 }, { enabled: true, start: "21:00", end: "07:00" }), true)
})

// ── La franja SOLO rige dentro de sí misma ───────────────────────────────────

test("una franja de 10 a 11 no afecta a la 13:00 (ni a las 09:00)", () => {
  const rules = [{ start: "10:00", end: "11:00", temp: 3500, brightness: 40 }]
  assert.equal(activeSetpoint({ h: 10, m: 30 }, rules, "temp"), 3500)
  assert.equal(activeSetpoint({ h: 10, m: 30 }, rules, "brightness"), 40)
  assert.equal(activeSetpoint({ h: 13, m: 0 }, rules, "temp"), null)      // fuera: no rige
  assert.equal(activeSetpoint({ h: 13, m: 0 }, rules, "brightness"), null)
  assert.equal(activeSetpoint({ h: 9, m: 59 }, rules, "temp"), null)
  assert.equal(activeSetpoint({ h: 11, m: 0 }, rules, "temp"), null)      // fin exclusivo
})

test("una franja nocturna cruza la medianoche pero no se adelanta", () => {
  const rules = [{ start: "22:00", end: "07:00", temp: 3500, brightness: null }]
  assert.equal(activeSetpoint({ h: 19, m: 0 }, rules, "temp"), null)   // ← el caso que fallaba
  assert.equal(activeSetpoint({ h: 22, m: 0 }, rules, "temp"), 3500)
  assert.equal(activeSetpoint({ h: 3, m: 0 }, rules, "temp"), 3500)
  assert.equal(activeSetpoint({ h: 7, m: 0 }, rules, "temp"), null)
})

// ── Canales independientes ───────────────────────────────────────────────────

test("una franja de solo brillo no toca la luz nocturna", () => {
  const rules = [
    { start: "22:00", end: "07:00", temp: 3500, brightness: null },
    { start: "23:00", end: "23:30", temp: null, brightness: 30 },
  ]
  assert.equal(activeSetpoint({ h: 23, m: 10 }, rules, "temp"), 3500)      // sigue la nocturna
  assert.equal(activeSetpoint({ h: 23, m: 10 }, rules, "brightness"), 30)
  assert.equal(activeSetpoint({ h: 23, m: 40 }, rules, "brightness"), null) // se acabó el brillo
  assert.equal(activeSetpoint({ h: 23, m: 40 }, rules, "temp"), 3500)       // la luz no se entera
})

test("si dos franjas se solapan gana la que empezó más tarde", () => {
  const rules = [
    { start: "20:00", end: "23:00", temp: 4000, brightness: null },
    { start: "21:00", end: "22:00", temp: 3000, brightness: null },
  ]
  assert.equal(activeSetpoint({ h: 20, m: 30 }, rules, "temp"), 4000)
  assert.equal(activeSetpoint({ h: 21, m: 30 }, rules, "temp"), 3000) // la de dentro manda
  assert.equal(activeSetpoint({ h: 22, m: 30 }, rules, "temp"), 4000) // al acabar, vuelve la de fuera
})

test("activeRuleFor devuelve la regla vigente de cada canal (o null)", () => {
  const rules = [
    { start: "22:00", end: "07:00", temp: 3500, brightness: null },
    { start: "23:00", end: "23:30", temp: null, brightness: 30 },
  ]
  assert.equal(activeRuleFor({ h: 23, m: 10 }, rules, "temp")!.start, "22:00")
  assert.equal(activeRuleFor({ h: 23, m: 10 }, rules, "brightness")!.start, "23:00")
  assert.equal(activeRuleFor({ h: 12, m: 0 }, rules, "temp"), null)
})

// ── Migración y saneado ──────────────────────────────────────────────────────

test("normalizeRules migra el formato viejo (puntos de cambio) a franjas", () => {
  // El horario por defecto de antes: cálida a las 22:00, "apagar" a las 07:00.
  assert.deepEqual(
    normalizeRules([{ time: "22:00", temp: 3500 }, { time: "07:00", temp: 0 }]),
    [{ start: "22:00", end: "07:00", temp: 3500, brightness: null }],
  )
  // La regla que solo servía de terminador desaparece: ya no hace falta.
  assert.deepEqual(
    normalizeRules([{ time: "07:00", temp: 0 }]),
    [],
  )
})

test("normalizeRules descarta basura y acota los valores", () => {
  const out = normalizeRules([
    { start: "no-es-una-hora", end: "11:00", temp: 3500 },   // fuera
    null,                                                    // fuera
    { start: "10:00", end: "11:00", temp: "9999", brightness: "250" },  // acotados
    { start: "9:00", end: "09:30", temp: 0, brightness: 0 },  // temp 0 → null; brillo 0 → 1
  ])
  assert.deepEqual(out, [
    { start: "10:00", end: "11:00", temp: 6500, brightness: 100 },
    { start: "09:00", end: "09:30", temp: null, brightness: 1 },
  ])
})

test("normalizeRules ante algo que no es una lista devuelve []", () => {
  assert.deepEqual(normalizeRules(undefined), [])
  assert.deepEqual(normalizeRules({ start: "22:00" }), [])
})
