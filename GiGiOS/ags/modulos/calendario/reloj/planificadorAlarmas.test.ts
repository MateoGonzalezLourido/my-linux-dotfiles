import { test } from "node:test"
import assert from "node:assert/strict"
import {
  alarmasQueVencen,
  diaSemanaDe,
  proximaActivacion,
  sanearAlCargar,
  siguienteVencimiento,
  textoProximaActivacion,
  textoRepeticion,
  trasSonar,
} from "./planificadorAlarmas.ts"
import type { Alarma, AlarmaPuntual, AlarmaSemanal } from "./tipos.ts"

// Martes 21 de julio de 2026, 10:00 en hora LOCAL.
const AHORA = new Date(2026, 6, 21, 10, 0, 0, 0).getTime()
const enLocal = (a: number, m: number, d: number, h: number, min = 0) =>
  new Date(a, m - 1, d, h, min, 0, 0).getTime()

const puntual = (p: Partial<AlarmaPuntual> = {}): AlarmaPuntual => ({
  id: "p1",
  etiqueta: "Cita",
  hora: "12:00",
  activa: true,
  tipo: "puntual",
  fecha: "2026-07-21",
  ...p,
})

const semanal = (p: Partial<AlarmaSemanal> = {}): AlarmaSemanal => ({
  id: "s1",
  etiqueta: "Trabajo",
  hora: "07:00",
  activa: true,
  tipo: "semanal",
  dias: [0, 1, 2, 3, 4],
  ...p,
})

test("diaSemanaDe usa lunes = 0", () => {
  assert.equal(diaSemanaDe(new Date(2026, 6, 20)), 0) // lunes
  assert.equal(diaSemanaDe(new Date(2026, 6, 21)), 1) // martes
  assert.equal(diaSemanaDe(new Date(2026, 6, 26)), 6) // domingo
})

test("una alarma puntual futura devuelve su instante exacto", () => {
  assert.equal(proximaActivacion(puntual(), AHORA), enLocal(2026, 7, 21, 12, 0))
  assert.equal(proximaActivacion(puntual({ fecha: "2026-08-01", hora: "06:30" }), AHORA), enLocal(2026, 8, 1, 6, 30))
})

test("una alarma puntual ya pasada no vuelve a sonar", () => {
  assert.equal(proximaActivacion(puntual({ hora: "08:00" }), AHORA), null)
  assert.equal(proximaActivacion(puntual({ fecha: "2026-07-20" }), AHORA), null)
})

test("una alarma desactivada nunca tiene próxima activación", () => {
  assert.equal(proximaActivacion(puntual({ activa: false }), AHORA), null)
  assert.equal(proximaActivacion(semanal({ activa: false }), AHORA), null)
})

test("la semanal de hoy que ya sonó salta al siguiente día marcado", () => {
  // Martes 10:00; alarma de lunes a viernes a las 07:00 → la de hoy ya pasó, toca mañana.
  assert.equal(proximaActivacion(semanal(), AHORA), enLocal(2026, 7, 22, 7, 0))
})

test("la semanal de hoy que aún no ha sonado suena hoy", () => {
  assert.equal(proximaActivacion(semanal({ hora: "18:00" }), AHORA), enLocal(2026, 7, 21, 18, 0))
})

test("una semanal de un solo día que ya pasó salta SIETE días, no seis", () => {
  // Alarma solo los martes a las 07:00, y hoy es martes a las 10:00: toca el martes que viene.
  const soloMartes = semanal({ dias: [1], hora: "07:00" })
  assert.equal(proximaActivacion(soloMartes, AHORA), enLocal(2026, 7, 28, 7, 0))
})

test("una semanal cruza el fin de semana y el cambio de mes", () => {
  const soloLunes = semanal({ dias: [0], hora: "07:00" })
  assert.equal(proximaActivacion(soloLunes, AHORA), enLocal(2026, 7, 27, 7, 0))
  // Desde el viernes 31 de julio, el lunes siguiente ya es agosto.
  const viernes31 = new Date(2026, 6, 31, 20, 0).getTime()
  assert.equal(proximaActivacion(soloLunes, viernes31), enLocal(2026, 8, 3, 7, 0))
})

test("una semanal sin días marcados no suena: activarla no significa «todos»", () => {
  assert.equal(proximaActivacion(semanal({ dias: [] }), AHORA), null)
})

test("una hora corrupta no hace sonar la alarma", () => {
  assert.equal(proximaActivacion(semanal({ hora: "99:99" }), AHORA), null)
  assert.equal(proximaActivacion(puntual({ fecha: "2026-02-30" }), AHORA), null)
})

test("siguienteVencimiento devuelve solo la más próxima", () => {
  const lista: Alarma[] = [
    semanal({ id: "manana", hora: "18:00" }),
    puntual({ id: "pronto", hora: "11:00" }),
    puntual({ id: "vencida", hora: "08:00" }),
  ]
  const v = siguienteVencimiento(lista, AHORA)!
  assert.equal(v.alarma.id, "pronto")
  assert.equal(v.cuando, enLocal(2026, 7, 21, 11, 0))
})

test("sin alarmas vivas no hay vencimiento que armar", () => {
  assert.equal(siguienteVencimiento([], AHORA), null)
  assert.equal(siguienteVencimiento([puntual({ activa: false })], AHORA), null)
})

test("alarmasQueVencen coge las que acaban de sonar, no las futuras", () => {
  const justoAhora = puntual({ id: "ahora", hora: "10:00" })
  const futura = puntual({ id: "futura", hora: "11:00" })
  const vieja = puntual({ id: "vieja", hora: "09:00" })
  const ids = alarmasQueVencen([justoAhora, futura, vieja], AHORA).map((a) => a.id)
  assert.deepEqual(ids, ["ahora"])
})

test("dos alarmas a la misma hora suenan las dos", () => {
  const a = puntual({ id: "a", hora: "10:00" })
  const b = semanal({ id: "b", hora: "10:00", dias: [1] })
  assert.equal(alarmasQueVencen([a, b], AHORA).length, 2)
})

test("trasSonar desactiva la puntual y deja viva la semanal", () => {
  assert.equal((trasSonar(puntual()) as AlarmaPuntual).activa, false)
  assert.equal((trasSonar(semanal()) as AlarmaSemanal).activa, true)
})

test("al cargar, las puntuales vencidas se desactivan EN SILENCIO", () => {
  const lista: Alarma[] = [
    puntual({ id: "vencida", hora: "08:00" }),
    puntual({ id: "viva", hora: "23:00" }),
    semanal({ id: "sem", hora: "07:00" }),
  ]
  const { alarmas, desactivadas } = sanearAlCargar(lista, AHORA)
  assert.deepEqual(desactivadas, ["vencida"])
  assert.equal(alarmas.find((a) => a.id === "vencida")!.activa, false)
  assert.equal(alarmas.find((a) => a.id === "viva")!.activa, true)
  assert.equal(alarmas.find((a) => a.id === "sem")!.activa, true, "la semanal nunca se desactiva sola")
})

test("una semanal cuya hora ya pasó hoy NO se desactiva al cargar", () => {
  // Es la mitad complementaria: solo las puntuales caducan.
  const { desactivadas } = sanearAlCargar([semanal({ hora: "07:00" })], AHORA)
  assert.deepEqual(desactivadas, [])
})

test("sanearAlCargar no toca lo que ya estaba desactivado", () => {
  const original = puntual({ hora: "08:00", activa: false })
  const { alarmas, desactivadas } = sanearAlCargar([original], AHORA)
  assert.deepEqual(desactivadas, [])
  assert.equal(alarmas[0], original, "no se clona lo que no cambia")
})

test("textoRepeticion resume los días", () => {
  assert.equal(textoRepeticion(puntual()), "Una vez")
  assert.equal(textoRepeticion(semanal({ dias: [0, 1, 2, 3, 4] })), "Entre semana")
  assert.equal(textoRepeticion(semanal({ dias: [5, 6] })), "Fin de semana")
  assert.equal(textoRepeticion(semanal({ dias: [0, 1, 2, 3, 4, 5, 6] })), "Todos los días")
  assert.equal(textoRepeticion(semanal({ dias: [2, 0] })), "L X")
  assert.equal(textoRepeticion(semanal({ dias: [] })), "Sin días")
})

test("textoProximaActivacion", () => {
  assert.equal(textoProximaActivacion(puntual({ hora: "10:45" }), AHORA), "En 45 min")
  assert.equal(textoProximaActivacion(puntual({ hora: "13:00" }), AHORA), "En 3 h")
  assert.equal(textoProximaActivacion(puntual({ hora: "13:12" }), AHORA), "En 3 h 12 min")
  assert.equal(textoProximaActivacion(puntual({ fecha: "2026-07-22", hora: "10:00" }), AHORA), "Mañana")
  assert.equal(textoProximaActivacion(puntual({ fecha: "2026-07-25", hora: "10:00" }), AHORA), "En 4 días")
  assert.equal(textoProximaActivacion(puntual({ hora: "08:00" }), AHORA), null)
})
