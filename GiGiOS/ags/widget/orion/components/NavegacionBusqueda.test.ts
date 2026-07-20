import assert from "node:assert/strict"
import test from "node:test"
import {
  NavegacionBusqueda,
  type ElementoNavegacionBusqueda,
} from "./NavegacionBusqueda.ts"

function crearElemento(nombre: string, eventos: string[]): ElementoNavegacionBusqueda {
  return {
    marcarSeleccionado: (seleccionado) => eventos.push(`${nombre}:${seleccionado ? "on" : "off"}`),
    previsualizar: () => eventos.push(`${nombre}:preview`),
    activar: () => eventos.push(`${nombre}:activar`),
  }
}

test("el primer resultado queda seleccionado y Enter lo activa sin mover el foco", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  navegacion.establecerResultados([
    crearElemento("primero", eventos),
    crearElemento("segundo", eventos),
  ])

  assert.deepEqual(eventos, ["primero:on"])
  eventos.length = 0
  assert.equal(navegacion.activarSeleccionado(), true)
  assert.deepEqual(eventos, ["primero:activar"])
})

test("las flechas verticales comparten la selección de resultados", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  navegacion.establecerResultados([
    crearElemento("primero", eventos),
    crearElemento("segundo", eventos),
  ])
  eventos.length = 0

  navegacion.moverVertical(1)
  assert.deepEqual(eventos, ["primero:off", "segundo:on", "segundo:preview"])
  eventos.length = 0
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, ["segundo:activar"])
})

test("Derecha entra por la primera acción e Izquierda vuelve al resultado de origen", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  navegacion.establecerResultados([
    crearElemento("primero", eventos),
    crearElemento("segundo", eventos),
  ])
  navegacion.moverResultados(1)
  navegacion.establecerAcciones([
    crearElemento("abrir", eventos),
    crearElemento("editar", eventos),
  ])
  eventos.length = 0

  assert.equal(navegacion.entrarSubmenu(), true)
  assert.deepEqual(eventos, ["segundo:off", "abrir:off", "abrir:on"])
  eventos.length = 0
  assert.equal(navegacion.salirSubmenu(), true)
  assert.deepEqual(eventos, ["abrir:off", "segundo:on"])
})

test("las flechas verticales recorren las acciones mientras el submenú está activo", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  navegacion.establecerResultados([crearElemento("resultado", eventos)])
  navegacion.establecerAcciones([
    crearElemento("abrir", eventos),
    crearElemento("editar", eventos),
  ])
  navegacion.entrarSubmenu()
  eventos.length = 0

  navegacion.moverVertical(1)
  assert.deepEqual(eventos, ["abrir:off", "editar:on"])
  eventos.length = 0
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, ["editar:activar"])
})

test("una búsqueda nueva abandona el submenú y selecciona su primer resultado", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  navegacion.establecerResultados([crearElemento("anterior", eventos)])
  navegacion.establecerAcciones([crearElemento("abrir", eventos)])
  navegacion.entrarSubmenu()
  eventos.length = 0

  navegacion.establecerResultados([
    crearElemento("nuevo", eventos),
    crearElemento("otro", eventos),
  ])
  assert.deepEqual(eventos, ["anterior:off", "abrir:off", "nuevo:on"])
  eventos.length = 0
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, ["nuevo:activar"])
})
