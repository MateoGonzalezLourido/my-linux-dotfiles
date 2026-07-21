import { test } from "node:test"
import assert from "node:assert/strict"
import {
  aFechaISO,
  claveInstante,
  compararFechas,
  construirCuadriculaMes,
  desdeFechaISO,
  desplazarMes,
  diaSemana,
  diasEnMes,
  diferenciaEnDias,
  esBisiesto,
  esFechaValida,
  esHoraValida,
  formatearFechaLarga,
  hoyISO,
  horaAMinutos,
  minutosAHora,
  primerDiaSemanaDelMes,
  rangoFechas,
  sumarDias,
} from "./fechas.ts"

test("años bisiestos", () => {
  assert.equal(esBisiesto(2024), true)
  assert.equal(esBisiesto(2026), false)
  assert.equal(esBisiesto(1900), false) // divisible por 100 pero no por 400
  assert.equal(esBisiesto(2000), true)
  assert.equal(diasEnMes(2024, 2), 29)
  assert.equal(diasEnMes(2026, 2), 28)
  assert.equal(diasEnMes(2026, 12), 31)
  assert.equal(diasEnMes(2026, 13), 0)
})

test("desdeFechaISO rechaza días que no existen", () => {
  assert.deepEqual(desdeFechaISO("2026-07-21"), { anio: 2026, mes: 7, dia: 21 })
  assert.equal(desdeFechaISO("2026-02-30"), null)
  assert.equal(desdeFechaISO("2026-13-01"), null)
  assert.equal(desdeFechaISO("2026-00-10"), null)
  assert.equal(desdeFechaISO("2026-7-1"), null) // sin relleno de ceros no es el formato canónico
  assert.equal(desdeFechaISO(""), null)
  assert.equal(esFechaValida("2024-02-29"), true)
  assert.equal(esFechaValida("2026-02-29"), false)
})

test("horas", () => {
  assert.equal(esHoraValida("00:00"), true)
  assert.equal(esHoraValida("23:59"), true)
  assert.equal(esHoraValida("24:00"), false)
  assert.equal(esHoraValida("9:30"), false)
  assert.equal(horaAMinutos("09:30"), 570)
  assert.equal(horaAMinutos("basura"), -1)
  assert.equal(minutosAHora(570), "09:30")
  assert.equal(minutosAHora(-5), "00:00")
  assert.equal(minutosAHora(99999), "23:59") // se recorta al día: no existe "24:00"
})

test("sumarDias cruza meses y años", () => {
  assert.equal(sumarDias("2026-07-21", 1), "2026-07-22")
  assert.equal(sumarDias("2026-07-31", 1), "2026-08-01")
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01")
  assert.equal(sumarDias("2027-01-01", -1), "2026-12-31")
  assert.equal(sumarDias("2024-02-28", 1), "2024-02-29")
  assert.equal(sumarDias("2026-02-28", 1), "2026-03-01")
  assert.equal(sumarDias("2026-01-31", 30), "2026-03-02")
})

test("sumarDias no salta días en el cambio de horario de verano", () => {
  // En España el horario de verano entra el último domingo de marzo y sale el de octubre. Con
  // aritmética en hora local, 00:00 + 24 h cae en las 23:00 del día anterior (o del siguiente) y la
  // fecha se corrompe. Con Date.UTC no puede pasar.
  assert.equal(sumarDias("2026-03-28", 1), "2026-03-29")
  assert.equal(sumarDias("2026-03-29", 1), "2026-03-30")
  assert.equal(sumarDias("2026-10-24", 1), "2026-10-25")
  assert.equal(sumarDias("2026-10-25", 1), "2026-10-26")
})

test("diferenciaEnDias", () => {
  assert.equal(diferenciaEnDias("2026-07-21", "2026-07-24"), 3)
  assert.equal(diferenciaEnDias("2026-07-24", "2026-07-21"), -3)
  assert.equal(diferenciaEnDias("2026-07-21", "2026-07-21"), 0)
  assert.equal(diferenciaEnDias("2024-02-28", "2024-03-01"), 2) // bisiesto
  assert.equal(diferenciaEnDias("2026-01-01", "2027-01-01"), 365)
})

test("compararFechas ordena cronológicamente comparando cadenas", () => {
  assert.equal(compararFechas("2026-07-21", "2026-07-22"), -1)
  assert.equal(compararFechas("2026-12-01", "2027-01-01"), -1)
  assert.equal(compararFechas("2026-07-21", "2026-07-21"), 0)
  const desordenadas = ["2026-12-01", "2026-01-05", "2026-01-30"]
  assert.deepEqual([...desordenadas].sort(compararFechas), ["2026-01-05", "2026-01-30", "2026-12-01"])
})

test("rangoFechas incluye ambos extremos y devuelve vacío si está invertido", () => {
  assert.deepEqual(rangoFechas("2026-07-21", "2026-07-23"), ["2026-07-21", "2026-07-22", "2026-07-23"])
  assert.deepEqual(rangoFechas("2026-07-21", "2026-07-21"), ["2026-07-21"])
  assert.deepEqual(rangoFechas("2026-07-23", "2026-07-21"), [])
  assert.deepEqual(rangoFechas("basura", "2026-07-21"), [])
})

test("diaSemana con lunes = 0", () => {
  assert.equal(diaSemana("2026-07-21"), 1) // martes
  assert.equal(diaSemana("2026-07-20"), 0) // lunes
  assert.equal(diaSemana("2026-07-26"), 6) // domingo
  assert.equal(primerDiaSemanaDelMes(2026, 7), 2) // 1 de julio de 2026 = miércoles
})

test("la cuadrícula del mes siempre tiene 42 celdas", () => {
  for (const [anio, mes] of [[2026, 2], [2026, 7], [2024, 2], [2026, 3], [2027, 8]] as const) {
    const celdas = construirCuadriculaMes(anio, mes)
    assert.equal(celdas.length, 42, `${anio}-${mes}`)
    assert.equal(diaSemana(celdas[0].fecha), 0, "empieza en lunes")
    assert.equal(celdas.filter((c) => c.delMes).length, diasEnMes(anio, mes))
  }
})

test("la cuadrícula rellena con los meses vecinos", () => {
  // Julio de 2026 empieza en miércoles → dos celdas de junio delante.
  const celdas = construirCuadriculaMes(2026, 7)
  assert.equal(celdas[0].fecha, "2026-06-29")
  assert.equal(celdas[0].delMes, false)
  assert.equal(celdas[2].fecha, "2026-07-01")
  assert.equal(celdas[2].delMes, true)
  assert.equal(celdas[32].fecha, "2026-07-31")
  assert.equal(celdas[33].delMes, false) // ya es agosto
})

test("febrero de 2027 empieza en lunes: sin relleno delante", () => {
  const celdas = construirCuadriculaMes(2027, 2)
  assert.equal(celdas[0].fecha, "2027-02-01")
  assert.equal(celdas[0].delMes, true)
})

test("desplazarMes cruza el año en los dos sentidos", () => {
  assert.deepEqual(desplazarMes(2026, 12, 1), { anio: 2027, mes: 1 })
  assert.deepEqual(desplazarMes(2026, 1, -1), { anio: 2025, mes: 12 })
  assert.deepEqual(desplazarMes(2026, 7, 0), { anio: 2026, mes: 7 })
  assert.deepEqual(desplazarMes(2026, 1, -13), { anio: 2024, mes: 12 })
  assert.deepEqual(desplazarMes(2026, 7, 18), { anio: 2028, mes: 1 })
})

test("hoyISO usa la fecha LOCAL, no la UTC", () => {
  // 21 de julio a las 23:30 en un huso al este de UTC ya es día 22 en UTC. La fecha del calendario
  // tiene que ser la que ve el usuario.
  const local = new Date(2026, 6, 21, 23, 30, 0)
  assert.equal(hoyISO(local), "2026-07-21")
  assert.equal(hoyISO(new Date(2026, 0, 1, 0, 5, 0)), "2026-01-01")
})

test("formato largo", () => {
  assert.equal(formatearFechaLarga("2026-07-21"), "Martes 21 de julio de 2026")
  assert.equal(formatearFechaLarga("basura"), "basura")
})

test("claveInstante deja los de día completo primero", () => {
  const claves = [claveInstante("2026-07-21", "09:00"), claveInstante("2026-07-21"), claveInstante("2026-07-21", "08:00")]
  assert.deepEqual([...claves].sort(), [
    "2026-07-21T",
    "2026-07-21T08:00",
    "2026-07-21T09:00",
  ])
})

test("aFechaISO rellena con ceros", () => {
  assert.equal(aFechaISO(2026, 7, 5), "2026-07-05")
  assert.equal(aFechaISO(999, 1, 1), "0999-01-01")
})
