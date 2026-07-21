// Nombre + icono REAL de una ventana-juego, para GamesIndicator.
//
// Workspaces consulta antes el mapa de glifos de appIcons.ts. Este módulo resuelve
// los iconos gráficos reales para las apps sin glifo y para GamesIndicator, en este
// orden:
//
//   1. Icono de la entrada .desktop que casa con la clase (lo normal en juegos
//      nativos y en los que Steam/Heroic instalan con acceso directo).
//   2. Steam sin .desktop: el tema de iconos suele traer "steam_icon_<appid>",
//      que Steam escribe en ~/.local/share/icons al instalar el juego.
//   3. Icono del tema que se llame como la clase (o su base: "org.factorio.Factorio"
//      → "factorio", "eldenring.exe" → "eldenring").
//   4. Nada: el llamador pinta el glifo de mando como último recurso.

import Gdk from "gi://Gdk"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"

import { desktopEntryFor, type ClientLike } from "./evidence"

export interface GameLook {
  name: string
  gicon: Gio.Icon | null
  iconName: string | null
}

/** Glifo Nerd Font de mando: el último recurso cuando no hay icono resoluble. */
export const GAME_GLYPH = "󰊴"

let theme: Gtk.IconTheme | null = null

function iconTheme(): Gtk.IconTheme | null {
  if (theme) return theme
  const display = Gdk.Display.get_default()
  if (!display) return null
  theme = Gtk.IconTheme.get_for_display(display)
  return theme
}

function themeHas(name: string | null | undefined): boolean {
  if (!name) return false
  const t = iconTheme()
  return !!t && t.has_icon(name)
}

// El tema activo (Tela circle) redibuja muchas aplicaciones dentro de un círculo.
// En una barra de 19px ese borde y su padding consumen buena parte del icono. Para
// los workspaces buscamos primero el recurso original instalado en hicolor: SVG si
// existe y, para PNG, una variante grande que GTK reducirá al tamaño final.
const originalIconCache = new Map<string, Gio.Icon | null>()

function hicolorRoots(): string[] {
  const dataDirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
  const roots = dataDirs.map((dir) => GLib.build_filenamev([dir, "icons", "hicolor"]))

  // Flatpak no siempre añade sus exports a XDG_DATA_DIRS en shells ya iniciados.
  roots.push(
    GLib.build_filenamev([GLib.get_user_data_dir(), "flatpak", "exports", "share", "icons", "hicolor"]),
    "/var/lib/flatpak/exports/share/icons/hicolor",
  )
  return [...new Set(roots)]
}

const ORIGINAL_ICON_DIRS = [
  "scalable/apps",
  "512x512/apps",
  "256x256/apps",
  "192x192/apps",
  "128x128/apps",
  "96x96/apps",
  "64x64/apps",
  "48x48/apps",
  "32x32/apps",
  "24x24/apps",
  "22x22/apps",
  "16x16/apps",
]

function originalNamedIcon(name: string): Gio.Icon | null {
  const safeName = GLib.path_get_basename(name).replace(/\.(?:svg|png|xpm)$/i, "")
  if (!safeName) return null
  if (originalIconCache.has(safeName)) return originalIconCache.get(safeName) ?? null

  for (const root of hicolorRoots()) {
    for (const dir of ORIGINAL_ICON_DIRS) {
      for (const ext of ["svg", "png", "xpm"]) {
        const path = GLib.build_filenamev([root, dir, `${safeName}.${ext}`])
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) continue
        const icon = Gio.FileIcon.new(Gio.File.new_for_path(path))
        originalIconCache.set(safeName, icon)
        return icon
      }
    }
  }

  originalIconCache.set(safeName, null)
  return null
}

/** Icono original de la aplicación, sin el marco/padding del tema visual activo. */
export function appOriginalIcon(c: ClientLike | null | undefined): Gio.Icon | null {
  const entryIcon = desktopEntryFor(c)?.icon ?? null
  const file = (entryIcon as any)?.get_file?.() as Gio.File | undefined
  if (file) {
    const path = file.get_path()
    if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) return entryIcon
  }

  const names = (entryIcon as any)?.get_names?.() as string[] | undefined
  for (const name of names ?? []) {
    const icon = originalNamedIcon(name)
    if (icon) return icon
  }

  const cls = (c?.class ?? "").toLowerCase()
  const initCls = (c?.initialClass ?? c?.initial_class ?? "").toLowerCase()
  const steam = /steam_app_(\d+)/.exec(cls) ?? /steam_app_(\d+)/.exec(initCls)
  const candidates = [
    steam ? `steam_icon_${steam[1]}` : "",
    cls,
    initCls,
    baseName(cls),
    baseName(initCls),
  ]
  for (const name of candidates) {
    if (!name) continue
    const icon = originalNamedIcon(name)
    if (icon) return icon
  }
  return null
}

/** ¿Este Gio.Icon se va a PINTAR de verdad?
 *
 *  Un Gtk.Image con un icono temático que el tema no tiene no da error: dibuja un
 *  hueco (o el "image-missing"). Ese es el "icono roto que no muestra nada" —
 *  típico de los accesos directos de Steam, cuyo Icon=steam_icon_<appid> solo existe
 *  si Steam llegó a instalar el .png. Si no es usable, mejor caer al glifo. */
function usableGicon(icon: Gio.Icon | null): boolean {
  if (!icon) return false

  const names = (icon as any).get_names?.() as string[] | undefined
  if (names && names.length > 0) return names.some((n) => themeHas(n))

  const file = (icon as any).get_file?.() as Gio.File | undefined
  if (file) {
    const path = file.get_path()
    return !!path && GLib.file_test(path, GLib.FileTest.EXISTS)
  }

  return true // GBytesIcon y demás: los carga el propio Gtk.Image
}

/** "org.factorio.Factorio" → "factorio"; "EldenRing.exe" → "eldenring". */
function baseName(cls: string): string {
  const c = cls.toLowerCase()
  if (c.endsWith(".exe")) return c.slice(0, -4)
  const i = c.lastIndexOf(".")
  return i >= 0 ? c.slice(i + 1) : c
}

function prettify(cls: string): string {
  return (
    baseName(cls)
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
      .trim() || "Juego"
  )
}

/** Nombre de icono del TEMA para esta ventana, o null si el tema no tiene ninguno.
 *
 *  Solo devuelve nombres que el tema tiene de verdad. Es la parte importante: pasarle
 *  a un Gtk.Image un iconName inexistente NO da error, pinta el icono roto — que es lo
 *  que hacían los workspaces al usar la clase a pelo ("steam_app_730" no es un icono).
 *
 *  Lo usan tanto GamesIndicator como Workspaces.tsx. */
export function appIconName(c: ClientLike | null | undefined): string | null {
  const cls = (c?.class ?? "").toLowerCase()
  const initCls = (c?.initialClass ?? c?.initial_class ?? "").toLowerCase()

  // Icono declarado por la entrada .desktop (si el tema lo tiene).
  const entry = desktopEntryFor(c)
  const names = (entry?.icon as any)?.get_names?.() as string[] | undefined
  const fromEntry = names?.find((n) => themeHas(n))
  if (fromEntry) return fromEntry

  // Juego de Steam sin acceso directo: Steam instala su icono como steam_icon_<appid>.
  const steam = /steam_app_(\d+)/.exec(cls) ?? /steam_app_(\d+)/.exec(initCls)
  if (steam && themeHas(`steam_icon_${steam[1]}`)) return `steam_icon_${steam[1]}`

  // Un icono del tema que se llame como la clase.
  for (const candidate of [cls, initCls, baseName(cls), baseName(initCls)]) {
    if (themeHas(candidate)) return candidate
  }

  return null
}

/** Icono genérico para una ventana sin icono propio (la usa Workspaces.tsx, que a
 *  diferencia de la pastilla de juegos tiene que pintar ALGO para cualquier ventana).
 *
 *  Si es una ventana de wine/proton — un instalador, un diálogo — el icono de Wine dice
 *  bastante más que el genérico, que en el tema del usuario es un icono de *mimetype*
 *  (un documento con "!") y parece un error. */
export function genericIconName(c: ClientLike | null | undefined): string {
  const cls = (c?.class ?? "").toLowerCase()
  const initCls = (c?.initialClass ?? c?.initial_class ?? "").toLowerCase()

  const isWine = [cls, initCls].some((x) => /wine|proton/.test(x) || x.endsWith(".exe"))
  if (isWine) {
    for (const w of ["wine", "org.winehq.Wine"]) if (themeHas(w)) return w
  }

  for (const g of ["application-default-icon", "application-x-executable"]) {
    if (themeHas(g)) return g
  }
  return "application-x-executable"
}

export function describeGame(c: ClientLike | null | undefined): GameLook {
  const cls = (c?.class ?? "").toLowerCase()
  const initCls = (c?.initialClass ?? c?.initial_class ?? "").toLowerCase()
  const title = (c?.title ?? "").trim()
  const entry = desktopEntryFor(c)

  // Icono: el de la entrada .desktop si se puede pintar (cubre los Icon= con ruta
  // absoluta, que un iconName no admite); si no, un nombre del tema; si no, nada y el
  // llamador pone el glifo de mando.
  const gicon = entry && usableGicon(entry.icon) ? entry.icon : null
  const iconName = gicon ? null : appIconName(c)

  // Nombre: manda la entrada .desktop ("Counter-Strike 2", disponible ya en el mapeo,
  // sin esperar al título). Sin entrada, el título de la ventana — salvo que sea
  // kilométrico: los juegos de wine meten versión, build y motor en la barra de título.
  const isSteam = /steam_app_\d+/.test(cls) || /steam_app_\d+/.test(initCls)
  const name =
    entry?.name ||
    (title && title.length <= 40 ? title : "") ||
    (isSteam ? "Juego de Steam" : prettify(cls || initCls))

  return { name, gicon, iconName }
}
