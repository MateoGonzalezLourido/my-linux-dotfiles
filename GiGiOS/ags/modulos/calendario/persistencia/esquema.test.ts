import { test } from "node:test"
import assert from "node:assert/strict"
import { VERSION_ESQUEMA, archivoVacio, leerArchivo, leerEvento } from "./esquema.ts"

const eventoBueno = {
  id: "ev-1",
  titulo: "Reunión",
  inicio: { fecha: "2026-07-21", hora: "09:00" },
  fin: { fecha: "2026-07-21", hora: "10:00" },
  todoElDia: false,
  color: "teal",
  origen: "local",
  calendarioId: "local",
  permiso: "escritura",
}

test("un evento completo se lee tal cual", () => {
  const e = leerEvento(eventoBueno)!
  assert.equal(e.id, "ev-1")
  assert.equal(e.color, "teal")
  assert.equal(e.inicio.hora, "09:00")
  assert.equal(e.todoElDia, false)
})

test("un color desconocido cae al color por defecto en vez de tirar el evento", () => {
  const e = leerEvento({ ...eventoBueno, color: "fucsia" })!
  assert.equal(e.color, "purple")
})

test("sin id o sin título el evento es irrecuperable", () => {
  assert.equal(leerEvento({ ...eventoBueno, id: "" }), null)
  assert.equal(leerEvento({ ...eventoBueno, titulo: 42 }), null)
  assert.equal(leerEvento(null), null)
  assert.equal(leerEvento("cadena"), null)
})

test("una hora rota degrada a día completo, no descarta el evento", () => {
  const e = leerEvento({ ...eventoBueno, inicio: { fecha: "2026-07-21", hora: "9:0" } })!
  assert.equal(e.todoElDia, true, "se conserva el título y la fecha")
  assert.equal(e.inicio.hora, undefined)
  assert.equal(e.inicio.fecha, "2026-07-21")
})

test("una fecha rota sí descarta el evento: sin fecha no hay dónde pintarlo", () => {
  assert.equal(leerEvento({ ...eventoBueno, inicio: { fecha: "2026-02-30", hora: "09:00" } }), null)
  assert.equal(leerEvento({ ...eventoBueno, fin: {} }), null)
})

test("permiso y origen caen a valores seguros", () => {
  const e = leerEvento({ ...eventoBueno, origen: "marte", permiso: "root" })!
  assert.equal(e.origen, "local")
  assert.equal(e.permiso, "escritura")
  const remoto = leerEvento({ ...eventoBueno, origen: "google", permiso: "lectura" })!
  assert.equal(remoto.origen, "google")
  assert.equal(remoto.permiso, "lectura")
})

test("los opcionales vacíos no se materializan", () => {
  const e = leerEvento({ ...eventoBueno, descripcion: "  ", ubicacion: "", remotoId: null })!
  assert.equal("descripcion" in e, false)
  assert.equal("ubicacion" in e, false)
  assert.equal("remotoId" in e, false)
})

test("un evento roto no se lleva por delante a los sanos", () => {
  const { archivo, problemas } = leerArchivo({
    version: 1,
    eventos: [eventoBueno, { basura: true }, { ...eventoBueno, id: "ev-2" }],
  })
  assert.deepEqual(archivo.eventos.map((e) => e.id), ["ev-1", "ev-2"])
  assert.equal(problemas.length, 1)
  assert.match(problemas[0], /1 evento/)
})

test("los ids duplicados se descartan: el borrado se llevaría los dos", () => {
  const { archivo } = leerArchivo({ version: 1, eventos: [eventoBueno, { ...eventoBueno, titulo: "Otro" }] })
  assert.equal(archivo.eventos.length, 1)
  assert.equal(archivo.eventos[0].titulo, "Reunión")
})

test("un fichero que no es un objeto degrada a calendario vacío", () => {
  for (const basura of [null, 42, "texto", undefined]) {
    const { archivo, problemas } = leerArchivo(basura)
    assert.deepEqual(archivo.eventos, [])
    assert.equal(problemas.length, 1)
  }
})

test("un array en la raíz se reconoce como el formato antiguo", () => {
  const { problemas } = leerArchivo([eventoBueno])
  assert.match(problemas[0], /antiguo/)
})

test("una versión futura avisa pero se lee lo que se entienda", () => {
  const { archivo, problemas } = leerArchivo({ version: 99, eventos: [eventoBueno] })
  assert.equal(archivo.eventos.length, 1)
  assert.match(problemas[0], /versión 99/)
})

test("la configuración se sanea", () => {
  const { archivo } = leerArchivo({
    version: 1,
    eventos: [],
    configuracion: { calendariosVisibles: ["a", 3, "", "b"] },
  })
  assert.deepEqual(archivo.configuracion.calendariosVisibles, ["a", "b"])

  const sinConfig = leerArchivo({ version: 1, eventos: [] })
  assert.deepEqual(sinConfig.archivo.configuracion.calendariosVisibles, [])
})

test("el archivo vacío es válido y lleva la versión actual", () => {
  const a = archivoVacio()
  assert.equal(a.version, VERSION_ESQUEMA)
  assert.deepEqual(a.eventos, [])
  // Y volver a leerlo no produce problemas: el ciclo escribir → leer es estable.
  assert.deepEqual(leerArchivo(a).problemas, [])
})
