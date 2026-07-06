// widget/services/spotify/parse.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseTrackId, isAd, tokenExpired } from "./parse.ts"

test("parseTrackId extrae el id base62 de trackid MPRIS, URI y URL", () => {
  assert.equal(parseTrackId("/com/spotify/track/1Yk0cQdMLx5RzzFTYwmuld"), "1Yk0cQdMLx5RzzFTYwmuld")
  assert.equal(parseTrackId("spotify:track:1Yk0cQdMLx5RzzFTYwmuld"), "1Yk0cQdMLx5RzzFTYwmuld")
  assert.equal(parseTrackId("https://open.spotify.com/track/1Yk0cQdMLx5RzzFTYwmuld"), "1Yk0cQdMLx5RzzFTYwmuld")
  assert.equal(parseTrackId("https://open.spotify.com/track/1Yk0cQdMLx5RzzFTYwmuld?si=abcdef"), "1Yk0cQdMLx5RzzFTYwmuld")
})

test("parseTrackId devuelve null para anuncios, vacío o basura", () => {
  assert.equal(parseTrackId("/com/spotify/ad/0000000000000000000000"), null)
  assert.equal(parseTrackId("spotify:ad:xyz"), null)
  assert.equal(parseTrackId(""), null)
  assert.equal(parseTrackId(null), null)
  assert.equal(parseTrackId(undefined), null)
  assert.equal(parseTrackId("cosa-sin-track"), null)
})

test("isAd detecta trackids de anuncio", () => {
  assert.equal(isAd("spotify:ad:12345"), true)
  assert.equal(isAd("/com/spotify/ad/12345"), true)
  assert.equal(isAd("/com/spotify/track/1Yk0cQdMLx5RzzFTYwmuld"), false)
  assert.equal(isAd(""), false)
  assert.equal(isAd(null), false)
})

test("tokenExpired respeta el margen de 30s", () => {
  const now = 1_000_000_000_000 // ms
  // expiresAt en segundos
  assert.equal(tokenExpired(now / 1000 + 3600, now), false) // caduca en 1h -> válido
  assert.equal(tokenExpired(now / 1000 - 1, now), true)     // ya caducado
  assert.equal(tokenExpired(now / 1000 + 20, now), true)    // dentro del margen de 30s
  assert.equal(tokenExpired(0, now), true)                  // sin token
})
