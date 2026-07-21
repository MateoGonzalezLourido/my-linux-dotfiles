// modulos/orion/data/wallpaperConfig.ts
//
// Estado y utilidades para la sección "Temas" (RiceSection) de Orion: lista de
// wallpapers, fondo actual y ajuste "aleatorio al iniciar".
//
// Config runtime (fuera del repo): ~/.config/gigios/wallpaper.json
//   { "randomOnStart": bool, "current": "/ruta/al/fondo" }
//
// Reparto de escritura para no pisarse con el script bash:
//   - bash (hypr/scripts/wallpaper.sh) escribe `current` al aplicar un fondo.
//   - AGS (este módulo) escribe `randomOnStart` desde el toggle.
// Ambos hacen read-modify-write preservando el otro campo.

import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { createState } from "ags"
import { execAsync } from "ags/process"

const HOME = GLib.get_home_dir()
export const WALLPAPER_DIR = `${HOME}/GiGiOS/Wallpapers`
const CONFIG_PATH  = `${GLib.get_user_config_dir()}/gigios/wallpaper.json`
const WALLPAPER_SH = `${GLib.get_user_config_dir()}/hypr/scripts/wallpaper.sh`

const EXTS = [".jpg", ".jpeg", ".png", ".webp"]

// ── Estado reactivo ───────────────────────────────────────────────────────────
const [randomOnStart,   _setRandomOnStart]   = createState(true)
const [currentWallpaper, _setCurrentWallpaper] = createState("")
export { randomOnStart, currentWallpaper }

// ── Listado de wallpapers ─────────────────────────────────────────────────────
export function listWallpapers(): string[] {
  const out: string[] = []
  try {
    const dir  = Gio.File.new_for_path(WALLPAPER_DIR)
    const enumr = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    let info: Gio.FileInfo | null
    while ((info = enumr.next_file(null)) !== null) {
      const name  = info.get_name()
      const lower = name.toLowerCase()
      if (EXTS.some(e => lower.endsWith(e))) out.push(`${WALLPAPER_DIR}/${name}`)
    }
  } catch (_) { /* carpeta ausente => lista vacía */ }
  out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  return out
}

// ── Config ────────────────────────────────────────────────────────────────────
function readConfig(): any {
  try {
    const [ok, content] = GLib.file_get_contents(CONFIG_PATH)
    if (!ok) return {}
    return JSON.parse(new TextDecoder().decode(content))
  } catch (_) { return {} }
}

function load() {
  const cfg = readConfig()
  if (typeof cfg.randomOnStart === "boolean") _setRandomOnStart(cfg.randomOnStart)
  if (typeof cfg.current === "string")        _setCurrentWallpaper(cfg.current)
}

// Escribe preservando el campo que no tocamos (bash es dueño de `current`).
function writeConfig(patch: { randomOnStart?: boolean; current?: string }) {
  try {
    const dir = GLib.path_get_dirname(CONFIG_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    const cfg = readConfig()
    const next = {
      randomOnStart: patch.randomOnStart ?? (typeof cfg.randomOnStart === "boolean" ? cfg.randomOnStart : true),
      current:       patch.current       ?? (typeof cfg.current === "string"        ? cfg.current       : ""),
    }
    GLib.file_set_contents(CONFIG_PATH, JSON.stringify(next, null, 2))
  } catch (_) { /* un fallo de escritura no debe romper la UI */ }
}

// Re-lee `current` del archivo tras un --random (bash lo escribió y no sabemos
// aquí qué fondo salió elegido).
function reloadCurrent() {
  const cfg = readConfig()
  if (typeof cfg.current === "string") _setCurrentWallpaper(cfg.current)
}

// ── Acciones ──────────────────────────────────────────────────────────────────
export function setRandomOnStart(on: boolean) {
  _setRandomOnStart(on)
  writeConfig({ randomOnStart: on })
}

export function applyWallpaper(path: string) {
  _setCurrentWallpaper(path)                       // resaltado inmediato
  execAsync([WALLPAPER_SH, path]).catch(() => {})  // bash aplica + guarda `current`
}

export function applyRandom() {
  execAsync([WALLPAPER_SH, "--random"])
    .then(() => reloadCurrent())
    .catch(() => {})
}

load()
