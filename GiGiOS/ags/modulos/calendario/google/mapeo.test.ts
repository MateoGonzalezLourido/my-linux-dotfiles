process.env.TZ = "Europe/Madrid" // fija la zona: el mapeo convierte a hora local por diseño

import { test } from "node:test"
import assert from "node:assert/strict"
import { aRFC3339, calendarioDesdeGoogle, desdeGoogle, desdeRFC3339, esLocal, haciaGoogle } from "./mapeo.ts"
import type { EventoGoogle } from "./mapeo.ts"
import type { EventoCalendario } from "../dominio/tipos.ts"

const conHora: EventoGoogle = {
  id: "abc123",
  etag: '"tag-1"',
  status: "confirmed",
  summary: "Reunión",
  updated: "2026-07-20T10:00:00.000Z",
  start: { dateTime: "2026-07-21T09:00:00+02:00", timeZone: "Europe/Madrid" },
  end: { dateTime: "2026-07-21T10:30:00+02:00", timeZone: "Europe/Madrid" },
}

const evento = (r: ReturnType<typeof desdeGoogle>): EventoCalendario => {
  assert.equal(r.tipo, "evento")
  return (r as { tipo: "evento"; evento: EventoCalendario }).evento
}

test("un evento con hora conserva la hora de pared local", () => {
  const e = evento(desdeGoogle(conHora, "cal-1", "escritura"))
  assert.equal(e.todoElDia, false)
  assert.deepEqual(e.inicio, { fecha: "2026-07-21", hora: "09:00", zonaHoraria: "Europe/Madrid" })
  assert.deepEqual(e.fin, { fecha: "2026-07-21", hora: "10:30", zonaHoraria: "Europe/Madrid" })
  assert.equal(e.origen, "google")
  assert.equal(e.remotoId, "abc123")
  assert.equal(e.sincronizacion?.etag, '"tag-1"')
})

test("un evento de otra zona se convierte a la hora local", () => {
  // 15:00 en Nueva York (UTC-4 en julio) son las 21:00 en Madrid. Enseñarlo a las 15:00 sería
  // ponerlo en el hueco equivocado del día.
  const nuevaYork: EventoGoogle = {
    ...conHora,
    start: { dateTime: "2026-07-21T15:00:00-04:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-07-21T16:00:00-04:00", timeZone: "America/New_York" },
  }
  const e = evento(desdeGoogle(nuevaYork, "cal-1", "escritura"))
  assert.equal(e.inicio.hora, "21:00")
  assert.equal(e.fin.hora, "22:00")
})

test("una conversión de zona puede cambiar el DÍA", () => {
  const tokio: EventoGoogle = {
    ...conHora,
    start: { dateTime: "2026-07-22T02:00:00+09:00" },
    end: { dateTime: "2026-07-22T03:00:00+09:00" },
  }
  const e = evento(desdeGoogle(tokio, "cal-1", "escritura"))
  assert.equal(e.inicio.fecha, "2026-07-21", "las 02:00 de Tokio son el día anterior en Madrid")
  assert.equal(e.inicio.hora, "19:00")
})

test("el fin EXCLUSIVO de un evento de día completo se vuelve inclusivo", () => {
  // Google manda «del 21 al 22» para un evento que ocupa solo el 21.
  const unDia = evento(desdeGoogle(
    { id: "d1", start: { date: "2026-07-21" }, end: { date: "2026-07-22" } },
    "cal-1", "escritura",
  ))
  assert.equal(unDia.todoElDia, true)
  assert.equal(unDia.inicio.fecha, "2026-07-21")
  assert.equal(unDia.fin.fecha, "2026-07-21", "sin esto se pintaría un día de más")

  const tresDias = evento(desdeGoogle(
    { id: "d2", start: { date: "2026-07-21" }, end: { date: "2026-07-24" } },
    "cal-1", "escritura",
  ))
  assert.equal(tresDias.fin.fecha, "2026-07-23")
})

test("la ida y vuelta de un evento de día completo no lo encoge ni lo estira", () => {
  const original = { id: "d1", start: { date: "2026-07-21" }, end: { date: "2026-07-24" } }
  const local = evento(desdeGoogle(original, "cal-1", "escritura"))
  const devuelta = haciaGoogle(local)
  assert.deepEqual(devuelta.start, { date: "2026-07-21" })
  assert.deepEqual(devuelta.end, { date: "2026-07-24" }, "vuelve exactamente al fin exclusivo original")
})

test("un end.date ausente o invertido degrada a un solo día", () => {
  const sinFin = evento(desdeGoogle({ id: "d3", start: { date: "2026-07-21" } }, "c", "escritura"))
  assert.equal(sinFin.fin.fecha, "2026-07-21")
  const invertido = evento(desdeGoogle(
    { id: "d4", start: { date: "2026-07-21" }, end: { date: "2026-07-10" } },
    "c", "escritura",
  ))
  assert.equal(invertido.fin.fecha, "2026-07-21")
})

test("status cancelled es una INSTRUCCIÓN DE BORRADO, no un evento", () => {
  const r = desdeGoogle({ id: "abc123", status: "cancelled" }, "cal-1", "escritura")
  assert.deepEqual(r, { tipo: "eliminado", remotoId: "abc123" })
})

test("lo que no se puede interpretar se ignora con motivo, no revienta", () => {
  assert.equal(desdeGoogle({}, "c", "escritura").tipo, "ignorado")
  assert.equal(desdeGoogle({ id: "x" }, "c", "escritura").tipo, "ignorado")
  assert.equal(desdeGoogle({ id: "x", start: { date: "2026-02-30" }, end: { date: "2026-03-01" } }, "c", "escritura").tipo, "ignorado")
  assert.equal(desdeGoogle({ id: "x", start: { dateTime: "no-es-fecha" } }, "c", "escritura").tipo, "ignorado")
})

test("el permiso del calendario se hereda, salvo en las instancias recurrentes", () => {
  assert.equal(evento(desdeGoogle(conHora, "c", "escritura")).permiso, "escritura")
  assert.equal(evento(desdeGoogle(conHora, "c", "lectura")).permiso, "lectura")
  // Editar una instancia suelta rompería la serie, y esta versión no sabe escribir recurrencias.
  const recurrente = evento(desdeGoogle({ ...conHora, recurringEventId: "serie-1" }, "c", "escritura"))
  assert.equal(recurrente.permiso, "lectura")
})

test("el id local se conserva entre sincronizaciones", () => {
  const conocido = evento(desdeGoogle(conHora, "cal-1", "escritura", (r) => (r === "abc123" ? "ev-viejo" : undefined)))
  assert.equal(conocido.id, "ev-viejo", "cambiarlo duplicaría el evento en la lista")
  const nuevo = evento(desdeGoogle(conHora, "cal-1", "escritura"))
  assert.equal(nuevo.id, "g-cal-1-abc123")
})

test("un evento sin título recibe uno de relleno en vez de quedar en blanco", () => {
  assert.equal(evento(desdeGoogle({ ...conHora, summary: "" }, "c", "escritura")).titulo, "(sin título)")
})

// ── RFC 3339 ─────────────────────────────────────────────────────────────────

test("desdeRFC3339", () => {
  assert.deepEqual(desdeRFC3339("2026-07-21T09:00:00+02:00"), { fecha: "2026-07-21", hora: "09:00" })
  assert.deepEqual(desdeRFC3339("2026-07-21T07:00:00Z"), { fecha: "2026-07-21", hora: "09:00" })
  assert.equal(desdeRFC3339("basura"), null)
  assert.equal(desdeRFC3339(""), null)
})

test("aRFC3339 incluye el desplazamiento y usa el de la FECHA del evento", () => {
  // Julio en Madrid es UTC+2; enero, UTC+1. Usar el desfase de «hoy» movería una hora los eventos
  // que caen al otro lado del cambio de horario.
  assert.equal(aRFC3339("2026-07-21", "09:00"), "2026-07-21T09:00:00+02:00")
  assert.equal(aRFC3339("2026-01-15", "09:00"), "2026-01-15T09:00:00+01:00")
  assert.equal(aRFC3339("2026-02-30", "09:00"), null)
})

test("la ida y vuelta de un evento con hora conserva el instante", () => {
  const local = evento(desdeGoogle(conHora, "c", "escritura"))
  const devuelta = haciaGoogle(local) as { start: { dateTime: string } }
  assert.deepEqual(desdeRFC3339(devuelta.start.dateTime), { fecha: "2026-07-21", hora: "09:00" })
})

test("haciaGoogle traslada los opcionales solo si existen", () => {
  const base = evento(desdeGoogle(conHora, "c", "escritura"))
  const sinExtras = haciaGoogle(base)
  assert.equal("description" in sinExtras, false)
  assert.equal("location" in sinExtras, false)

  const conExtras = haciaGoogle({ ...base, descripcion: "notas", ubicacion: "Sala 2" })
  assert.equal(conExtras.description, "notas")
  assert.equal(conExtras.location, "Sala 2")
})

// ── Calendarios ──────────────────────────────────────────────────────────────

test("solo owner y writer conceden escritura", () => {
  assert.equal(calendarioDesdeGoogle({ id: "a", accessRole: "owner" })!.permiso, "escritura")
  assert.equal(calendarioDesdeGoogle({ id: "a", accessRole: "writer" })!.permiso, "escritura")
  assert.equal(calendarioDesdeGoogle({ id: "a", accessRole: "reader" })!.permiso, "lectura")
  assert.equal(calendarioDesdeGoogle({ id: "a", accessRole: "freeBusyReader" })!.permiso, "lectura")
  assert.equal(calendarioDesdeGoogle({ id: "a" })!.permiso, "lectura", "sin rol, lo seguro es lectura")
})

test("un calendario sin id no es un calendario", () => {
  assert.equal(calendarioDesdeGoogle({ summary: "X" }), null)
  assert.equal(calendarioDesdeGoogle(null), null)
})

test("esLocal distingue lo que no debe viajar a Google", () => {
  const remoto = evento(desdeGoogle(conHora, "cal-1", "escritura"))
  assert.equal(esLocal(remoto), false)
  assert.equal(esLocal({ ...remoto, origen: "local", calendarioId: "local" }), true)
})
