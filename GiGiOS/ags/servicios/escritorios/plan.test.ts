import assert from "node:assert/strict"
import test from "node:test"

import { crearPlanDesplazamiento, crearPlanIntercambio } from "./plan.ts"

const clientes = [
  { address: "a1", workspace: { id: 1 } },
  { address: "a2", workspace: { id: 1 } },
  { address: "b", workspace: { id: 3 } },
  { address: "c", workspace: { id: 4 } },
]

test("planifica un intercambio temporal y conserva el foco", () => {
  assert.deepEqual(crearPlanIntercambio(clientes, 1, 3, 1), {
    movimientos: [
      { direccion: "a1", idDestino: 9999 },
      { direccion: "a2", idDestino: 9999 },
      { direccion: "b", idDestino: 1 },
      { direccion: "a1", idDestino: 3 },
      { direccion: "a2", idDestino: 3 },
    ],
    idFocoDestino: 3,
  })
})

test("desplaza a la derecha recorriendo los escritorios intermedios", () => {
  assert.deepEqual(crearPlanDesplazamiento(clientes, 1, 4, [1, 3, 4], 3), {
    movimientos: [
      { direccion: "a1", idDestino: 9999 },
      { direccion: "a2", idDestino: 9999 },
      { direccion: "b", idDestino: 1 },
      { direccion: "c", idDestino: 3 },
      { direccion: "a1", idDestino: 4 },
      { direccion: "a2", idDestino: 4 },
    ],
    idFocoDestino: 1,
  })
})

test("desplaza a la izquierda recorriendo los escritorios intermedios", () => {
  assert.deepEqual(crearPlanDesplazamiento(clientes, 4, 1, [1, 3, 4], 1), {
    movimientos: [
      { direccion: "c", idDestino: 9999 },
      { direccion: "b", idDestino: 4 },
      { direccion: "a1", idDestino: 3 },
      { direccion: "a2", idDestino: 3 },
      { direccion: "c", idDestino: 1 },
    ],
    idFocoDestino: 3,
  })
})

test("no crea un plan parcial con un extremo ajeno a la lista local", () => {
  assert.deepEqual(crearPlanDesplazamiento(clientes, 1, 8, [1, 3, 4], 1), {
    movimientos: [],
    idFocoDestino: null,
  })
})

test("ignora clientes mal formados", () => {
  const clientesMalformados = [
    { address: 42, workspace: { id: 1 } },
    { address: "valido", workspace: { id: 1 } },
    { address: "desconocido", workspace: null },
  ]
  assert.deepEqual(crearPlanIntercambio(clientesMalformados, 1, 2, -1).movimientos, [
    { direccion: "valido", idDestino: 9999 },
    { direccion: "valido", idDestino: 2 },
  ])
})
