import assert from "node:assert/strict"
import test from "node:test"

import { agruparEnFilas } from "./rejilla.ts"

test("agrupa los iconos en filas sin modificar la entrada", () => {
  const elementos = [1, 2, 3, 4, 5]
  assert.deepEqual(agruparEnFilas(elementos, 4), [[1, 2, 3, 4], [5]])
  assert.deepEqual(elementos, [1, 2, 3, 4, 5])
})

test("normaliza tamaños de fila inválidos", () => {
  assert.deepEqual(agruparEnFilas([1, 2], 0), [[1], [2]])
})
