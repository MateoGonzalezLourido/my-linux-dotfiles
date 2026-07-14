// Evidencia del sistema para la heurística de ./detect.ts. Aquí SÍ se toca disco
// (Gio.AppInfo + /proc), por eso vive fuera del módulo puro que testea node:test.
//
// Dos fuentes:
//   - La entrada .desktop que corresponde a la ventana (por StartupWMClass o por id).
//     Sus Categories son el desempate bueno: "Game" → juego; cualquier otra cosa →
//     NO es un juego, por mucho que esté maximizado (esto es lo que echa a Discord).
//     De paso da el nombre bonito y el icono real de la app, que es lo que pinta
//     GamesIndicator en la barra.
//   - /proc/<pid>/exe y /proc/<pid>/cmdline: los juegos de Steam/Proton/Lutris/Heroic
//     no instalan .desktop y su clase puede ser cualquier cosa, pero la RUTA del
//     ejecutable (…/steamapps/common/…, …/proton…) los delata.
//
// Todo se cachea: el índice de .desktop se construye una vez (y se invalida si cambia
// el directorio de aplicaciones), y /proc se lee una vez por pid.

import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { isGame, type GameClientLike, type GameEvidence } from "./detect"

export interface DesktopEntry {
  name: string
  categories: string[]
  icon: Gio.Icon | null
}

export interface ClientLike extends GameClientLike {
  pid?: number | null
}

// ---------------------------------------------------------------- índice .desktop

let index: Map<string, DesktopEntry> | null = null
let appMonitor: Gio.AppInfoMonitor | null = null

function addKey(map: Map<string, DesktopEntry>, key: string | null | undefined, entry: DesktopEntry) {
  if (!key) return
  const k = key.toLowerCase()
  if (k && !map.has(k)) map.set(k, entry)
}

function buildIndex(): Map<string, DesktopEntry> {
  const map = new Map<string, DesktopEntry>()

  for (const app of Gio.AppInfo.get_all() as Gio.AppInfo[]) {
    const desktop = app as any // GioUnix.DesktopAppInfo en la práctica
    const entry: DesktopEntry = {
      name: app.get_name() ?? "",
      categories: (desktop.get_categories?.() ?? "")
        .split(";")
        .map((c: string) => c.trim().toLowerCase())
        .filter(Boolean),
      icon: app.get_icon(),
    }

    // Claves fiables solamente. Casar por nombre de ejecutable daría falsos positivos
    // (media docena de apps Electron comparten binario) y un falso positivo aquí es
    // grave: una entrada equivocada sin "Game" descartaría un juego de verdad.
    addKey(map, desktop.get_startup_wm_class?.(), entry)

    const id = app.get_id() ?? "" // "discord.desktop", "com.valvesoftware.Steam.desktop"
    if (id) {
      const noExt = id.replace(/\.desktop$/i, "")
      addKey(map, noExt, entry)
      const dot = noExt.lastIndexOf(".")
      if (dot >= 0) addKey(map, noExt.slice(dot + 1), entry) // com.discordapp.Discord → discord
    }

    // Accesos directos de Steam ("Counter-Strike 2.desktop"): traen Categories=Game,
    // Icon=steam_icon_<appid> y Exec=steam steam://rungameid/<appid>, pero NO traen
    // StartupWMClass — así que por clase no casarían nunca. El appid del Exec es el
    // puente hacia la clase real de la ventana del juego, steam_app_<appid>, y nos da
    // su nombre bonito ("Counter-Strike 2") ya en el mapeo, sin esperar al título.
    const exec = app.get_commandline() ?? ""
    const rungame = /rungameid\/(\d+)/.exec(exec)
    if (rungame) addKey(map, `steam_app_${rungame[1]}`, entry)
  }

  return map
}

function getIndex(): Map<string, DesktopEntry> {
  if (!appMonitor) {
    // Instalar/desinstalar una app (o que Steam escriba el .desktop de un juego nuevo)
    // invalida el índice; sin esto haría falta reiniciar el shell para verlo.
    appMonitor = Gio.AppInfoMonitor.get()
    appMonitor.connect("changed", () => { index = null })
  }
  index ??= buildIndex()
  return index
}

/** Entrada .desktop de la ventana, si el escritorio la conoce. */
export function desktopEntryFor(c: ClientLike | null | undefined): DesktopEntry | null {
  if (!c) return null
  const idx = getIndex()
  const cls = (c.class ?? "").toLowerCase()
  const initCls = (c.initialClass ?? c.initial_class ?? "").toLowerCase()

  for (const key of [cls, initCls]) {
    if (!key) continue
    const hit = idx.get(key)
    if (hit) return hit
    const dot = key.lastIndexOf(".")
    if (dot >= 0 && !key.endsWith(".exe")) {
      const short = idx.get(key.slice(dot + 1))
      if (short) return short
    }
  }
  return null
}

// -------------------------------------------------------------------------- /proc

interface ProcInfo {
  exe: string | null
  cmdline: string | null
}

const procCache = new Map<number, ProcInfo>()
const PROC_CACHE_CAP = 128

function procInfo(pid: number | null | undefined): ProcInfo {
  if (!pid || pid <= 0) return { exe: null, cmdline: null }

  const cached = procCache.get(pid)
  if (cached) return cached

  let exe: string | null = null
  try {
    exe = GLib.file_read_link(`/proc/${pid}/exe`)
  } catch (_) {
    exe = null // proceso de otro usuario o ya muerto
  }

  let cmdline: string | null = null
  try {
    const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/cmdline`)
    if (ok) cmdline = new TextDecoder().decode(bytes).replace(/\0/g, " ").trim()
  } catch (_) {
    cmdline = null
  }

  const info: ProcInfo = {
    exe: exe ? exe.toLowerCase() : null,
    cmdline: cmdline ? cmdline.toLowerCase() : null,
  }

  // Los pids se reciclan: tope FIFO para que la caché no crezca con la sesión.
  if (procCache.size >= PROC_CACHE_CAP) {
    const oldest = procCache.keys().next().value
    if (oldest !== undefined) procCache.delete(oldest)
  }
  procCache.set(pid, info)
  return info
}

// ------------------------------------------------------------------------ público

export function collectEvidence(c: ClientLike | null | undefined): GameEvidence {
  if (!c) return {}
  const entry = desktopEntryFor(c)
  const proc = procInfo(c.pid)
  return {
    categories: entry ? entry.categories : null,
    exe: proc.exe,
    cmdline: proc.cmdline,
  }
}

/** isGame() con la evidencia del sistema ya recogida. Es lo que deben usar el
 *  indicador de la barra, gamingState y el auto-DND. */
export function isGameClient(c: ClientLike | null | undefined): boolean {
  if (!c) return false
  return isGame(c, collectEvidence(c))
}
