import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import { createState } from "ags"
import { esClienteJuego, invalidarEvidenciaProceso, type ClienteConProceso } from "./evidencia"

export const [clientesJuego, establecerClientesJuego] = createState<ClienteConProceso[]>([])
export const [clienteJuegoEnFoco, establecerClienteJuegoEnFoco] = createState<string | null>(null)
/** Cambia ante cualquier evento de ventana relevante para consumidores como auto-DND. */
export const [revisionVentanas, establecerRevisionVentanas] = createState(0)

let iniciado = false
const juegos = new Map<string, ClienteConProceso>()
const clientes = new Map<string, ClienteConProceso>()
const conexionesCliente = new Map<string, Array<{ cliente: any; id: number }>>()
const reintentos = new Map<string, number>()

const claveDireccion = (direccion: string | null | undefined) =>
  String(direccion ?? "").toLowerCase().replace(/^0x/, "")

function publicarJuegos() {
  establecerClientesJuego([...juegos.values()])
}

function publicarRevision() {
  establecerRevisionVentanas(revisionVentanas.get() + 1)
}

function actualizarFoco(hypr: AstalHyprland.Hyprland) {
  const direccion = claveDireccion((hypr.focusedClient as any)?.address)
  establecerClienteJuegoEnFoco(direccion && juegos.has(direccion) ? direccion : null)
}

function evaluarCliente(
  hypr: AstalHyprland.Hyprland,
  cliente: ClienteConProceso | null | undefined,
  republicarSiSigue = false,
  permitirQuitar = false,
) {
  const direccion = claveDireccion((cliente as any)?.address)
  if (!direccion || !clientes.has(direccion)) return

  const eraJuego = juegos.has(direccion)
  const esJuego = esClienteJuego(cliente)
  if (esJuego && cliente) juegos.set(direccion, cliente)
  // Un juego reconocido permanece hasta cerrar su ventana aunque abandone fullscreen.
  // Solo un cambio de título puede desmentirlo (p. ej. un instalador Proton tardío).
  else if (!eraJuego || permitirQuitar) juegos.delete(direccion)

  const sigueSiendoJuego = juegos.has(direccion)
  if (eraJuego !== sigueSiendoJuego || (sigueSiendoJuego && republicarSiSigue)) publicarJuegos()
  actualizarFoco(hypr)
  publicarRevision()
}

function conectarCliente(hypr: AstalHyprland.Hyprland, cliente: any) {
  const direccion = claveDireccion(cliente?.address)
  if (!direccion || conexionesCliente.has(direccion)) return
  const conexiones: Array<{ cliente: any; id: number }> = []

  for (const senal of ["notify::title", "notify::class", "notify::fullscreen"]) {
    try {
      conexiones.push({
        cliente,
        id: cliente.connect(senal, () => evaluarCliente(
          hypr,
          cliente,
          senal === "notify::title",
          senal === "notify::title",
        )),
      })
    } catch (_) {}
  }
  conexionesCliente.set(direccion, conexiones)
}

function registrarCliente(hypr: AstalHyprland.Hyprland, cliente: any) {
  const direccion = claveDireccion(cliente?.address)
  if (!direccion) return
  clientes.set(direccion, cliente)
  conectarCliente(hypr, cliente)
  evaluarCliente(hypr, cliente)

  if (!cliente.class && !reintentos.has(direccion)) {
    const fuente = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
      reintentos.delete(direccion)
      evaluarCliente(hypr, cliente, true)
      return GLib.SOURCE_REMOVE
    })
    reintentos.set(direccion, fuente)
  }
}

function olvidarCliente(hypr: AstalHyprland.Hyprland, direccionCruda: string) {
  const direccion = claveDireccion(direccionCruda)
  const cliente = clientes.get(direccion)
  const reintento = reintentos.get(direccion)
  if (reintento !== undefined) {
    GLib.source_remove(reintento)
    reintentos.delete(direccion)
  }
  for (const conexion of conexionesCliente.get(direccion) ?? []) {
    try { conexion.cliente.disconnect(conexion.id) } catch (_) {}
  }
  conexionesCliente.delete(direccion)
  clientes.delete(direccion)
  invalidarEvidenciaProceso(cliente?.pid)
  if (juegos.delete(direccion)) publicarJuegos()
  actualizarFoco(hypr)
  publicarRevision()
}

export function iniciarRegistroJuegos(): void {
  if (iniciado) return
  iniciado = true
  const hypr = AstalHyprland.get_default()

  for (const cliente of hypr.get_clients?.() ?? []) registrarCliente(hypr, cliente)
  publicarJuegos()
  actualizarFoco(hypr)

  hypr.connect("client-added", (_origen, cliente) => registrarCliente(hypr, cliente))
  hypr.connect("client-removed", (_origen, direccion: string) => olvidarCliente(hypr, direccion))
  hypr.connect("event", (_origen, nombre: string) => {
    if (nombre === "fullscreen") evaluarCliente(hypr, hypr.focusedClient, true)
    if (
      nombre === "fullscreen"
      || nombre === "activewindow"
      || nombre === "activewindowv2"
      || nombre === "workspace"
      || nombre === "workspacev2"
      || nombre === "focusedmon"
    ) {
      actualizarFoco(hypr)
      publicarRevision()
    }
  })
  hypr.connect("notify::focused-workspace", () => {
    actualizarFoco(hypr)
    publicarRevision()
  })
}

export function esClienteRegistradoComoJuego(cliente: any): boolean {
  const direccion = claveDireccion(cliente?.address)
  return direccion ? juegos.has(direccion) : false
}
