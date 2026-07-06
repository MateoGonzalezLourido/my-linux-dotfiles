import { test } from "node:test"
import assert from "node:assert/strict"
import { isGame } from "./detect.ts"

test("null / undefined / empty client is never a game", () => {
  assert.equal(isGame(null), false)
  assert.equal(isGame(undefined), false)
  assert.equal(isGame({}), false)
  assert.equal(isGame({ class: "" }), false)
})

test("steam_app_ class is a game", () => {
  assert.equal(isGame({ class: "steam_app_1234" }), true)
})

test("gamescope class is a game", () => {
  assert.equal(isGame({ class: "gamescope" }), true)
})

test("wine .exe class is a game", () => {
  assert.equal(isGame({ class: "eldenring.exe" }), true)
})

test("wine / proton / lutris / heroic classes are games", () => {
  assert.equal(isGame({ class: "wine" }), true)
  assert.equal(isGame({ class: "proton" }), true)
  assert.equal(isGame({ class: "lutris" }), true)
  assert.equal(isGame({ class: "heroic" }), true)
})

test("signal is matched case-insensitively", () => {
  assert.equal(isGame({ class: "Steam_App_570" }), true)
  assert.equal(isGame({ class: "EldenRing.EXE" }), true)
})

test("signal is read from initialClass / initial_class too", () => {
  assert.equal(isGame({ initialClass: "steam_app_9" }), true)
  assert.equal(isGame({ initial_class: "gamescope" }), true)
})

test("fullscreen non-blocklisted window counts as a game", () => {
  assert.equal(isGame({ class: "factorio", fullscreen: 1 }), true)
})

test("fullscreen browsers / players / terminals do NOT count", () => {
  assert.equal(isGame({ class: "firefox", fullscreen: 1 }), false)
  assert.equal(isGame({ class: "chromium", fullscreen: 1 }), false)
  assert.equal(isGame({ class: "brave-browser", fullscreen: 1 }), false)
  assert.equal(isGame({ class: "mpv", fullscreen: 1 }), false)
  assert.equal(isGame({ class: "vlc", fullscreen: 1 }), false)
  assert.equal(isGame({ class: "kitty", fullscreen: 1 }), false)
})

test("non-fullscreen window with no class signal is not a game", () => {
  assert.equal(isGame({ class: "factorio", fullscreen: 0 }), false)
  assert.equal(isGame({ class: "someapp" }), false)
})
