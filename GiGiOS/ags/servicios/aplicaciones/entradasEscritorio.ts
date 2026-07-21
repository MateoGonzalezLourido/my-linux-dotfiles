import Gio from "gi://Gio"
import {
  candidatosIdentificadorAplicacion,
  normalizarIdentificadorAplicacion,
  sinExtensionAplicacion,
} from "./identificadores"

export interface EntradaEscritorio {
  nombre: string
  categorias: string[]
  icono: Gio.Icon | null
}

export interface ClienteAplicacionLike {
  class?: string | null
  initialClass?: string | null
  initial_class?: string | null
}

let indice: Map<string, EntradaEscritorio> | null = null
let monitorAplicaciones: Gio.AppInfoMonitor | null = null

function anadirClave(
  mapa: Map<string, EntradaEscritorio>,
  clave: string | null | undefined,
  entrada: EntradaEscritorio,
) {
  const normalizada = normalizarIdentificadorAplicacion(clave)
  if (normalizada && !mapa.has(normalizada)) mapa.set(normalizada, entrada)
}

function construirIndice(): Map<string, EntradaEscritorio> {
  const mapa = new Map<string, EntradaEscritorio>()

  for (const app of Gio.AppInfo.get_all() as Gio.AppInfo[]) {
    const desktop = app as any
    const entrada: EntradaEscritorio = {
      nombre: app.get_name() ?? "",
      categorias: (desktop.get_categories?.() ?? "")
        .split(";")
        .map((categoria: string) => categoria.trim().toLowerCase())
        .filter(Boolean),
      icono: app.get_icon(),
    }

    anadirClave(mapa, desktop.get_startup_wm_class?.(), entrada)

    const id = app.get_id() ?? ""
    if (id) {
      const sinExtension = sinExtensionAplicacion(id)
      for (const candidato of candidatosIdentificadorAplicacion(sinExtension)) {
        anadirClave(mapa, candidato, entrada)
      }
    }

    const comando = app.get_commandline() ?? ""
    const juegoSteam = /rungameid\/(\d+)/.exec(comando)
    if (juegoSteam) anadirClave(mapa, `steam_app_${juegoSteam[1]}`, entrada)
  }

  return mapa
}

function obtenerIndice(): Map<string, EntradaEscritorio> {
  if (!monitorAplicaciones) {
    monitorAplicaciones = Gio.AppInfoMonitor.get()
    monitorAplicaciones.connect("changed", () => { indice = null })
  }
  indice ??= construirIndice()
  return indice
}

export function obtenerEntradaEscritorio(
  cliente: ClienteAplicacionLike | null | undefined,
): EntradaEscritorio | null {
  if (!cliente) return null
  const mapa = obtenerIndice()

  for (const valor of [cliente.class, cliente.initialClass ?? cliente.initial_class]) {
    for (const candidato of candidatosIdentificadorAplicacion(valor)) {
      const entrada = mapa.get(candidato)
      if (entrada) return entrada
    }
  }
  return null
}
