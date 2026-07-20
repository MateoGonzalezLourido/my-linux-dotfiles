import { test } from "node:test"
import assert from "node:assert/strict"
import { formatearTexto } from "./formatear.ts"

test("formatearTexto sustituye cadenas y números", () => {
  assert.equal(
    formatearTexto("Batería: {{porcentaje}} % · {{estado}}", { porcentaje: 42, estado: "cargando" }),
    "Batería: 42 % · cargando",
  )
})

test("formatearTexto conserva los marcadores sin valor", () => {
  assert.equal(formatearTexto("{{conocido}} / {{ausente}}", { conocido: "sí" }), "sí / {{ausente}}")
})
