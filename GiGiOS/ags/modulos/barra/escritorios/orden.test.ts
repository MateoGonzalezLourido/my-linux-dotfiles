import assert from "node:assert/strict"
import test from "node:test"

import {
  ordenarClientesEscritorio,
  recordarEscritorioReciente,
  seleccionarEscritoriosRecientes,
} from "./orden.ts"

test("orders workspace clients top-to-bottom and left-to-right", () => {
  const clientes = [
    { address: "right-bottom", x: 100, y: 100 },
    { address: "right-top", x: 100, y: 0 },
    { address: "left-top", x: 0, y: 0 },
  ]

  assert.deepEqual(
    ordenarClientesEscritorio(clientes).map((cliente) => cliente.address),
    ["left-top", "right-top", "right-bottom"],
  )
  assert.deepEqual(
    clientes.map((cliente) => cliente.address),
    ["right-bottom", "right-top", "left-top"],
  )
})

test("uses the address as a stable tie-break for overlapping clients", () => {
  const clientes = [
    { address: "0xbbb", x: 20, y: 20 },
    { address: "0xaaa", x: 20, y: 20 },
  ]

  assert.deepEqual(
    ordenarClientesEscritorio(clientes).map((cliente) => cliente.address),
    ["0xaaa", "0xbbb"],
  )
})

test("places clients without coordinates after positioned clients", () => {
  const clientes = [
    { address: "unknown" },
    { address: "positioned", x: 10, y: 10 },
  ]

  assert.deepEqual(
    ordenarClientesEscritorio(clientes).map((cliente) => cliente.address),
    ["positioned", "unknown"],
  )
})

test("moves a visited workspace to the front of the recent history", () => {
  assert.deepEqual(recordarEscritorioReciente([4, 2, 1], 2), [2, 4, 1])
  assert.deepEqual(recordarEscritorioReciente([4, 2, 1], 7), [7, 4, 2, 1])
})

test("keeps the most recently visited workspaces", () => {
  const escritorios = [1, 2, 4, 7, 9].map((id) => ({ id }))

  assert.deepEqual(
    seleccionarEscritoriosRecientes(escritorios, [9, 2, 7, 1, 4], 9, 3)
      .map((escritorio) => escritorio.id),
    [2, 7, 9],
  )
})

test("always includes the focused workspace even if the history is stale", () => {
  const escritorios = [1, 2, 3, 4].map((id) => ({ id }))

  assert.deepEqual(
    seleccionarEscritoriosRecientes(escritorios, [1, 2, 3], 4, 2)
      .map((escritorio) => escritorio.id),
    [1, 4],
  )
})

test("shows only the focused workspace when the limit is one", () => {
  const escritorios = [1, 2, 3].map((id) => ({ id }))
  assert.deepEqual(
    seleccionarEscritoriosRecientes(escritorios, [1, 3], 2, 1)
      .map((escritorio) => escritorio.id),
    [2],
  )
})

test("un límite no finito conserva al menos el workspace enfocado", () => {
  const escritorios = [1, 2, 3].map((id) => ({ id }))
  assert.deepEqual(
    seleccionarEscritoriosRecientes(escritorios, [1, 3], 2, Number.NaN)
      .map((escritorio) => escritorio.id),
    [2],
  )
  assert.deepEqual(
    seleccionarEscritoriosRecientes(escritorios, [1, 3], 2, Number.POSITIVE_INFINITY)
      .map((escritorio) => escritorio.id),
    [2],
  )
})

test("fills an incomplete history with available workspaces", () => {
  const escritorios = [1, 2, 3, 4].map((id) => ({ id }))
  assert.deepEqual(
    seleccionarEscritoriosRecientes(escritorios, [3], 3, 3)
      .map((escritorio) => escritorio.id),
    [1, 2, 3],
  )
})
