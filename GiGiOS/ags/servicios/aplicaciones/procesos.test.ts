import { test } from "node:test"
import assert from "node:assert/strict"
import { extraerInicioProceso } from "./procesos.ts"

test("extrae starttime aunque comm contenga espacios y paréntesis", () => {
  const resto = ["S", ...Array.from({ length: 18 }, (_, i) => String(i + 10)), "987654", "0"]
  assert.equal(extraerInicioProceso(`42 (juego (wine)) ${resto.join(" ")}`), "987654")
})

test("rechaza estadísticas incompletas", () => {
  assert.equal(extraerInicioProceso(null), null)
  assert.equal(extraerInicioProceso("42 sin-parentesis"), null)
  assert.equal(extraerInicioProceso("42 (app) S 1 2"), null)
})
