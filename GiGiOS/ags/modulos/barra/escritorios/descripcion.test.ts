import assert from "node:assert/strict"
import test from "node:test"

import { construirDescripcionEscritorio } from "./descripcion.ts"

test("shows only the app when the window title is empty or redundant", () => {
  assert.equal(construirDescripcionEscritorio({ nombreAplicacion: "Spotify", claseAplicacion: "spotify", titulo: "" }), "Spotify")
  assert.equal(construirDescripcionEscritorio({ nombreAplicacion: "Spotify", claseAplicacion: "spotify", titulo: "spotify" }), "Spotify")
})

test("removes the browser name from the useful page title", () => {
  assert.equal(
    construirDescripcionEscritorio({
      nombreAplicacion: "Mozilla Firefox",
      claseAplicacion: "firefox",
      titulo: "Documentación de Hyprland — Mozilla Firefox",
    }),
    "Mozilla Firefox\nDocumentación de Hyprland",
  )
})

test("keeps concise editor context but drops its repeated app name", () => {
  assert.equal(
    construirDescripcionEscritorio({
      nombreAplicacion: "Visual Studio Code",
      claseAplicacion: "code",
      titulo: "Workspaces.tsx - GiGiOS - Visual Studio Code",
    }),
    "Visual Studio Code\nWorkspaces.tsx - GiGiOS",
  )
})

test("reduces a terminal prompt title to the current directory", () => {
  assert.equal(
    construirDescripcionEscritorio({
      nombreAplicacion: "kitty",
      claseAplicacion: "kitty",
      titulo: "paraguayo33@orion:~/GiGiOS",
    }),
    "kitty\nGiGiOS",
  )
})

test("uses the short part of a reverse-domain class as fallback", () => {
  assert.equal(
    construirDescripcionEscritorio({ claseAplicacion: "org.gnome.Nautilus", titulo: "Descargas" }),
    "Nautilus\nDescargas",
  )
})

test("uses exactly two lines and truncates long context", () => {
  const descripcion = construirDescripcionEscritorio({
    nombreAplicacion: "Firefox",
    claseAplicacion: "firefox",
    titulo: "Una página con un título deliberadamente larguísimo que no cabe\n- Firefox",
  })

  assert.equal(descripcion.split("\n").length, 2)
  assert.equal(descripcion, "Firefox\nUna página con un título deliberadamente…")
})
