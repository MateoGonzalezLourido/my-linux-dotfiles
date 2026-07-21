import assert from "node:assert/strict"
import test from "node:test"

import { ContadorAnuncios, esReproductorSpotify, obtenerMiniaturaYoutube } from "./estadoPista.ts"

test("cuenta una sola vez cada anuncio y reinicia el bloque con una pista real", () => {
  const contador = new ContadorAnuncios()

  assert.deepEqual(contador.actualizar("spotify:ad:uno"), { esAnuncio: true, indice: 1 })
  assert.deepEqual(contador.actualizar("spotify:ad:uno"), { esAnuncio: true, indice: 1 })
  assert.deepEqual(contador.actualizar("spotify:ad:dos"), { esAnuncio: true, indice: 2 })
  assert.deepEqual(contador.actualizar("spotify:track:123"), { esAnuncio: false, indice: 0 })
  assert.deepEqual(contador.actualizar("spotify:ad:tres"), { esAnuncio: true, indice: 1 })
})

test("deriva miniaturas de las variantes habituales de YouTube", () => {
  const id = "abcdefghijk"
  assert.equal(obtenerMiniaturaYoutube(`https://youtube.com/watch?v=${id}`), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`)
  assert.equal(obtenerMiniaturaYoutube(`https://youtu.be/${id}`), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`)
  assert.equal(obtenerMiniaturaYoutube("https://example.com/video"), "")
})

test("identifica Spotify sin depender de mayúsculas", () => {
  assert.equal(esReproductorSpotify({ bus_name: "org.mpris.MediaPlayer2.spotify" }), true)
  assert.equal(esReproductorSpotify({ bus_name: "org.mpris.MediaPlayer2.firefox.instance1" }), false)
})
