import { test } from "node:test"
import assert from "node:assert/strict"
import { matchesFullscreenApp, shouldSilence } from "./detect.ts"

// ── matchesFullscreenApp ──────────────────────────────────────────────────────

test("null / undefined client never matches", () => {
  assert.equal(matchesFullscreenApp(null, ["mpv"]), false)
  assert.equal(matchesFullscreenApp(undefined, ["mpv"]), false)
})

test("a non-fullscreen client never matches, even if class is listed", () => {
  assert.equal(matchesFullscreenApp({ class: "mpv", fullscreen: 0 }, ["mpv"]), false)
  assert.equal(matchesFullscreenApp({ class: "mpv" }, ["mpv"]), false)
})

// fullscreen es un modo (0 nada / 1 MAXIMIZADO / 2 pantalla completa): maximizar mpv
// no es verlo a pantalla completa, así que no debe silenciar.
test("a MAXIMIZED client (mode 1) does not match — only real fullscreen does", () => {
  assert.equal(matchesFullscreenApp({ class: "mpv", fullscreen: 1 }, ["mpv"]), false)
  assert.equal(shouldSilence([{ class: "mpv", fullscreen: 1 }], ["mpv"]), false)
})

test("a fullscreen client whose class is listed matches", () => {
  assert.equal(matchesFullscreenApp({ class: "mpv", fullscreen: 2 }, ["mpv"]), true)
})

test("matching is a case-insensitive substring", () => {
  assert.equal(matchesFullscreenApp({ class: "org.Mozilla.Firefox", fullscreen: 2 }, ["firefox"]), true)
  assert.equal(matchesFullscreenApp({ class: "MPV", fullscreen: 2 }, ["mpv"]), true)
})

test("initialClass / initial_class are also considered", () => {
  assert.equal(matchesFullscreenApp({ initialClass: "vlc", fullscreen: 2 }, ["vlc"]), true)
  assert.equal(matchesFullscreenApp({ initial_class: "vlc", fullscreen: 2 }, ["vlc"]), true)
})

test("a fullscreen client whose class is NOT listed does not match", () => {
  assert.equal(matchesFullscreenApp({ class: "kitty", fullscreen: 2 }, ["mpv", "vlc"]), false)
})

test("empty / whitespace app entries never match (no accidental universal match)", () => {
  assert.equal(matchesFullscreenApp({ class: "kitty", fullscreen: 2 }, [""]), false)
  assert.equal(matchesFullscreenApp({ class: "kitty", fullscreen: 2 }, ["  "]), false)
})

test("a fullscreen client with no class does not match", () => {
  assert.equal(matchesFullscreenApp({ fullscreen: 2 }, ["mpv"]), false)
})

// ── shouldSilence ─────────────────────────────────────────────────────────────

test("empty / missing client list does not silence", () => {
  assert.equal(shouldSilence([], ["mpv"]), false)
  assert.equal(shouldSilence(null, ["mpv"]), false)
  assert.equal(shouldSilence(undefined, ["mpv"]), false)
})

test("a running game silences regardless of the apps list", () => {
  assert.equal(shouldSilence([{ class: "steam_app_570" }], []), true)
  assert.equal(shouldSilence([{ class: "eldenring.exe" }], []), true)
})

test("a configured fullscreen app silences even if it is a game-blocklisted app", () => {
  // mpv is blocklisted by the game heuristic, but listing it here overrides that.
  assert.equal(shouldSilence([{ class: "mpv", fullscreen: 2 }], ["mpv"]), true)
})

test("a fullscreen app that is NOT configured does not silence on its own", () => {
  assert.equal(shouldSilence([{ class: "mpv", fullscreen: 2 }], []), false)
})

test("silences when any one client in the list qualifies", () => {
  assert.equal(shouldSilence([
    { class: "kitty" },
    { class: "firefox", fullscreen: 2 },
    { class: "mpv", fullscreen: 2 },
  ], ["mpv"]), true)
})

test("does not silence when no client qualifies", () => {
  assert.equal(shouldSilence([
    { class: "kitty" },
    { class: "firefox", fullscreen: 0 },
  ], ["mpv"]), false)
})

// ── shouldSilence: workspace awareness ────────────────────────────────────────

test("a game on the focused workspace silences", () => {
  assert.equal(shouldSilence(
    [{ class: "steam_app_570", workspace: { id: 1 } }],
    [],
    1,
  ), true)
})

test("a game on a NON-focused workspace does not silence", () => {
  assert.equal(shouldSilence(
    [{ class: "steam_app_570", workspace: { id: 1 } }],
    [],
    2,
  ), false)
})

test("a configured fullscreen app off the focused workspace does not silence", () => {
  assert.equal(shouldSilence(
    [{ class: "mpv", fullscreen: 2, workspace: { id: 3 } }],
    ["mpv"],
    2,
  ), false)
})

test("silences only when the qualifying client is on the focused workspace", () => {
  const clients = [
    { class: "steam_app_570", workspace: { id: 1 } },   // game on ws 1
    { class: "firefox", fullscreen: 2, workspace: { id: 2 } }, // browser on ws 2
  ]
  assert.equal(shouldSilence(clients, [], 1), true)   // looking at the game
  assert.equal(shouldSilence(clients, [], 2), false)  // looking at the browser
})

test("omitting the active workspace id keeps the old workspace-agnostic behaviour", () => {
  assert.equal(shouldSilence([{ class: "steam_app_570", workspace: { id: 1 } }], []), true)
  assert.equal(shouldSilence([{ class: "steam_app_570", workspace: { id: 1 } }], [], null), true)
})

test("a client with unknown workspace is not excluded (safety)", () => {
  assert.equal(shouldSilence([{ class: "steam_app_570" }], [], 2), true)
})
