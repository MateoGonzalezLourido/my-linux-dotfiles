import assert from "node:assert/strict"
import test from "node:test"
import {
  FONDO_SHELL_PREDETERMINADO,
  normalizarFondoShell,
} from "./fondoShell.ts"

test("normalizarFondoShell conserva los dos temas conocidos", () => {
  assert.equal(normalizarFondoShell("negro"), "negro")
  assert.equal(normalizarFondoShell("grafito"), "grafito")
})

test("normalizarFondoShell recupera el tema predeterminado ante datos inválidos", () => {
  assert.equal(normalizarFondoShell(undefined), FONDO_SHELL_PREDETERMINADO)
  assert.equal(normalizarFondoShell("otro"), FONDO_SHELL_PREDETERMINADO)
  assert.equal(normalizarFondoShell(18), FONDO_SHELL_PREDETERMINADO)
})
