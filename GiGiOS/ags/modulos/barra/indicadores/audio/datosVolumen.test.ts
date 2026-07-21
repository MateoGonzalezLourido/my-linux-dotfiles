import { test } from "node:test"
import assert from "node:assert/strict"
import { ICONO_AURICULARES, auricularSilenciado, esAuricular, iconoVolumen } from "./datosVolumen.ts"

test("detecta auriculares por ruta activa", () => {
  const salida = { mute: false, volume: 0.5, route: { name: "analog-output-headphones" } }
  assert.equal(esAuricular(salida), true)
  assert.equal(iconoVolumen(salida), ICONO_AURICULARES)
})

test("no confunde un altavoz analógico genérico con auriculares", () => {
  assert.equal(esAuricular({ mute: false, volume: 0.5, icon: "audio-card-analog-pci" }), false)
})

test("mantiene el icono de auriculares al silenciarlo y activa la diagonal", () => {
  const salida = { mute: true, volume: 0.5, description: "Auriculares" }
  assert.equal(iconoVolumen(salida), ICONO_AURICULARES)
  assert.equal(auricularSilenciado(salida), true)
})
