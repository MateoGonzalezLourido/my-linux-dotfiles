import { execAsync } from "ags/process"

import {
  crearPlanDesplazamiento,
  crearPlanIntercambio,
  type ClienteHyprctl,
  type PlanMovimientoEscritorios,
} from "./plan"
import {
  iniciarOperacionEscritorios,
  terminarOperacionEscritorios,
} from "./controlador"

let colaOperaciones: Promise<void> = Promise.resolve()

async function leerClientes(): Promise<ClienteHyprctl[]> {
  const datos: unknown = JSON.parse(await execAsync(["hyprctl", "clients", "-j"]))
  if (!Array.isArray(datos)) throw new Error("hyprctl clients no devolvió una lista")
  return datos as ClienteHyprctl[]
}

async function ejecutarPlan(plan: PlanMovimientoEscritorios) {
  for (const movimiento of plan.movimientos) {
    // Equivalente Lua de `movetoworkspacesilent`: sin `follow=false`, window.move
    // ARRASTRA el foco al workspace destino (verificado en instancia anidada), que
    // es justo lo que "silent" evita.
    await execAsync([
      "hyprctl",
      "dispatch",
      `hl.dsp.window.move({workspace='${movimiento.idDestino}', window='address:${movimiento.direccion}', follow=false})`,
    ])
  }
  if (plan.idFocoDestino !== null) {
    await execAsync(["hyprctl", "dispatch", `hl.dsp.focus({workspace=${plan.idFocoDestino}})`])
  }
}

function encolarOperacion(operacion: () => Promise<void>): Promise<void> {
  const encolada = colaOperaciones.then(operacion, operacion)
  colaOperaciones = encolada.catch(() => {})
  return encolada
}

async function conOperacionEscritorios(crearPlan: (clientes: ClienteHyprctl[]) => PlanMovimientoEscritorios) {
  return encolarOperacion(async () => {
    iniciarOperacionEscritorios()
    try {
      const clientes = await leerClientes()
      await ejecutarPlan(crearPlan(clientes))
    } catch (error) {
      console.error("No se pudieron reordenar los escritorios", error)
    } finally {
      // Astal destruye y recrea workspaces vaciados durante el movimiento.
      await new Promise<void>((resolve) => setTimeout(resolve, 120))
      terminarOperacionEscritorios()
    }
  })
}

export function intercambiarEscritorios(primerId: number, segundoId: number, idEnfocado: number): Promise<void> {
  return conOperacionEscritorios((clientes) =>
    crearPlanIntercambio(clientes, primerId, segundoId, idEnfocado),
  )
}

export function desplazarEscritorios(
  idOrigen: number,
  idDestino: number,
  idsOrdenados: readonly number[],
  idEnfocado: number,
): Promise<void> {
  return conOperacionEscritorios((clientes) =>
    crearPlanDesplazamiento(clientes, idOrigen, idDestino, idsOrdenados, idEnfocado),
  )
}
