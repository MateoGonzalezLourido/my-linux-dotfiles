import assert from "node:assert/strict"
import test from "node:test"
import {
  esAppMensajeria,
  fondoOpacoDesdeHex,
  limpiarMarcado,
  necesitaExpansionCuerpo,
} from "./utilidades.ts"

test("detecta apps de mensajería sin distinguir mayúsculas", () => {
  assert.equal(esAppMensajeria("Telegram Desktop"), true)
  assert.equal(esAppMensajeria("org.signal.Signal"), true)
  assert.equal(esAppMensajeria("Firefox"), false)
})

test("limpia etiquetas y entidades admitidas en la tarjeta", () => {
  assert.equal(
    limpiarMarcado("<b>Uno &amp; dos</b> &lt;tres&gt; &quot;cuatro&quot; &apos;cinco&apos;"),
    "Uno & dos <tres> \"cuatro\" 'cinco'",
  )
})

test("expande cuerpos largos o con más de dos líneas", () => {
  assert.equal(necesitaExpansionCuerpo("a".repeat(90)), false)
  assert.equal(necesitaExpansionCuerpo("a".repeat(91)), true)
  assert.equal(necesitaExpansionCuerpo("uno\ndos\ntres"), true)
})

test("precompone el tinte y limita la opacidad", () => {
  assert.equal(fondoOpacoDesdeHex("#08080c", 0.5), "rgb(8, 8, 12)")
  assert.equal(fondoOpacoDesdeHex("#ffffff", 0), "rgb(8, 8, 12)")
  assert.equal(fondoOpacoDesdeHex("invalido", 2), "rgb(255, 255, 255)")
})
