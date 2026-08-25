// Nombre e icono con los que se pinta cada fila de la "mezcla de aplicaciones".
// La parte pura (candidatos, limpieza, filtro de infraestructura) y el porqué del fallo
// están en `identidadApps.ts`; aquí solo queda lo que necesita GTK: el índice de
// `.desktop` y el tema de iconos.

import Gio from "gi://Gio"
import { obtenerEntradaEscritorioPorCandidatos } from "../aplicaciones/entradasEscritorio"
import { nombreIconoDesdeCandidatos } from "../aplicaciones/iconos"
import { candidatosApp, claveApp, nombreCrudoApp, type PropsAudio } from "./identidadApps"
import type { TipoMezcla } from "./presetsApps"

export interface PresentacionApp {
  nombre: string
  icono: string
}

const ICONO_GENERICO: Record<TipoMezcla, string> = {
  speaker: "audio-x-generic-symbolic",
  mic: "audio-input-microphone-symbolic",
}

// El sondeo repasa la lista cada 2 s y cada repaso recorrería el índice de `.desktop` y
// preguntaría al tema por cada candidato. La caché se invalida cuando cambian las apps
// instaladas, igual que el índice al que envuelve.
const cache = new Map<string, PresentacionApp>()
let monitor: Gio.AppInfoMonitor | null = null

function vigilarInstalaciones() {
  if (monitor) return
  monitor = Gio.AppInfoMonitor.get()
  monitor.connect("changed", () => cache.clear())
}

export function presentacionApp(props: PropsAudio, tipo: TipoMezcla): PresentacionApp {
  vigilarInstalaciones()
  const clave = `${tipo}:${claveApp(props)}`
  const cacheado = cache.get(clave)
  if (cacheado) return cacheado

  const candidatos = candidatosApp(props)
  const entrada = obtenerEntradaEscritorioPorCandidatos(candidatos)
  const presentacion: PresentacionApp = {
    nombre: entrada?.nombre?.trim() || nombreCrudoApp(props),
    icono: nombreIconoDesdeCandidatos(candidatos) ?? ICONO_GENERICO[tipo],
  }
  cache.set(clave, presentacion)
  return presentacion
}

/**
 * ¿Hay un `.desktop` instalado detrás de este cliente? Es el filtro de las apps "en
 * silencio": un proceso que abre el servidor de sonido sin ser una aplicación lanzada por
 * el usuario (un ayudante, una herramienta de línea de órdenes) no tiene entrada de
 * escritorio, y una fila de volumen con su nombre de proceso no le dice nada a nadie.
 */
export function tieneEntradaEscritorio(props: PropsAudio): boolean {
  return obtenerEntradaEscritorioPorCandidatos(candidatosApp(props)) !== null
}
