import type { StoredNotification } from "../store"

const DURACION_POPUP_MS = 5500
const DURACION_POPUP_SISTEMA_MS = 10000
const DURACION_POPUP_CON_ACCION_MS = 20000
const DURACION_MAXIMA_POPUP_MS = 60000

export function obtenerAccionesVisibles(notificacion: StoredNotification): StoredNotification["actions"] {
  return (notificacion.actions ?? []).filter((accion) =>
    accion.id !== "default" && accion.label.trim() !== ""
  )
}

// Los popups con acciones necesitan tiempo para poder leerse y accionarse. Los del
// sistema (`x-gigios-source:system`, o sea lo que emiten los scripts de `hypr/scripts/`)
// también, aunque no traigan botón: informan del resultado de una función del equipo
// —reparar un USB, un análisis, una alerta de disco— y 5,5 s no dan ni para leerlos.
// El tiempo solicitado por el emisor se respeta dentro de unos límites para que ni un
// valor muy corto vuelva inútil el aviso ni `-t 0` deje el popup fijado indefinidamente.
export function calcularDuracionPopup(notificacion: StoredNotification): number {
  const tieneAcciones = obtenerAccionesVisibles(notificacion).length > 0
  const esDelSistema = notificacion.source === "system"
  if (!tieneAcciones && !esDelSistema) return DURACION_POPUP_MS

  const duracionMinima = tieneAcciones
    ? DURACION_POPUP_CON_ACCION_MS
    : DURACION_POPUP_SISTEMA_MS
  const duracionSolicitada = notificacion.expireTimeout ?? 0
  const duracionBase = duracionSolicitada > 0 ? duracionSolicitada : duracionMinima

  return Math.min(
    Math.max(duracionBase, duracionMinima),
    DURACION_MAXIMA_POPUP_MS,
  )
}

export function crearResumenRafaga(id: number, cantidad: number): StoredNotification {
  return {
    id,
    appName: "GiGiOS",
    appIcon: "",
    summary: "Muchas notificaciones nuevas",
    body: `Han llegado ${cantidad} notificaciones. Revísalas en el panel de notificaciones.`,
    timestamp: Date.now(),
    read: false,
    urgency: 1,
    actions: [],
    meta: {
      lifetime: "timed",
      clearOnBoot: false,
      noHistory: true,
      muteAudio: true,
      dontShow: false,
      dedupKey: "gigios-popup-burst-summary",
      conditions: [],
      matchedRules: [],
    },
  }
}
