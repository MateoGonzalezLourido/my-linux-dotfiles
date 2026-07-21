import { test } from "node:test"
import assert from "node:assert/strict"
import {
  fusionar,
  mutacionesPendientes,
  resolverConflictoConLocal,
  resolverConflictoConRemoto,
  trasSubir,
} from "./fusion.ts"
import type { EventoCalendario } from "../dominio/tipos.ts"

function ev(p: Partial<EventoCalendario> & { id: string }): EventoCalendario {
  return {
    titulo: p.id,
    inicio: { fecha: "2026-07-21" },
    fin: { fecha: "2026-07-21" },
    todoElDia: true,
    color: "purple",
    origen: "google",
    calendarioId: "cal-1",
    permiso: "escritura",
    ...p,
  }
}

const local = (id: string) => ev({ id, origen: "local", calendarioId: "local" })
const remoto = (id: string, remotoId: string, etag = "t1", extra: Partial<EventoCalendario> = {}) =>
  ev({ id, remotoId, sincronizacion: { etag }, ...extra })

const entrada = (p: Partial<Parameters<typeof fusionar>[1]> = {}) => ({
  remotos: [],
  eliminados: [],
  calendarioId: "cal-1",
  completa: false,
  ...p,
})

test("los eventos locales NUNCA se tocan", () => {
  const lista = [local("mio-1"), local("mio-2")]
  const r = fusionar(lista, entrada({ completa: true }))
  assert.deepEqual(r.eventos, lista)
  assert.equal(r.eliminados, 0)
})

test("una respuesta vacía no puede vaciar el calendario", () => {
  // Red caída a medias, token expirado, calendario desconectado: nada de eso borra datos.
  const lista = [local("mio"), remoto("g1", "r1")]
  const r = fusionar(lista, entrada())
  assert.equal(r.eventos.length, 2)
})

test("un evento remoto nuevo se añade", () => {
  const r = fusionar([local("mio")], entrada({ remotos: [remoto("g1", "r1")] }))
  assert.equal(r.anadidos, 1)
  assert.equal(r.eventos.length, 2)
})

test("un evento remoto conocido se actualiza conservando el id local", () => {
  const antes = remoto("ev-viejo", "r1", "t1")
  const despues = remoto("g-nuevo-id", "r1", "t2", { titulo: "Título nuevo" })
  const r = fusionar([antes], entrada({ remotos: [despues] }))
  assert.equal(r.actualizados, 1)
  assert.equal(r.eventos[0].id, "ev-viejo", "cambiar el id rompería la selección de la UI")
  assert.equal(r.eventos[0].titulo, "Título nuevo")
  assert.equal(r.eventos[0].sincronizacion?.etag, "t2")
})

test("un cancelled remoto elimina el evento", () => {
  const r = fusionar([remoto("g1", "r1"), local("mio")], entrada({ eliminados: ["r1"] }))
  assert.equal(r.eliminados, 1)
  assert.deepEqual(r.eventos.map((e) => e.id), ["mio"])
})

test("una edición local pendiente GANA a la versión remota", () => {
  // Lo pendiente es posterior a lo que Google tiene: pisarlo tiraría en silencio lo que el usuario
  // acaba de escribir.
  const pendiente = remoto("g1", "r1", "t1", {
    titulo: "Mi cambio",
    sincronizacion: { etag: "t1", pendiente: "editar" },
  })
  const r = fusionar([pendiente], entrada({ remotos: [remoto("x", "r1", "t9", { titulo: "Del servidor" })] }))
  assert.equal(r.eventos[0].titulo, "Mi cambio")
  assert.equal(r.conflictos, 1)
  assert.equal(r.eventos[0].sincronizacion?.conflicto, true)
})

test("si el remoto NO cambió, una pendiente no es conflicto", () => {
  // Mismo etag = nadie tocó nada allí; subir nuestra versión no pisa a nadie.
  const pendiente = remoto("g1", "r1", "t1", { sincronizacion: { etag: "t1", pendiente: "editar" } })
  const r = fusionar([pendiente], entrada({ remotos: [remoto("x", "r1", "t1")] }))
  assert.equal(r.conflictos, 0)
  assert.equal(r.eventos[0].sincronizacion?.conflicto, undefined)
})

test("un borrado remoto NO se aplica sobre una edición local pendiente", () => {
  const pendiente = remoto("g1", "r1", "t1", { sincronizacion: { etag: "t1", pendiente: "editar" } })
  const r = fusionar([pendiente], entrada({ eliminados: ["r1"] }))
  assert.equal(r.eventos.length, 1, "lo decide el usuario, no se pierde en silencio")
  assert.equal(r.eventos[0].sincronizacion?.conflicto, true)
  assert.equal(r.conflictos, 1)
})

test("un borrado local pendiente sí acepta el borrado remoto", () => {
  const pendiente = remoto("g1", "r1", "t1", { sincronizacion: { pendiente: "eliminar" } })
  const r = fusionar([pendiente], entrada({ eliminados: ["r1"] }))
  assert.equal(r.eventos.length, 0, "queríamos lo mismo: no hay nada que resolver")
})

test("en una pasada COMPLETA lo ausente se borra; en una incremental, no", () => {
  const viejo = remoto("g1", "r1")
  assert.equal(fusionar([viejo], entrada({ completa: true })).eventos.length, 0)
  assert.equal(fusionar([viejo], entrada({ completa: false })).eventos.length, 1)
})

test("una creación local pendiente sobrevive a una pasada completa", () => {
  // Todavía no existe en Google, así que no puede venir en la respuesta: borrarla sería perder un
  // evento recién creado sin conexión.
  const nuevo = remoto("g1", "", "t1", { sincronizacion: { pendiente: "crear" } })
  const r = fusionar([nuevo], entrada({ completa: true }))
  assert.equal(r.eventos.length, 1)
})

test("otro calendario no se ve afectado por la pasada de este", () => {
  const otro = ev({ id: "otro", remotoId: "r9", calendarioId: "cal-2" })
  const r = fusionar([otro], entrada({ completa: true, eliminados: ["r9"] }))
  assert.deepEqual(r.eventos, [otro])
})

// ── Cola de mutaciones ───────────────────────────────────────────────────────

test("la cola recoge lo pendiente en orden y salta los conflictos", () => {
  const lista = [
    local("mio"),
    remoto("a", "r1", "t1", { sincronizacion: { pendiente: "crear" } }),
    remoto("b", "r2", "t1", { sincronizacion: { pendiente: "editar", conflicto: true } }),
    remoto("c", "r3", "t1", { sincronizacion: { pendiente: "eliminar" } }),
    remoto("d", "r4", "t1"),
  ]
  assert.deepEqual(
    mutacionesPendientes(lista).map((m) => [m.evento.id, m.tipo]),
    [["a", "crear"], ["c", "eliminar"]],
  )
})

test("trasSubir limpia el pendiente y anota la versión remota", () => {
  const lista = [remoto("a", "", "", { sincronizacion: { pendiente: "crear" } })]
  const r = trasSubir(lista, "a", { remotoId: "r-nuevo", etag: "t5", actualizadoEn: "2026-07-21T10:00:00Z" })
  assert.equal(r[0].remotoId, "r-nuevo")
  assert.equal(r[0].sincronizacion?.etag, "t5")
  assert.equal(r[0].sincronizacion?.pendiente, undefined)
})

test("trasSubir con null retira el evento: era un borrado ya cumplido", () => {
  const lista = [remoto("a", "r1", "t1", { sincronizacion: { pendiente: "eliminar" } }), local("mio")]
  assert.deepEqual(trasSubir(lista, "a", null).map((e) => e.id), ["mio"])
})

test("resolver un conflicto en una dirección u otra", () => {
  const lista = [remoto("a", "r1", "t1", { sincronizacion: { etag: "t1", pendiente: "editar", conflicto: true } })]

  const conRemoto = resolverConflictoConRemoto(lista, "a")
  assert.equal(conRemoto[0].sincronizacion?.pendiente, undefined)
  assert.equal(conRemoto[0].sincronizacion?.conflicto, undefined)
  assert.deepEqual(mutacionesPendientes(conRemoto), [])

  const conLocal = resolverConflictoConLocal(lista, "a")
  assert.equal(conLocal[0].sincronizacion?.conflicto, undefined)
  assert.equal(mutacionesPendientes(conLocal).length, 1, "vuelve a la cola para subirse")
})
