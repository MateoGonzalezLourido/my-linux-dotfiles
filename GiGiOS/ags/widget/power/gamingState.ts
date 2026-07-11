// widget/power/gamingState.ts
//
// Puente del estado "jugando" hacia DISCO, para que scripts de shell (bash)
// puedan leerlo. La detección de juego (isGame, widget/bar/games/detect.ts) ya
// la usan el indicador de la barra (GamesIndicator) y el auto-DND, pero cada uno
// la calcula en su propia memoria de AGS y NADA la persiste. Bash no puede leer
// la memoria de AGS, así que este watcher único la REUTILIZA (no la reimplementa)
// y escribe ~/.config/gigios/runtime-state.json = { "gaming": bool } cuando
// cambia. hypr/scripts/oom-monitor.sh lo lee para pausar el escaneo de descargas
// mientras juegas.
//
// Mismo patrón event-driven que GamesIndicator (client-added/removed + evento
// "fullscreen", sin polling). Se arranca una vez desde app.ts vía
// initGamingState() (igual que initAutoDnd()).

import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import { createState } from "ags"
import { isGame } from "../bar/games/detect"

const STATE_PATH = `${GLib.get_user_config_dir()}/gigios/runtime-state.json`

// Estado reactivo compartido por si algún widget lo quiere consumir en el futuro.
export const [isGaming, _setGaming] = createState(false)

let started = false

function writeFlag(gaming: boolean) {
  try {
    const dir = GLib.path_get_dirname(STATE_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    GLib.file_set_contents(STATE_PATH, JSON.stringify({ gaming }))
  } catch (e) {
    console.error("[gamingState] write failed:", e)
  }
}

export function initGamingState(): void {
  if (started) return
  started = true

  const hypr = AstalHyprland.get_default()

  // Fuente de verdad: direcciones de las ventanas-juego vivas. gaming = size > 0.
  // Igual que GamesIndicator, un juego detectado vive hasta que su ventana cierra
  // (salir de fullscreen no lo apaga: sigues en el juego).
  const games = new Set<string>()

  const recompute = () => {
    const gaming = games.size > 0
    if (gaming === isGaming.get()) return
    _setGaming(gaming)
    writeFlag(gaming)
  }

  const addIfGame = (c: any) => {
    if (!c || !c.address || games.has(c.address)) return
    if (!isGame(c)) return
    games.add(c.address)
    recompute()
  }

  // Barrido inicial + escritura inicial (deja el flag en false si no hay juegos,
  // para que bash tenga un valor válido desde el arranque del shell).
  for (const c of (hypr.get_clients?.() ?? [])) addIfGame(c)
  writeFlag(isGaming.get())

  hypr.connect("client-added", (_s, client) => {
    addIfGame(client)
    // class/fullscreen puede resolverse un instante después del mapeo; un único
    // recheck tardío, y solo si la clase aún no está (no arranca timers al abrir
    // ventanas normales como un terminal o editor).
    if (!client || !client.class) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        addIfGame(client)
        return GLib.SOURCE_REMOVE
      })
    }
  })

  // client-removed pasa la dirección (string), no un objeto Client.
  hypr.connect("client-removed", (_s, address: string) => {
    if (games.delete(address)) recompute()
  })

  // Juegos nativos que solo se vuelven detectables al ir a fullscreen.
  hypr.connect("event", (_s, name: string) => {
    if (name !== "fullscreen") return
    addIfGame(hypr.focusedClient)
  })
}
