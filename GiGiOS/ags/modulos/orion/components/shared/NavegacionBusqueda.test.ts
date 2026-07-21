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
    enfocar: () => eventos.push(`${nombre}:focus`),
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
  assert.deepEqual(eventos, ["primero:off", "segundo:on", "segundo:preview", "segundo:focus"])
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
  assert.deepEqual(eventos, ["segundo:off", "abrir:off", "abrir:on", "abrir:focus"])
  eventos.length = 0
  assert.equal(navegacion.salirSubmenu(), true)
  assert.deepEqual(eventos, ["abrir:off", "segundo:on", "segundo:focus"])
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
  assert.deepEqual(eventos, ["abrir:off", "editar:on", "editar:focus"])
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

test("apps empieza sin selección y la primera flecha selecciona la primera app", () => {
  for (const direccion of ["arriba", "abajo", "izquierda", "derecha"] as const) {
    const eventos: string[] = []
    const navegacion = new NavegacionBusqueda()
    navegacion.establecerResultados([
      crearElemento("primera", eventos),
      crearElemento("segunda", eventos),
    ], false, 6)

    assert.deepEqual(eventos, [])
    assert.equal(navegacion.activarSeleccionado(), false)
    navegacion.moverEnCuadricula(direccion, false)
    assert.deepEqual(eventos, ["primera:on", "primera:focus"])
  }
})

test("las flechas respetan filas y columnas en el mosaico de apps", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  const apps = Array.from({ length: 8 }, (_, indice) =>
    crearElemento(`app-${indice}`, eventos))
  navegacion.establecerResultados(apps, false, 6)

  navegacion.moverEnCuadricula("derecha", false)
  navegacion.moverEnCuadricula("derecha", false)
  navegacion.moverEnCuadricula("abajo", false)
  eventos.length = 0
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, ["app-7:activar"])

  eventos.length = 0
  navegacion.moverEnCuadricula("izquierda", false)
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, [
    "app-7:off", "app-6:on", "app-6:focus", "app-6:activar",
  ])

  eventos.length = 0
  navegacion.moverEnCuadricula("arriba", false)
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, [
    "app-6:off", "app-0:on", "app-0:focus", "app-0:activar",
  ])
})

test("Tab selecciona la primera app y después avanza linealmente", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  navegacion.establecerResultados([
    crearElemento("primera", eventos),
    crearElemento("segunda", eventos),
  ], false, 6)

  navegacion.moverResultados(1, false)
  navegacion.moverResultados(1, false)
  eventos.length = 0
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, ["segunda:activar"])
})

test("Enter abre el submenú de la app y selecciona su primera acción", () => {
  const eventos: string[] = []
  const navegacion = new NavegacionBusqueda()
  const acciones = [
    crearElemento("abrir", eventos),
    crearElemento("editar", eventos),
  ]
  const app = crearElemento("app", eventos)
  app.activar = () => {
    eventos.push("app:activar")
    navegacion.establecerAcciones(acciones)
  }
  navegacion.establecerResultados([app], false, 6)
  navegacion.moverEnCuadricula("abajo", false)
  eventos.length = 0

  assert.equal(navegacion.activarResultadoYEntrarSubmenu(), true)
  assert.deepEqual(eventos, [
    "app:activar", "app:off", "abrir:off", "abrir:on", "abrir:focus",
  ])
  eventos.length = 0
  navegacion.activarSeleccionado()
  assert.deepEqual(eventos, ["abrir:activar"])
})
