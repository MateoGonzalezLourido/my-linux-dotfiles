// Traduce el estado de Hyprland de una salida concreta a la condición pura de
// modulos/mascotas/estado/disparador.ts. Mismo repliegue de resolución de
// monitor y misma colección de señales compartida que
// servicios/escritorios/pantallaCompleta.ts (una sola suscripción para todas
// las barras y mascotas).
import type { Gdk } from "ags/gtk4"
import { obtenerHyprland, suscribirDatosEscritorios } from "../../../servicios/escritorios/controlador"
import { debeMostrarMascota } from "./disparador"

type Hyprland = ReturnType<typeof obtenerHyprland>
type MonitorHyprland = ReturnType<Hyprland["get_monitors"]>[number]

function resolverMonitor(monitorGdk: Gdk.Monitor): MonitorHyprland | undefined {
  const hyprland = obtenerHyprland()
  const nombreSalida = monitorGdk.get_connector() ?? ""
  if (nombreSalida) {
    const porNombre = hyprland.get_monitor_by_name(nombreSalida)
    if (porNombre) return porNombre
  }
  const geometria = monitorGdk.get_geometry()
  return hyprland.get_monitors().find(
    (monitor) => monitor.x === geometria.x && monitor.y === geometria.y,
  )
}

export function debeMostrarMascotaEnMonitor(monitorGdk: Gdk.Monitor): boolean {
  const monitor = resolverMonitor(monitorGdk)
  const idEscritorio = monitor?.activeWorkspace?.id
  // Sin escritorio resoluble no hay nada que tapar tampoco: se deja salir.
  if (idEscritorio == null) return true

  const hyprland = obtenerHyprland()
  const clientesDelEscritorio = (hyprland.get_clients?.() ?? [])
    .filter((cliente) => cliente?.workspace?.id === idEscritorio)
  const clienteEnfocado = hyprland.focusedClient
  const hayClienteEnfocado = clienteEnfocado != null
    && clientesDelEscritorio.some((cliente) => cliente === clienteEnfocado)

  return debeMostrarMascota(clientesDelEscritorio.length, hayClienteEnfocado)
}

/** Avisa cuando cambia si debe mostrarse la mascota en esta salida. El callback
 * recibe el valor ya deduplicado y se ejecuta también al suscribirse. */
export function suscribirActividadMascota(
  monitorGdk: Gdk.Monitor,
  alCambiar: (mostrar: boolean) => void,
): () => void {
  let anterior: boolean | null = null
  return suscribirDatosEscritorios(() => {
    const actual = debeMostrarMascotaEnMonitor(monitorGdk)
    if (actual === anterior) return
    anterior = actual
    alCambiar(actual)
  })
}
