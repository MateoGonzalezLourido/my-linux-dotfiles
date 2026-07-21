// Orquestación de la sincronización con Google Calendar. Une el cliente HTTP, el mapeo puro y la
// fusión pura con el estado del panel.
//
// **No hay sondeo.** Se sincroniza al conectar la cuenta, al abrir el panel, al pulsar actualizar y
// después de una mutación propia. Un calendario no cambia solo cada treinta segundos, y los
// webhooks quedan fuera de alcance porque exigen un receptor HTTPS público, que unos dotfiles no
// tienen. La consecuencia aceptada es que un evento creado en el móvil aparece aquí la próxima vez
// que abras el panel, no al instante.

import { createState } from "ags"
import { cargarJsonCrudo, rutaConfig, saveJsonAsync } from "../../../servicios/almacenamiento/json.ts"
import { hoyISO, sumarDias } from "../dominio/fechas.ts"
import type { EventoCalendario } from "../dominio/tipos.ts"
import { eventos, reemplazarEventos } from "../estado.ts"
import { hayCuentaConfigurada } from "./autenticacion.ts"
import {
  actualizarEventoRemoto,
  crearEventoRemoto,
  eliminarEventoRemoto,
  listarCalendarios,
  listarEventos,
} from "./cliente.ts"
import { fusionar, mutacionesPendientes, trasSubir } from "./fusion.ts"
import { calendarioDesdeGoogle, desdeGoogle, haciaGoogle } from "./mapeo.ts"
import type { CalendarioGoogle } from "./mapeo.ts"

export type EstadoSincronizacion =
  | { fase: "sin-configurar" }
  | { fase: "sincronizando" }
  | { fase: "actualizado"; cuando: number }
  | { fase: "sin-conexion" }
  | { fase: "error"; mensaje: string }

export const [estadoSync, establecerEstadoSync] = createState<EstadoSincronizacion>(
  hayCuentaConfigurada() ? { fase: "actualizado", cuando: 0 } : { fase: "sin-configurar" },
)
export const [calendariosRemotos, establecerCalendariosRemotos] = createState<CalendarioGoogle[]>([])

/**
 * Tokens incrementales, en su propio fichero.
 *
 * Aparte de los eventos porque son estado de la conversación con Google, no datos del usuario:
 * borrar este fichero solo cuesta una sincronización completa, mientras que mezclarlo con
 * `calendario.json` haría que un token corrupto arrastrase a los eventos. Y aparte de las
 * credenciales porque este no es un secreto y no necesita 0600.
 */
const RUTA_SYNC = rutaConfig("google-calendar-sync.json")

function leerSyncTokens(): Record<string, string> {
  const crudo = cargarJsonCrudo(RUTA_SYNC, "google-calendar sync")
  if (crudo === null || typeof crudo !== "object") return {}
  const salida: Record<string, string> = {}
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    if (typeof v === "string") salida[k] = v
  }
  return salida
}

function guardarSyncTokens(tokens: Record<string, string>) {
  saveJsonAsync(RUTA_SYNC, tokens, "google-calendar sync")
}

/**
 * Exclusión mutua: una sincronización a la vez.
 *
 * Sin esto, abrir el panel mientras otra pasada sigue en vuelo lanzaría dos fusiones sobre la misma
 * lista y la segunda escribiría encima de la primera con datos de antes.
 */
let enCurso = false

/** Ventana de la primera sincronización: no tiene sentido bajarse el calendario de 2011. */
const DIAS_ATRAS = 90

export async function sincronizar(opciones: { forzarCompleta?: boolean } = {}): Promise<void> {
  if (enCurso) return
  if (!hayCuentaConfigurada()) {
    establecerEstadoSync({ fase: "sin-configurar" })
    return
  }

  enCurso = true
  establecerEstadoSync({ fase: "sincronizando" })
  try {
    // El orden importa: primero se SUBE lo pendiente y luego se baja. Al revés, la bajada marcaría
    // como conflicto lo que estaba a punto de subirse sin problema.
    await subirPendientes()

    const listado = await listarCalendarios()
    if (!listado.ok) {
      establecerEstadoSync(listado.estado === 0 ? { fase: "sin-conexion" } : { fase: "error", mensaje: `HTTP ${listado.estado}` })
      return
    }

    const calendarios: CalendarioGoogle[] = []
    for (const crudo of listado.datos?.items ?? []) {
      const cal = calendarioDesdeGoogle(crudo)
      if (cal) calendarios.push(cal)
    }
    establecerCalendariosRemotos(calendarios)

    const tokens = leerSyncTokens()
    let huboError = false

    for (const calendario of calendarios) {
      const resultado = await sincronizarCalendario(calendario, tokens, opciones.forzarCompleta === true)
      if (!resultado) huboError = true
    }

    guardarSyncTokens(tokens)
    establecerEstadoSync(
      huboError ? { fase: "error", mensaje: "sincronización parcial" } : { fase: "actualizado", cuando: Date.now() },
    )
  } catch (e) {
    console.warn("[google-calendar] sincronización fallida:", e)
    establecerEstadoSync({ fase: "error", mensaje: String(e) })
  } finally {
    enCurso = false
  }
}

async function sincronizarCalendario(
  calendario: CalendarioGoogle,
  tokens: Record<string, string>,
  forzarCompleta: boolean,
): Promise<boolean> {
  let syncToken = forzarCompleta ? undefined : tokens[calendario.id]
  let pageToken: string | undefined
  const remotos: EventoCalendario[] = []
  const eliminados: string[] = []
  const timeMin = `${sumarDias(hoyISO(), -DIAS_ATRAS)}T00:00:00Z`

  // Índice remotoId → id local, para no cambiarle el id a lo que ya conocíamos.
  const idsConocidos = new Map<string, string>()
  for (const ev of eventos.get()) {
    if (ev.remotoId && ev.calendarioId === calendario.id) idsConocidos.set(ev.remotoId, ev.id)
  }

  let vueltas = 0
  do {
    const pagina = await listarEventos(calendario.id, { syncToken, pageToken, timeMin })

    if (pagina.syncTokenCaducado) {
      // 410: Google ha tirado el token incremental. Se reconstruye con una pasada completa; no se
      // borra nada antes de tenerla, que es lo que evita quedarse con el calendario a medias.
      delete tokens[calendario.id]
      return sincronizarCalendario(calendario, tokens, true)
    }
    if (!pagina.ok) return false

    for (const crudo of pagina.datos?.items ?? []) {
      const r = desdeGoogle(crudo as any, calendario.id, calendario.permiso, (rid) => idsConocidos.get(rid))
      if (r.tipo === "evento") remotos.push(r.evento)
      else if (r.tipo === "eliminado") eliminados.push(r.remotoId)
    }

    pageToken = pagina.datos?.nextPageToken
    if (pagina.datos?.nextSyncToken) tokens[calendario.id] = pagina.datos.nextSyncToken
    // Tope de seguridad: una paginación que no termina nunca (token que no avanza) colgaría la
    // sincronización para siempre y con ella el panel.
    vueltas++
  } while (pageToken && vueltas < 40)

  const fusion = fusionar(eventos.get(), {
    remotos,
    eliminados,
    calendarioId: calendario.id,
    completa: syncToken === undefined,
  })
  reemplazarEventos(fusion.eventos)
  if (fusion.conflictos > 0) {
    console.info(`[google-calendar] ${calendario.id}: ${fusion.conflictos} conflicto(s) sin resolver`)
  }
  return true
}

/**
 * Cola offline: sube lo pendiente.
 *
 * Un fallo en una mutación **no aborta las demás ni descarta la pendiente**: se queda en cola para
 * el siguiente intento. Es lo que hace que crear un evento sin conexión funcione — se guarda local,
 * se marca, y sube cuando haya red.
 */
async function subirPendientes(): Promise<void> {
  for (const mutacion of mutacionesPendientes(eventos.get())) {
    const { evento, tipo } = mutacion
    if (evento.permiso !== "escritura") continue

    try {
      if (tipo === "eliminar") {
        if (!evento.remotoId) {
          reemplazarEventos(trasSubir(eventos.get(), evento.id, null))
          continue
        }
        const r = await eliminarEventoRemoto(evento.calendarioId, evento.remotoId)
        // Un 404 es éxito para un borrado: ya no está, que es justo lo que se pedía.
        if (r.ok || r.estado === 404) reemplazarEventos(trasSubir(eventos.get(), evento.id, null))
        continue
      }

      const cuerpo = haciaGoogle(evento)
      const r = evento.remotoId
        ? await actualizarEventoRemoto(evento.calendarioId, evento.remotoId, cuerpo)
        : await crearEventoRemoto(evento.calendarioId, cuerpo)
      if (!r.ok || !r.datos) continue

      const datos = r.datos as Record<string, unknown>
      reemplazarEventos(
        trasSubir(eventos.get(), evento.id, {
          remotoId: typeof datos.id === "string" ? datos.id : evento.remotoId,
          etag: typeof datos.etag === "string" ? datos.etag : undefined,
          actualizadoEn: typeof datos.updated === "string" ? datos.updated : undefined,
        }),
      )
    } catch (e) {
      console.warn(`[google-calendar] no se pudo subir ${evento.id}:`, e)
    }
  }
}

/** Texto del chip de la cabecera. */
export function textoEstado(estado: EstadoSincronizacion): string {
  switch (estado.fase) {
    case "sin-configurar": return "Google sin conectar"
    case "sincronizando": return "Sincronizando…"
    case "sin-conexion": return "Sin conexión"
    case "error": return `Error: ${estado.mensaje}`
    case "actualizado": return estado.cuando === 0 ? "Google conectado" : "Actualizado"
  }
}
