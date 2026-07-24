import Gdk from "gi://Gdk"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { obtenerEntradaEscritorio, type ClienteAplicacionLike } from "./entradasEscritorio"
import {
  nombreBaseAplicacion,
  normalizarIdentificadorAplicacion,
} from "./identificadores"

let tema: Gtk.IconTheme | null = null

function obtenerTema(): Gtk.IconTheme | null {
  if (tema) return tema
  const pantalla = Gdk.Display.get_default()
  if (!pantalla) return null
  tema = Gtk.IconTheme.get_for_display(pantalla)
  return tema
}

function existeEnTema(nombre: string | null | undefined): boolean {
  if (!nombre) return false
  const actual = obtenerTema()
  return !!actual && actual.has_icon(nombre)
}

const cacheIconosOriginales = new Map<string, Gio.Icon | null>()

// Los directorios XDG no cambian durante la sesión, así que la lista se arma una
// sola vez: la recorren tres bucles anidados por cada icono que falla la caché.
let raicesCacheadas: string[] | null = null

function raicesHicolor(): string[] {
  if (raicesCacheadas) return raicesCacheadas
  const directorios = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
  const raices = directorios.map((dir) => GLib.build_filenamev([dir, "icons", "hicolor"]))
  raices.push(
    GLib.build_filenamev([GLib.get_user_data_dir(), "flatpak", "exports", "share", "icons", "hicolor"]),
    "/var/lib/flatpak/exports/share/icons/hicolor",
  )
  raicesCacheadas = [...new Set(raices)]
  return raicesCacheadas
}

const DIRECTORIOS_ICONO_ORIGINAL = [
  "scalable/apps", "512x512/apps", "256x256/apps", "192x192/apps", "128x128/apps",
  "96x96/apps", "64x64/apps", "48x48/apps", "32x32/apps", "24x24/apps",
  "22x22/apps", "16x16/apps",
]

function iconoOriginalNombrado(nombre: string): Gio.Icon | null {
  const seguro = GLib.path_get_basename(nombre).replace(/\.(?:svg|png|xpm)$/i, "")
  if (!seguro) return null
  if (cacheIconosOriginales.has(seguro)) return cacheIconosOriginales.get(seguro) ?? null

  for (const raiz of raicesHicolor()) {
    for (const directorio of DIRECTORIOS_ICONO_ORIGINAL) {
      for (const extension of ["svg", "png", "xpm"]) {
        const ruta = GLib.build_filenamev([raiz, directorio, `${seguro}.${extension}`])
        if (!GLib.file_test(ruta, GLib.FileTest.EXISTS)) continue
        const icono = Gio.FileIcon.new(Gio.File.new_for_path(ruta))
        cacheIconosOriginales.set(seguro, icono)
        return icono
      }
    }
  }

  cacheIconosOriginales.set(seguro, null)
  return null
}

function clasesCliente(cliente: ClienteAplicacionLike | null | undefined): string[] {
  const exactas = [cliente?.class, cliente?.initialClass ?? cliente?.initial_class]
    .map(normalizarIdentificadorAplicacion)
    .filter(Boolean)
  // Prioridad visual histórica: clases exactas actual/inicial antes que sus bases.
  return [...new Set([...exactas, ...exactas.map(nombreBaseAplicacion)].filter(Boolean))]
}

export function obtenerIconoOriginalAplicacion(
  cliente: ClienteAplicacionLike | null | undefined,
): Gio.Icon | null {
  const iconoEntrada = obtenerEntradaEscritorio(cliente)?.icono ?? null
  const archivo = (iconoEntrada as any)?.get_file?.() as Gio.File | undefined
  if (archivo) {
    const ruta = archivo.get_path()
    if (ruta && GLib.file_test(ruta, GLib.FileTest.EXISTS)) return iconoEntrada
  }

  const nombres = (iconoEntrada as any)?.get_names?.() as string[] | undefined
  for (const nombre of nombres ?? []) {
    const icono = iconoOriginalNombrado(nombre)
    if (icono) return icono
  }

  const clases = clasesCliente(cliente)
  const steam = clases.map((clase) => /steam_app_(\d+)/.exec(clase)).find(Boolean)
  const candidatos = [steam ? `steam_icon_${steam[1]}` : "", ...clases]
  for (const nombre of candidatos) {
    if (!nombre) continue
    const icono = iconoOriginalNombrado(nombre)
    if (icono) return icono
  }
  return null
}

export function esIconoUtilizable(icono: Gio.Icon | null): boolean {
  if (!icono) return false
  const nombres = (icono as any).get_names?.() as string[] | undefined
  if (nombres?.length) return nombres.some(existeEnTema)

  const archivo = (icono as any).get_file?.() as Gio.File | undefined
  if (archivo) {
    const ruta = archivo.get_path()
    return !!ruta && GLib.file_test(ruta, GLib.FileTest.EXISTS)
  }
  return true
}

export function obtenerNombreIconoAplicacion(
  cliente: ClienteAplicacionLike | null | undefined,
): string | null {
  const entrada = obtenerEntradaEscritorio(cliente)
  const nombres = (entrada?.icono as any)?.get_names?.() as string[] | undefined
  const desdeEntrada = nombres?.find(existeEnTema)
  if (desdeEntrada) return desdeEntrada

  const clases = clasesCliente(cliente)
  const steam = clases.map((clase) => /steam_app_(\d+)/.exec(clase)).find(Boolean)
  if (steam && existeEnTema(`steam_icon_${steam[1]}`)) return `steam_icon_${steam[1]}`

  for (const candidato of clases) if (existeEnTema(candidato)) return candidato
  return null
}

export function obtenerIconoGenericoAplicacion(
  cliente: ClienteAplicacionLike | null | undefined,
): string {
  const clases = [cliente?.class, cliente?.initialClass ?? cliente?.initial_class]
    .map(normalizarIdentificadorAplicacion)
  const esWine = clases.some((clase) =>
    /(?:^|[._-])(?:wine|proton)(?:$|[._-])/.test(clase) || clase.endsWith(".exe"),
  )
  if (esWine) {
    for (const candidato of ["wine", "org.winehq.Wine"]) {
      if (existeEnTema(candidato)) return candidato
    }
  }

  for (const candidato of ["application-default-icon", "application-x-executable"]) {
    if (existeEnTema(candidato)) return candidato
  }
  return "application-x-executable"
}

export { nombreBaseAplicacion }
