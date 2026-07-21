import { test } from "node:test"
import assert from "node:assert/strict"
import { migrarArchivoAntiguo, migrarEventoAntiguo } from "./migracion.ts"
import { leerArchivo } from "./esquema.ts"
import { validarEvento } from "../dominio/validacion.ts"

function generador() {
  let n = 0
  return () => `gen-${++n}`
}

test("un evento antiguo con hora se convierte con inicio y fin el mismo día", () => {
  const e = migrarEventoAntiguo(
    { id: "viejo-1", title: "Dentista", date: "2026-07-21", startTime: "09:00", endTime: "10:00", color: "red", allDay: false },
    generador(),
  )!
  assert.equal(e.id, "viejo-1", "el id se conserva: era estable")
  assert.equal(e.titulo, "Dentista")
  assert.deepEqual(e.inicio, { fecha: "2026-07-21", hora: "09:00" })
  assert.deepEqual(e.fin, { fecha: "2026-07-21", hora: "10:00" })
  assert.equal(e.todoElDia, false)
  assert.equal(e.color, "red")
  assert.equal(e.origen, "local")
  assert.equal(e.permiso, "escritura")
})

test("un evento de día completo antiguo no gana horas", () => {
  const e = migrarEventoAntiguo({ id: "v2", title: "Cumple", date: "2026-07-21", allDay: true }, generador())!
  assert.equal(e.todoElDia, true)
  assert.equal(e.inicio.hora, undefined)
  assert.equal(e.fin.fecha, "2026-07-21")
})

test("`allDay:false` sin hora era un evento a medio rellenar → día completo", () => {
  // Inventarle un "00:00" lo colocaría el primero de la agenda, que no es lo que el usuario puso.
  const e = migrarEventoAntiguo({ id: "v3", title: "Algo", date: "2026-07-21", allDay: false }, generador())!
  assert.equal(e.todoElDia, true)
  assert.equal(e.inicio.hora, undefined)
})

test("un fin ausente o anterior al inicio recibe una hora de duración", () => {
  const sinFin = migrarEventoAntiguo({ id: "v4", title: "X", date: "2026-07-21", startTime: "09:00" }, generador())!
  assert.equal(sinFin.fin.hora, "10:00")

  const invertido = migrarEventoAntiguo(
    { id: "v5", title: "X", date: "2026-07-21", startTime: "09:00", endTime: "08:00" },
    generador(),
  )!
  assert.equal(invertido.fin.hora, "10:00")

  const igual = migrarEventoAntiguo(
    { id: "v6", title: "X", date: "2026-07-21", startTime: "09:00", endTime: "09:00" },
    generador(),
  )!
  assert.equal(igual.fin.hora, "10:00")
})

test("los migrados pasan el validador: no se crean eventos que la UI rechazaría", () => {
  const casos = [
    { id: "a", title: "A", date: "2026-07-21", startTime: "09:00" },
    { id: "b", title: "B", date: "2026-07-21", startTime: "23:30" },
    { id: "c", title: "C", date: "2026-07-21", startTime: "23:59" },
    { id: "d", title: "D", date: "2026-07-21", allDay: true },
  ]
  for (const crudo of casos) {
    const e = migrarEventoAntiguo(crudo, generador())!
    assert.deepEqual(validarEvento(e), [], `${crudo.id}`)
  }
})

test("un inicio a las 23:30 recorta el fin a 23:59 sin invertirse", () => {
  const e = migrarEventoAntiguo({ id: "v7", title: "X", date: "2026-07-21", startTime: "23:30" }, generador())!
  assert.equal(e.fin.hora, "23:59")
  assert.equal(e.todoElDia, false)
})

test("a las 23:59 no cabe ninguna duración: pasa a día completo", () => {
  const e = migrarEventoAntiguo({ id: "v8", title: "X", date: "2026-07-21", startTime: "23:59" }, generador())!
  assert.equal(e.todoElDia, true)
  assert.equal(e.inicio.hora, undefined)
})

test("sin fecha válida el evento no se puede migrar", () => {
  assert.equal(migrarEventoAntiguo({ id: "x", title: "X", date: "" }, generador()), null)
  assert.equal(migrarEventoAntiguo({ id: "x", title: "X", date: "2026-02-30" }, generador()), null)
  assert.equal(migrarEventoAntiguo(null, generador()), null)
})

test("un evento sin id ni título recibe id generado y título de relleno", () => {
  const e = migrarEventoAntiguo({ date: "2026-07-21", allDay: true }, generador())!
  assert.equal(e.id, "gen-1")
  assert.equal(e.titulo, "(sin título)")
})

test("el archivo entero se migra y los rotos solo se cuentan", () => {
  const { archivo, migrados, descartados } = migrarArchivoAntiguo(
    [
      { id: "a", title: "A", date: "2026-07-21", allDay: true },
      { id: "b", title: "B", date: "no-es-fecha" },
      { id: "c", title: "C", date: "2026-07-22", startTime: "09:00", endTime: "10:00" },
      "basura",
    ],
    generador(),
  )
  assert.equal(migrados, 2)
  assert.equal(descartados, 2)
  assert.deepEqual(archivo.eventos.map((e) => e.id), ["a", "c"])
  assert.equal(archivo.version, 1)
})

test("ids duplicados en el fichero antiguo se desduplican al migrar", () => {
  const { archivo } = migrarArchivoAntiguo(
    [
      { id: "dup", title: "A", date: "2026-07-21", allDay: true },
      { id: "dup", title: "B", date: "2026-07-22", allDay: true },
    ],
    generador(),
  )
  assert.equal(archivo.eventos.length, 2)
  assert.notEqual(archivo.eventos[0].id, archivo.eventos[1].id)
})

test("lo migrado se relee sin problemas: migración y esquema encajan", () => {
  const { archivo } = migrarArchivoAntiguo(
    [
      { id: "a", title: "A", date: "2026-07-21", allDay: true },
      { id: "c", title: "C", date: "2026-07-22", startTime: "09:00", endTime: "10:00", color: "amber" },
    ],
    generador(),
  )
  const releido = leerArchivo(JSON.parse(JSON.stringify(archivo)))
  assert.deepEqual(releido.problemas, [])
  assert.deepEqual(releido.archivo.eventos, archivo.eventos)
})

test("lo que no es un array no rompe la migración", () => {
  const r = migrarArchivoAntiguo({ eventos: [] }, generador())
  assert.equal(r.migrados, 0)
  assert.deepEqual(r.archivo.eventos, [])
})
