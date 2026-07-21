import assert from "node:assert/strict"
import test from "node:test"

import { buildWorkspaceTooltip } from "./workspaceTooltip.ts"

test("shows only the app when the window title is empty or redundant", () => {
  assert.equal(buildWorkspaceTooltip({ appName: "Spotify", className: "spotify", title: "" }), "Spotify")
  assert.equal(buildWorkspaceTooltip({ appName: "Spotify", className: "spotify", title: "spotify" }), "Spotify")
})

test("removes the browser name from the useful page title", () => {
  assert.equal(
    buildWorkspaceTooltip({
      appName: "Mozilla Firefox",
      className: "firefox",
      title: "Documentación de Hyprland — Mozilla Firefox",
    }),
    "Mozilla Firefox\nDocumentación de Hyprland",
  )
})

test("keeps concise editor context but drops its repeated app name", () => {
  assert.equal(
    buildWorkspaceTooltip({
      appName: "Visual Studio Code",
      className: "code",
      title: "Workspaces.tsx - GiGiOS - Visual Studio Code",
    }),
    "Visual Studio Code\nWorkspaces.tsx - GiGiOS",
  )
})

test("reduces a terminal prompt title to the current directory", () => {
  assert.equal(
    buildWorkspaceTooltip({
      appName: "kitty",
      className: "kitty",
      title: "paraguayo33@orion:~/GiGiOS",
    }),
    "kitty\nGiGiOS",
  )
})

test("uses the short part of a reverse-domain class as fallback", () => {
  assert.equal(
    buildWorkspaceTooltip({ className: "org.gnome.Nautilus", title: "Descargas" }),
    "Nautilus\nDescargas",
  )
})

test("uses exactly two lines and truncates long context", () => {
  const tooltip = buildWorkspaceTooltip({
    appName: "Firefox",
    className: "firefox",
    title: "Una página con un título deliberadamente larguísimo que no cabe\n- Firefox",
  })

  assert.equal(tooltip.split("\n").length, 2)
  assert.equal(tooltip, "Firefox\nUna página con un título deliberadamente…")
})
