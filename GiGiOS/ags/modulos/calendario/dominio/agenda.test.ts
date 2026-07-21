import { test } from "node:test"
import assert from "node:assert/strict"
import {
  agendaDelDia,
  eventoOcupaFecha,
  fechasDelEvento,
  indicePorFecha,
  textoIntervalo,
} from "./agenda.ts"
import type { EventoCalendario } from "./tipos.ts"

function ev(parcial: Partial<EventoCalendario> & { id: string }): EventoCalendario {
  return {
    titulo: parcial.id,
    inicio: { fecha: "2026-07-21" },
    fin: { fecha: "2026-07-21" },
    todoElDia: true,
    color: "purple",
    origen: "local",
    calendarioId: "local",
    permiso: "escritura",
    ...parcial,
  }
}

const conHora = (id: string, fecha: string, desde: string, hasta: string, finFecha = fecha) =>
  ev({ id, todoElDia: false, inicio: { fecha, hora: desde }, fin: { fecha: finFecha, hora: hasta } })

test("un evento de un día ocupa solo ese día", () => {
  const e = ev({ id: "a" })
  assert.deepEqual(fechasDelEvento(e), ["2026-07-21"])
  assert.equal(eventoOcupaFecha(e, "2026-07-21"), true)
  assert.equal(eventoOcupaFecha(e, "2026-07-20"), false)
  assert.equal(eventoOcupaFecha(e, "2026-07-22"), false)
})

test("un evento de varios días ocupa todos, extremos incluidos", () => {
  const e = ev({ id: "viaje", inicio: { fecha: "2026-07-21" }, fin: { fecha: "2026-07-24" } })
  assert.deepEqual(fechasDelEvento(e), ["2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"])
  assert.equal(eventoOcupaFecha(e, "2026-07-22"), true)
  assert.equal(eventoOcupaFecha(e, "2026-07-24"), true)
  assert.equal(eventoOcupaFecha(e, "2026-07-25"), false)
})

test("un rango invertido degrada al día de inicio en vez de desaparecer", () => {
  const e = ev({ id: "roto", inicio: { fecha: "2026-07-21" }, fin: { fecha: "2026-07-01" } })
  assert.deepEqual(fechasDelEvento(e), ["2026-07-21"])
  assert.equal(eventoOcupaFecha(e, "2026-07-21"), true)
})

test("un evento de varios días aparece en cada fecha con las banderas correctas", () => {
  const e = ev({ id: "viaje", inicio: { fecha: "2026-07-21" }, fin: { fecha: "2026-07-23" } })
  const primero = agendaDelDia([e], "2026-07-21")[0]
  const medio = agendaDelDia([e], "2026-07-22")[0]
  const ultimo = agendaDelDia([e], "2026-07-23")[0]

  assert.deepEqual(
    [primero.esPrimerDia, primero.esUltimoDia, primero.variosDias],
    [true, false, true],
  )
  assert.deepEqual([medio.esPrimerDia, medio.esUltimoDia], [false, false])
  assert.deepEqual([ultimo.esPrimerDia, ultimo.esUltimoDia], [false, true])
})

test("la agenda pone primero los de día completo y luego por hora", () => {
  const eventos = [
    conHora("tarde", "2026-07-21", "18:00", "19:00"),
    ev({ id: "cumple" }),
    conHora("manana", "2026-07-21", "09:00", "10:00"),
    conHora("mediodia", "2026-07-21", "12:30", "13:00"),
  ]
  assert.deepEqual(
    agendaDelDia(eventos, "2026-07-21").map((i) => i.evento.id),
    ["cumple", "manana", "mediodia", "tarde"],
  )
})

test("a igual hora se ordena por título", () => {
  const eventos = [
    conHora("z", "2026-07-21", "09:00", "10:00"),
    conHora("a", "2026-07-21", "09:00", "10:00"),
  ]
  assert.deepEqual(agendaDelDia(eventos, "2026-07-21").map((i) => i.evento.id), ["a", "z"])
})

test("en los días intermedios el evento largo va ARRIBA, no en su hora de inicio", () => {
  // El "Viaje 18:00" empezó el día 21. El día 22 no empieza a las 18:00, así que ordenarlo por esa
  // hora lo colocaría después de la reunión de las 09:00, que sí ocurre ese día.
  const viaje = conHora("viaje", "2026-07-21", "18:00", "20:00", "2026-07-23")
  const reunion = conHora("reunion", "2026-07-22", "09:00", "10:00")
  assert.deepEqual(
    agendaDelDia([reunion, viaje], "2026-07-22").map((i) => i.evento.id),
    ["viaje", "reunion"],
  )
  // Pero el día 21, que sí es su primer día, va donde le toca por hora.
  const manana = conHora("manana", "2026-07-21", "09:00", "10:00")
  assert.deepEqual(
    agendaDelDia([viaje, manana], "2026-07-21").map((i) => i.evento.id),
    ["manana", "viaje"],
  )
})

test("indicePorFecha acota al rango pedido", () => {
  const eventos = [
    ev({ id: "largo", inicio: { fecha: "2026-06-28" }, fin: { fecha: "2026-07-03" } }),
    ev({ id: "suelto", inicio: { fecha: "2026-07-15" }, fin: { fecha: "2026-07-15" } }),
    ev({ id: "fuera", inicio: { fecha: "2026-09-01" }, fin: { fecha: "2026-09-01" } }),
  ]
  const indice = indicePorFecha(eventos, "2026-07-01", "2026-07-31")
  assert.deepEqual([...indice.keys()].sort(), ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-15"])
  assert.equal(indice.get("2026-07-02")![0].id, "largo")
  assert.equal(indice.has("2026-06-28"), false, "no se cuela lo anterior al rango")
})

test("textoIntervalo distingue los tramos de un evento largo", () => {
  const largo = conHora("viaje", "2026-07-21", "18:00", "20:00", "2026-07-23")
  assert.equal(textoIntervalo(agendaDelDia([largo], "2026-07-21")[0]), "Desde 18:00")
  assert.equal(textoIntervalo(agendaDelDia([largo], "2026-07-22")[0]), "Todo el día · continúa")
  assert.equal(textoIntervalo(agendaDelDia([largo], "2026-07-23")[0]), "Hasta 20:00")

  const corto = conHora("cita", "2026-07-21", "09:00", "10:00")
  assert.equal(textoIntervalo(agendaDelDia([corto], "2026-07-21")[0]), "09:00 – 10:00")

  const diaCompleto = ev({ id: "fiesta" })
  assert.equal(textoIntervalo(agendaDelDia([diaCompleto], "2026-07-21")[0]), "Todo el día")

  const variosCompletos = ev({ id: "vacas", inicio: { fecha: "2026-07-21" }, fin: { fecha: "2026-07-25" } })
  assert.equal(textoIntervalo(agendaDelDia([variosCompletos], "2026-07-21")[0]), "Todo el día · empieza hoy")
  assert.equal(textoIntervalo(agendaDelDia([variosCompletos], "2026-07-25")[0]), "Todo el día · último día")
})

test("un día sin eventos devuelve lista vacía", () => {
  assert.deepEqual(agendaDelDia([ev({ id: "a" })], "2026-08-01"), [])
})
