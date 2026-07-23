import Gdk from "gi://Gdk"
import { createState, For, onCleanup } from "ags"
import { Gtk } from "ags/gtk4"

import { workspaceVisibleLimit, wsPreviewEnabled } from "../../ajustes/preferences"
import { wsPreviewSuspended } from "../../../servicios/energia/powerState"
import {
  obtenerHyprland,
  suscribirDatosEscritorios,
} from "../../../servicios/escritorios/controlador"
import { desplazarEscritorios, intercambiarEscritorios } from "../../../servicios/escritorios/operaciones"
import type { EstadoVisibilidadBarra } from "../../../estado/visibilidadBarra"
import {
  ordenarClientesEscritorio,
  recordarEscritorioReciente,
  seleccionarEscritoriosRecientes,
} from "./orden"
import BotonEscritorio, {
  type InteraccionesBotonEscritorio,
} from "./BotonEscritorio"
import {
  crearCapturadorEscritorios,
  rutaVistaPreviaEscritorio,
} from "./capturas"
import { obtenerIconosClientesEscritorio } from "./iconos"
import type { ClienteEscritorio, EscritorioVisible } from "./modelo"
import { crearGestorVistaPreviaEscritorios } from "./gestorVistaPrevia"

export interface InteraccionEscritorios {
  cambiarArrastre: (activo: boolean) => void
  cambiarVistaPrevia: (activa: boolean) => void
  adquirirTeclado: () => void
  liberarTeclado: () => void
}

const INTERACCION_NULA: InteraccionEscritorios = {
  cambiarArrastre: () => {},
  cambiarVistaPrevia: () => {},
  adquirirTeclado: () => {},
  liberarTeclado: () => {},
}

const vistaPreviaActiva = () => wsPreviewEnabled.get() && !wsPreviewSuspended.get()

/** Escritorios de una barra concreta. Todo el estado visual pertenece al monitor. */
export default function Escritorios(
  monitorGdk: Gdk.Monitor,
  visibilidad: EstadoVisibilidadBarra,
  interaccion: InteraccionEscritorios = INTERACCION_NULA,
) {
  const hyprland = obtenerHyprland()
  const nombreSalida = monitorGdk.get_connector() ?? ""
  const geometria = monitorGdk.get_geometry()
  const obtenerMonitorHyprland = () => {
    if (nombreSalida) return hyprland.get_monitor_by_name(nombreSalida)
    // En ciertos backends/versiones GDK no expone connector. La posición lógica
    // sigue identificando la misma salida que Hyprland sin mezclar monitores.
    return hyprland.get_monitors().find((monitor) =>
      monitor.x === geometria.x && monitor.y === geometria.y
    ) ?? null
  }
  const obtenerIdEscritorioActivo = () =>
    obtenerMonitorHyprland()?.activeWorkspace?.id ?? -1

  let idsEscritoriosRecientes = recordarEscritorioReciente([], obtenerIdEscritorioActivo())
  let ultimoIdEscritorioActivo = obtenerIdEscritorioActivo()
  const [escritorios, fijarEscritorios] = createState<EscritorioVisible[]>([])
  const [escritoriosRenderizados, fijarEscritoriosRenderizados] =
    createState<EscritorioVisible[]>([])
  const [idEnfocado, fijarIdEnfocado] = createState(ultimoIdEscritorioActivo)
  const [direccionEnfocada, fijarDireccionEnfocada] = createState("")

  // Sin connector se mantiene la lista por geometría, pero grim queda desactivado:
  // no se puede seleccionar con seguridad una salida mediante `-o`.
  const capturador = crearCapturadorEscritorios(
    nombreSalida,
    obtenerIdEscritorioActivo,
    vistaPreviaActiva,
  )
  const vistaPrevia = crearGestorVistaPreviaEscritorios(
    monitorGdk,
    interaccion.cambiarVistaPrevia,
  )
  const interaccionesBoton: InteraccionesBotonEscritorio = {
    cambiarArrastre: interaccion.cambiarArrastre,
    adquirirTeclado: interaccion.adquirirTeclado,
    liberarTeclado: interaccion.liberarTeclado,
  }

  const actualizar = () => {
    const monitor = obtenerMonitorHyprland()
    if (!monitor) {
      capturador.conservarEscritorios(new Set())
      fijarEscritorios([])
      if (visibilidad.visible.get()) fijarEscritoriosRenderizados([])
      fijarIdEnfocado(-1)
      fijarDireccionEnfocada("")
      return
    }

    const idActivo = monitor.activeWorkspace?.id ?? -1
    if (idActivo !== ultimoIdEscritorioActivo) {
      ultimoIdEscritorioActivo = idActivo
      capturador.solicitar(idActivo)
    }
    idsEscritoriosRecientes = recordarEscritorioReciente(idsEscritoriosRecientes, idActivo)
    fijarIdEnfocado(idActivo)

    const clienteEnfocado = hyprland.focusedClient
    fijarDireccionEnfocada(
      clienteEnfocado?.monitor?.id === monitor.id ? clienteEnfocado.address : "",
    )

    const escritoriosLocales = hyprland.get_workspaces()
      .filter((escritorio) => escritorio.monitor?.id === monitor.id)
      .sort((primero, segundo) => primero.id - segundo.id)
    const idsLocales = new Set(escritoriosLocales.map((escritorio) => escritorio.id))
    capturador.conservarEscritorios(idsLocales)
    const clientesPorEscritorio = new Map<number, ClienteEscritorio[]>()

    for (const cliente of hyprland.get_clients() as ClienteEscritorio[]) {
      const idEscritorio = cliente.workspace?.id ?? cliente.get_workspace?.()?.id
      if (typeof idEscritorio !== "number" || !idsLocales.has(idEscritorio)) continue
      const clientes = clientesPorEscritorio.get(idEscritorio) ?? []
      clientes.push(cliente)
      clientesPorEscritorio.set(idEscritorio, clientes)
    }

    const candidatos = escritoriosLocales.map((escritorio) => {
      const clientes = clientesPorEscritorio.get(escritorio.id) ?? []
      return {
        id: escritorio.id,
        enfocar: () => escritorio.focus(),
        tieneClientes: clientes.length > 0,
        clientes: obtenerIconosClientesEscritorio(ordenarClientesEscritorio(clientes)),
      }
    })
    const siguientes = seleccionarEscritoriosRecientes(
      candidatos.filter((escritorio) => escritorio.tieneClientes || escritorio.id === idActivo),
      idsEscritoriosRecientes,
      idActivo,
      workspaceVisibleLimit.get(),
    ).map(({ id, enfocar, clientes }) => ({ id, enfocar, clientes }))

    fijarEscritorios(siguientes)
    if (visibilidad.visible.get()) fijarEscritoriosRenderizados(siguientes)
  }

  const mostrarEstadoOptimista = (siguientes: EscritorioVisible[]) => {
    fijarEscritorios(siguientes)
    fijarEscritoriosRenderizados(siguientes)
  }

  const intercambiarVisualmente = (primerId: number, segundoId: number) => {
    const siguientes = [...escritorios.get()]
    const primerIndice = siguientes.findIndex((escritorio) => escritorio.id === primerId)
    const segundoIndice = siguientes.findIndex((escritorio) => escritorio.id === segundoId)
    if (primerIndice < 0 || segundoIndice < 0) return
    ;[siguientes[primerIndice], siguientes[segundoIndice]] =
      [siguientes[segundoIndice], siguientes[primerIndice]]
    mostrarEstadoOptimista(siguientes)
  }

  const desplazarVisualmente = (idOrigen: number, idDestino: number) => {
    const siguientes = [...escritorios.get()]
    const indiceOrigen = siguientes.findIndex((escritorio) => escritorio.id === idOrigen)
    const indiceDestino = siguientes.findIndex((escritorio) => escritorio.id === idDestino)
    if (indiceOrigen < 0 || indiceDestino < 0 || indiceOrigen === indiceDestino) return
    const [origen] = siguientes.splice(indiceOrigen, 1)
    siguientes.splice(indiceDestino, 0, origen)
    mostrarEstadoOptimista(siguientes)
  }

  const intercambiar = (primerId: number, segundoId: number) => {
    intercambiarVisualmente(primerId, segundoId)
    void intercambiarEscritorios(primerId, segundoId, obtenerIdEscritorioActivo())
  }

  const desplazar = (idOrigen: number, idDestino: number) => {
    const idsOrdenados = escritorios.get().map((escritorio) => escritorio.id)
    desplazarVisualmente(idOrigen, idDestino)
    void desplazarEscritorios(idOrigen, idDestino, idsOrdenados, obtenerIdEscritorioActivo())
  }

  const renumerar = (idOrigen: number, idDestino: number) => {
    if (idOrigen === idDestino) return
    const monitor = obtenerMonitorHyprland()
    if (!monitor) return
    const ocupado = hyprland.get_workspaces().find((escritorio) => escritorio.id === idDestino)
    if (ocupado && ocupado.monitor?.id !== monitor.id) return
    if (ocupado) intercambiarVisualmente(idOrigen, idDestino)
    void intercambiarEscritorios(idOrigen, idDestino, obtenerIdEscritorioActivo())
  }

  const dejarDatos = suscribirDatosEscritorios(actualizar)
  const dejarLimite = workspaceVisibleLimit.subscribe(actualizar)
  const dejarVisibilidad = visibilidad.visible.subscribe(() => {
    if (visibilidad.visible.get()) fijarEscritoriosRenderizados(escritorios.get())
  })
  const alCambiarPreferenciaVistaPrevia = () => {
    if (!vistaPreviaActiva()) vistaPrevia.cerrar()
    else capturador.solicitar(obtenerIdEscritorioActivo())
  }
  const dejarVistaPrevia = wsPreviewEnabled.subscribe(alCambiarPreferenciaVistaPrevia)
  const dejarSuspension = wsPreviewSuspended.subscribe(alCambiarPreferenciaVistaPrevia)
  const capturaInicial = setTimeout(
    () => capturador.solicitar(obtenerIdEscritorioActivo(), 0),
    800,
  )

  onCleanup(() => {
    dejarDatos()
    dejarLimite()
    dejarVisibilidad()
    dejarVistaPrevia()
    dejarSuspension()
    clearTimeout(capturaInicial)
    capturador.eliminar()
    vistaPrevia.eliminar()
    interaccion.cambiarArrastre(false)
    interaccion.cambiarVistaPrevia(false)
  })

  const overlay = new Gtk.Overlay()
  overlay.set_child(
    <box cssClasses={["Workspaces"]} spacing={2}>
      <For each={escritoriosRenderizados}>
        {(escritorio) => (
          <BotonEscritorio
            escritorio={escritorio}
            overlay={overlay}
            idEnfocado={idEnfocado}
            direccionEnfocada={direccionEnfocada}
            vistaPrevia={vistaPrevia}
            vistaPreviaActiva={vistaPreviaActiva}
            rutaVistaPrevia={(idEscritorio) =>
              rutaVistaPreviaEscritorio(nombreSalida, idEscritorio)
            }
            interacciones={interaccionesBoton}
            alIntercambiar={intercambiar}
            alDesplazar={desplazar}
            alRenumerar={renumerar}
            obtenerEscritorios={() => escritorios.get()}
          />
        )}
      </For>
    </box>,
  )
  return overlay
}
