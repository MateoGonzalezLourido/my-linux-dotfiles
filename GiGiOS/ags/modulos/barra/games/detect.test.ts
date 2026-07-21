import { test } from "node:test"
import assert from "node:assert/strict"
import { isGame } from "./detect.ts"

// ── casos vacíos ──────────────────────────────────────────────────────────────

test("null / undefined / empty client is never a game", () => {
  assert.equal(isGame(null), false)
  assert.equal(isGame(undefined), false)
  assert.equal(isGame({}), false)
  assert.equal(isGame({ class: "" }), false)
})

// ── señales fuertes de clase ──────────────────────────────────────────────────

test("steam_app_ class is a game", () => {
  assert.equal(isGame({ class: "steam_app_1234" }), true)
})

test("gamescope class is a game", () => {
  assert.equal(isGame({ class: "gamescope" }), true)
})

test("wine .exe class is a game", () => {
  assert.equal(isGame({ class: "eldenring.exe" }), true)
})

test("wine / proton classes are games", () => {
  assert.equal(isGame({ class: "wine" }), true)
  assert.equal(isGame({ class: "proton" }), true)
})

test("signal is matched case-insensitively", () => {
  assert.equal(isGame({ class: "Steam_App_570" }), true)
  assert.equal(isGame({ class: "EldenRing.EXE" }), true)
})

test("signal is read from initialClass / initial_class too", () => {
  assert.equal(isGame({ initialClass: "steam_app_9" }), true)
  assert.equal(isGame({ initial_class: "gamescope" }), true)
})

// ── lanzadores: la ventana es el lanzador, no el juego ────────────────────────

test("launchers are NOT games, not even fullscreen", () => {
  assert.equal(isGame({ class: "steam", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "steamwebhelper" }), false)
  assert.equal(isGame({ class: "lutris", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "net.lutris.Lutris" }), false)
  assert.equal(isGame({ class: "heroic", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "bottles" }), false)
})

test("launchers beat the class signals they contain (protontricks, winetricks)", () => {
  assert.equal(isGame({ class: "protontricks" }), false)
  assert.equal(isGame({ class: "winetricks" }), false)
  assert.equal(isGame({ class: "winecfg" }), false)
})

test("a launcher's own Categories=Game entry does not make it a game", () => {
  assert.equal(isGame({ class: "steam", fullscreen: 2 }, { categories: ["game"] }), false)
})

// ── fullscreen es un MODO, no un bool ─────────────────────────────────────────
// 0 = nada, 1 = MAXIMIZADO, 2 = pantalla completa. Tratar el 1 como fullscreen es lo
// que hacía pasar por juego a cualquier ventana maximizada.

test("REGRESIÓN: a maximized window (mode 1) is not a game", () => {
  assert.equal(isGame({ class: "discord", fullscreen: 1 }), false)
  assert.equal(isGame({ class: "someapp", fullscreen: 1 }), false)
})

test("a really-fullscreen unknown app (mode 2) counts as a game", () => {
  assert.equal(isGame({ class: "factorio", fullscreen: 2 }), true)
})

test("REGRESIÓN: Discord is never a game (maximized, fullscreen, or with its entry)", () => {
  assert.equal(isGame({ class: "discord", fullscreen: 1 }), false)
  assert.equal(isGame({ class: "discord", fullscreen: 2 }), false)
  assert.equal(
    isGame({ class: "discord", fullscreen: 2 }, { categories: ["network", "instantmessaging"] }),
    false,
  )
  assert.equal(isGame({ class: "vesktop", fullscreen: 2 }), false)
})

test("fullscreen browsers / players / terminals do NOT count", () => {
  assert.equal(isGame({ class: "firefox", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "chromium", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "brave-browser", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "google-chrome", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "mpv", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "vlc", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "kitty", fullscreen: 2 }), false)
  assert.equal(isGame({ class: "spotify", fullscreen: 2 }), false)
})

test("the non-game list matches by name, not by loose substring", () => {
  // "st" (el terminal) está en la lista: con includes() casaba dentro de
  // "counter-strike" y descartaba el juego.
  assert.equal(isGame({ class: "counter-strike", fullscreen: 2 }), true)
  assert.equal(isGame({ class: "st", fullscreen: 2 }), false)
})

test("non-fullscreen window with no class signal is not a game", () => {
  assert.equal(isGame({ class: "factorio", fullscreen: 0 }), false)
  assert.equal(isGame({ class: "someapp" }), false)
})

// ── evidencia: entrada .desktop ───────────────────────────────────────────────

test("a .desktop entry with Categories=Game is a game, even windowed", () => {
  assert.equal(isGame({ class: "factorio" }, { categories: ["game", "simulation"] }), true)
  assert.equal(isGame({ class: "0ad" }, { categories: ["Game"] }), true) // sin normalizar
})

test("a known .desktop entry WITHOUT Game beats the fullscreen fallback", () => {
  assert.equal(
    isGame({ class: "someviewer", fullscreen: 2 }, { categories: ["graphics", "viewer"] }),
    false,
  )
})

test("no .desktop entry (null / empty categories) falls back to fullscreen", () => {
  assert.equal(isGame({ class: "unknowngame", fullscreen: 2 }, { categories: null }), true)
  assert.equal(isGame({ class: "unknowngame", fullscreen: 2 }, { categories: [] }), true)
  assert.equal(isGame({ class: "unknowngame", fullscreen: 0 }, { categories: null }), false)
})

// ── evidencia: ruta del proceso ───────────────────────────────────────────────

test("a process under steamapps / proton / lutris is a game, windowed and classless", () => {
  assert.equal(
    isGame({ class: "hl2_linux" }, { exe: "/home/u/.steam/steamapps/common/half-life/hl2_linux" }),
    true,
  )
  assert.equal(
    isGame(
      { class: "somewindow" },
      { cmdline: "/home/u/.local/share/lutris/runners/wine/bin/wine game" },
    ),
    true,
  )
})

test("the process path does not override the non-game list", () => {
  // Discord vive en /usr/bin; aunque su cmdline mencionara wine, sigue sin ser un juego.
  assert.equal(isGame({ class: "discord" }, { exe: "/opt/discord/discord", cmdline: "wine" }), false)
})

// ── instaladores de wine/proton ───────────────────────────────────────────────
// Datos REALES, copiados de `hyprctl clients` con el instalador de Voicemod corriendo:
// Steam lo lanza con la MISMA clase que un juego (steam_proton) y su binario cuelga de
// …/proton-…/wine-preloader, así que la señal de clase y la de proceso dicen las dos
// "juego". Solo el título (y el .tmp del instalador en el cmdline) lo delatan.

test("REGRESIÓN: a Proton INSTALLER window is not a game (Voicemod, caso real)", () => {
  const ev = {
    exe: "/run/host/usr/share/steam/compatibilitytools.d/proton-cachyos-slr/files/lib/wine/i386-unix/wine-preloader",
    cmdline:
      "c:\\users\\steamuser\\appdata\\local\\temp\\is-405ro.tmp\\voicemodinstaller_1.6.18-dn3sgb.tmp /sl5=$10056",
    categories: null,
  }
  assert.equal(isGame({ class: "steam_proton", title: "Instalar - Voicemod" }, ev), false)
  assert.equal(isGame({ class: "steam_proton", title: "Instalar" }, ev), false)
})

test("installer / uninstaller titles are not games", () => {
  assert.equal(isGame({ class: "setup.exe", title: "Setup - Some Game" }), false)
  assert.equal(isGame({ class: "steam_proton", title: "Install" }), false)
  assert.equal(isGame({ class: "steam_proton", title: "Desinstalar Foo" }), false)
})

test("a real Proton GAME window is still a game", () => {
  // Mismo runtime, mismo binario: lo único que cambia es que no es un instalador.
  assert.equal(
    isGame(
      { class: "steam_proton", title: "Elden Ring", fullscreen: 2 },
      { exe: "/usr/share/steam/compatibilitytools.d/proton-cachyos/files/bin/wine-preloader" },
    ),
    true,
  )
})
