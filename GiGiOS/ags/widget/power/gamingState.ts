// widget/power/gamingState.ts
//
// Puente del estado "jugando" hacia DISCO, para que scripts de shell (bash)
// puedan leerlo. La detección de juego (isGameClient, widget/bar/games/evidence.ts,
// que es isGame + evidencia del .desktop y de /proc) ya la usan el indicador de la
// barra (GamesIndicator) y el auto-DND, pero cada uno
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
import Gio from "gi://Gio"
import { createState } from "ags"
import { isGameClient } from "../bar/games/evidence"
import { backgroundJobsSuspended } from "./powerState.ts"

const STATE_PATH = `${GLib.get_user_config_dir()}/gigios/runtime-state.json`

// Estado reactivo compartido por si algún widget lo quiere consumir en el futuro.
export const [isGaming, _setGaming] = createState(false)

let started = false

// ¿Hay una ventana-juego con el foco AHORA?, y epoch (s) del último instante en que
// la hubo. Ver el comentario de writeFlag() para el porqué.
let gameFocused = false
let lastGameFocus = 0

// Mismo gesto que `ownPid()` en bar/functions/wakeup.ts. Un 0 (no se pudo obtener)
// no rompe nada: el lado bash no encontrará /proc/0 y hará fail-open, o sea que la
// congelación deja de aplicarse — que es el modo de fallo que queremos.
function getPid(): number {
  try {
    return new Gio.Credentials().get_unix_pid()
  } catch (e) {
    console.error("[gamingState] no se pudo obtener el pid:", e)
    return 0
  }
}

// Se escribe TAMBIÉN el pid de AGS, y no es informativo: es una guarda.
//
// Mientras el flag solo pausaba el escáner de descargas (una pausa opcional y
// apagada por defecto), que se quedara pegado en `true` daba casi igual. Ahora
// además CONGELA updates-monitor y los sondeos de SMART y de unidades
// (hypr/scripts/lib/gaming-gate.sh), así que si AGS muere con un juego abierto el
// fichero se quedaría diciendo "jugando" para siempre y esos monitores no volverían
// a correr en toda la sesión — en silencio, y sin UI donde notarlo. Con el pid, el
// lado bash comprueba /proc/<pid> y, al no encontrarlo, hace su trabajo igual.
//
// Es la mitad de la cadena; la otra es que initGamingState() reescribe el fichero al
// arrancar el shell, y hace falta porque los pid se RECICLAN: tras un reinicio el del
// AGS anterior puede estar ocupado por otro proceso vivo. Mismo patrón que
// wakeup.json (ver bar/functions/wakeup.ts y CLAUDE.md).
// `gameFocused` + `lastGameFocus` existen para un caso que `gaming` a secas no sabe
// distinguir: un juego ABIERTO no es lo mismo que un juego que ESTÁS JUGANDO.
//
// `gaming` vive hasta que la ventana cierra (a propósito: irte a otro workspace 30 s
// no es dejar de jugar, y descongelar ahí lanzaría clamscan con el juego residente,
// además de oscilar en cada alt-tab). Pero con eso solo, dejar un juego aparcado en
// otro workspace mientras trabajas congelaba el mantenimiento el día entero, en
// silencio. Con el instante del último foco, el gate aplica una GRACIA: mientras el
// juego esté delante —o lo hayas tenido hace poco— congela; si lleva mucho sin tocarse,
// descongela solo, y vuelve a congelar en cuanto le des foco otra vez.
//
// Se escribe el epoch ABSOLUTO, no un contador, por lo mismo que `until` en
// wakeup.json: así el lado bash resuelve la gracia contra el reloj de pared sin que
// nadie tenga que reescribir el fichero, y no se desfasa tras una suspensión.
//
// `powerSaveFreeze` viaja en este mismo fichero, y no en uno propio, porque el fichero
// se reescribe ENTERO en cada cambio: dos escritores sobre el mismo JSON se pisarían.
// Es el mismo gate (lib/gaming-gate.sh) congelando el mismo sondeo prescindible por otro
// motivo —ahorro de energía en vez de partida—, así que comparte también la guarda del
// pid: si AGS muere, bash hace fail-open y el mantenimiento vuelve a correr.
// El valor ya viene COMBINADO desde powerState.ts (ahorro activo Y el usuario lo pidió),
// igual que spotifyBarSuspended y compañía; bash no reevalúa nada.
function writeFlag(gaming: boolean) {
  try {
    const dir = GLib.path_get_dirname(STATE_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    GLib.file_set_contents(STATE_PATH, JSON.stringify({
      gaming,
      gameFocused,
      lastGameFocus,
      powerSaveFreeze: backgroundJobsSuspended.get(),
      pid: getPid(),
    }))
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

  // Foco. Solo se escribe en la TRANSICIÓN (juego coge foco / lo pierde), no en cada
  // cambio de ventana: alt-tabear entre el navegador y el editor no toca este fichero.
  // Al PERDERLO se sella el instante, que es justo el origen de la cuenta de gracia.
  const refreshFocus = () => {
    const c = hypr.focusedClient
    const now = games.size > 0 && !!c && games.has(c.address)
    if (now === gameFocused) return
    gameFocused = now
    lastGameFocus = Math.floor(Date.now() / 1000)
    if (isGaming.get()) writeFlag(true)
  }

  const addIfGame = (c: any) => {
    if (!c || !c.address || games.has(c.address)) return
    if (!isGameClient(c)) return
    games.add(c.address)
    recompute()
    refreshFocus()   // el juego recién abierto suele nacer con el foco
  }

  // Barrido inicial + escritura inicial (deja el flag en false si no hay juegos,
  // para que bash tenga un valor válido desde el arranque del shell).
  for (const c of (hypr.get_clients?.() ?? [])) addIfGame(c)
  // Si AGS reinicia con un juego ya delante, el instante del último foco es AHORA:
  // un 0 heredado lo daría por abandonado hace 55 años y no congelaría nada.
  lastGameFocus = Math.floor(Date.now() / 1000)
  writeFlag(isGaming.get())

  // El ahorro entra y sale sin que pase nada con las ventanas, así que sin esto el
  // fichero solo se actualizaría la próxima vez que abrieras o cerraras un juego.
  backgroundJobsSuspended.subscribe(() => writeFlag(isGaming.get()))

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
    refreshFocus()   // cerrar el juego que tenía el foco también lo suelta
  })

  hypr.connect("event", (_s, name: string) => {
    // Juegos nativos que solo se vuelven detectables al ir a fullscreen.
    if (name === "fullscreen") { addIfGame(hypr.focusedClient); return }
    // Cambio de ventana activa: incluye irse a otro workspace, que es el caso que
    // motivó todo esto. `activewindowv2` da la dirección y `activewindow` la clase;
    // nos vale cualquiera de los dos porque releemos `focusedClient` de todos modos.
    if (name === "activewindow" || name === "activewindowv2") refreshFocus()
  })
}
