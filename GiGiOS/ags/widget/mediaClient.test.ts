import assert from "node:assert/strict"
import test from "node:test"

import { findMediaClient } from "./mediaClient.ts"

test("matches a desktop entry with a Hyprland client class", () => {
  const spotify = { address: "0x1", class: "Spotify", title: "Spotify Premium" }
  assert.equal(findMediaClient(
    { entry: "spotify.desktop", bus_name: "org.mpris.MediaPlayer2.spotify", identity: "Spotify" },
    [spotify],
  ), spotify)
})

test("matches dotted desktop ids and Firefox instance bus names", () => {
  const firefox = { address: "0x2", class: "firefox", initialClass: "org.mozilla.firefox" }
  assert.equal(findMediaClient(
    { entry: "org.mozilla.firefox", bus_name: "org.mpris.MediaPlayer2.firefox.instance1942" },
    [firefox],
  ), firefox)
})

test("uses the media title to choose between browser windows", () => {
  const other = { address: "0x3", class: "firefox", title: "Documentación — Mozilla Firefox" }
  const playing = { address: "0x4", class: "firefox", title: "Mi canción - YouTube — Mozilla Firefox" }
  assert.equal(findMediaClient(
    { identity: "Firefox", title: "Mi canción" },
    [other, playing],
  ), playing)
})

test("uses the MPRIS instance PID when a browser has a custom window class", () => {
  const brave = { address: "0x5", pid: 22704, class: "brave-origin" }
  assert.equal(findMediaClient(
    { bus_name: "org.mpris.MediaPlayer2.brave.instance22704", identity: "Brave" },
    [brave],
  ), brave)
})

test("does not focus an unrelated window", () => {
  assert.equal(findMediaClient(
    { identity: "VLC media player" },
    [{ address: "0x6", class: "org.gnome.Nautilus" }],
  ), null)
})
