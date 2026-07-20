// widget/bar/functions/wakeup.ts
//
// "Wake up": mantiene el PC despierto, como si lo estuvieras usando, durante los
// minutos que pidas (o sin límite si dejas el campo vacío).
//
// Puente hacia DISCO, como gamingState.ts: quien decide de verdad es
// hypr/scripts/idle-action.sh, la puerta por la que pasan los on-timeout de
// hypridle. hypridle no sabe de Wake up y bash no puede leer la memoria de AGS,
// así que aquí se escribe ~/.config/gigios/wakeup.json y allí se lee:
//
//   { "active": bool, "until": <epoch seg|null>, "screen": bool, "pid": <pid de AGS> }
//
// `until` es ABSOLUTO (epoch), no un contador que haya que ir bajando: así la puerta
// resuelve la caducidad sola contra el reloj de pared aunque nadie reescriba el
// fichero, y la cuenta atrás de la UI no se desfasa si el reloj se va (p. ej. tras
// una suspensión manual, donde los timeouts de GLib no corren).
//
// `pid` es el de AGS: la puerta comprueba que sigue vivo. Sin eso, un cuelgue de AGS
// con un Wake up sin límite dejaría el PC sin suspenderse para siempre y sin UI
// donde apagarlo.
//
// Alcance (ver idle-action.sh): a secas veta SOLO la suspensión; con `screen` veta
// además apagar y bloquear la pantalla.

import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { createState } from "ags"
import { execAsync } from "ags/process"
import { parseMinutes, normalizeMinutesText } from "./wakeupTime"

const STATE_PATH = `${GLib.get_user_config_dir()}/gigios/wakeup.json`

const nowSec = () => Math.floor(Date.now() / 1000)

// ── Estado ───────────────────────────────────────────────────────────────────
// Solo en RAM, como el resto del menú de funciones (ver state.ts). wakeup.json no
// es persistencia: es el canal hacia bash, y initWakeUp() lo limpia al arrancar.
export const [wakeUpActive, _setActive] = createState(false)
export const [wakeUpScreen, _setScreen] = createState(false)
export const [wakeUpMinutes, _setMinutes] = createState("")
/** Segundos que quedan, o null = sin límite. Solo tiene sentido con wakeUpActive. */
export const [wakeUpRemaining, _setRemaining] = createState<number | null>(null)

/** Instante de caducidad (epoch seg), o null = sin límite. Espejo en RAM de `until`. */
let until: number | null = null
let tick: number | null = null

// ── Efectos ──────────────────────────────────────────────────────────────────

function ownPid(): number {
  try {
    return new Gio.Credentials().get_unix_pid()
  } catch (e) {
    // Sin pid la puerta no puede comprobar que seguimos vivos y hará fail-open
    // (nunca vetará). Preferimos un Wake up que no funciona a un veto huérfano.
    console.error("[wakeup] no se pudo obtener el pid:", e)
    return 0
  }
}

function writeState(active: boolean) {
  try {
    const dir = GLib.path_get_dirname(STATE_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    GLib.file_set_contents(STATE_PATH, JSON.stringify({
      active,
      until: active ? until : null,
      screen: wakeUpScreen.get(),
      pid: ownPid(),
    }))
  } catch (e) {
    console.error("[wakeup] write failed:", e)
  }
}

// hypridle no repite un on-timeout que ya disparó en esta tanda de inactividad: si
// vetamos la suspensión a los 11 min y el Wake up caduca en el 30, nadie volvería a
// intentarla y el PC se quedaría despierto para siempre. Reiniciar hypridle rearma
// los contadores desde cero, así que la cuenta normal (apagar/bloquear/suspender)
// vuelve a correr a partir de ahora. Mismo `pkill; &` que usa InactividadSection.tsx al
// guardar los tiempos.
function restartHypridle() {
  execAsync(["bash", "-c", "pkill hypridle; hypridle &"]).catch(() => {})
}

function stopTick() {
  if (tick !== null) {
    GLib.source_remove(tick)
    tick = null
  }
}

function startTick() {
  stopTick()
  if (until === null) return   // sin límite: no hay nada que contar
  tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
    const left = until === null ? null : until - nowSec()
    if (left === null) { tick = null; return GLib.SOURCE_REMOVE }
    if (left <= 0) {
      // Soltamos la fuente ANTES de apagar: setWakeUpActive(false) llama a
      // stopTick(), y un source_remove sobre la fuente que está corriendo, seguido
      // del SOURCE_REMOVE de este return, sería una doble baja (warning de GLib).
      tick = null
      setWakeUpActive(false)
      return GLib.SOURCE_REMOVE
    }
    _setRemaining(left)
    return GLib.SOURCE_CONTINUE
  })
}

/** (Re)programa la caducidad a partir del campo de minutos y lo publica. */
function arm() {
  const mins = parseMinutes(wakeUpMinutes.get())
  until = mins === null ? null : nowSec() + mins * 60
  _setRemaining(until === null ? null : until - nowSec())
  writeState(true)
  startTick()
}

// ── API ──────────────────────────────────────────────────────────────────────

export function setWakeUpActive(on: boolean) {
  if (on) {
    _setActive(true)
    arm()
    return
  }
  if (!wakeUpActive.get()) return
  _setActive(false)
  until = null
  _setRemaining(null)
  stopTick()
  writeState(false)
  restartHypridle()
}

/** Cambiar los minutos con el Wake up encendido reprograma la cuenta atrás en caliente. */
export function setWakeUpMinutes(text: string) {
  const clean = normalizeMinutesText(text)
  _setMinutes(clean)
  if (wakeUpActive.get()) arm()
}

/** La puerta lee `screen` del JSON, así que hay que republicarlo si cambia en caliente. */
export function setWakeUpScreen(on: boolean) {
  _setScreen(on)
  if (wakeUpActive.get()) writeState(true)
}

/**
 * Deja el Wake up apagado al arrancar el shell. Se llama una vez desde app.ts
 * (como initGamingState() / initAutoDnd()).
 *
 * El Wake up es por sesión, igual que el resto del menú de funciones. Además esto
 * es lo que impide un estado zombi: si AGS se reinicia (o el PC arranca) con un
 * wakeup.json que dice `active:true`, la puerta seguiría vetando la suspensión sin
 * que ninguna UI lo enseñe ni haya dónde apagarlo.
 *
 * El pid del JSON no basta para cubrir esto. Cubre el caso "AGS murió y no volvió",
 * pero los pid se reciclan: tras un reinicio, el pid del AGS anterior puede estar
 * ocupado por cualquier otro proceso vivo y la puerta lo daría por bueno, vetando
 * la suspensión por un Wake up que el usuario pidió en otra sesión. Limpiar al
 * arrancar corta el problema de raíz en una línea.
 */
export function initWakeUp(): void {
  writeState(false)
}
