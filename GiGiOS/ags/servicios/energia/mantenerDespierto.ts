// Mantiene el equipo despierto durante el plazo solicitado. El JSON usa el
// contrato que consume hypr/scripts/idle-action.sh y no es persistencia de UI.

import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { createState } from "ags"
import { reiniciarHypridle } from "../pantalla/reinicioHypridle"
import { interpretarMinutos, normalizarTextoMinutos } from "./tiempoMantenerDespierto"

const RUTA_ESTADO = `${GLib.get_user_config_dir()}/gigios/wakeup.json`
const instanteActual = () => Math.floor(Date.now() / 1000)

export const [mantenerDespiertoActivo, establecerMantenerDespiertoActivo] = createState(false)
export const [mantenerPantallaActiva, establecerMantenerPantallaActiva] = createState(false)
export const [minutosMantenerDespierto, establecerMinutosMantenerDespierto] = createState("")
/** Segundos restantes, o null cuando no existe límite. */
export const [tiempoRestanteMantenerDespierto, establecerTiempoRestanteMantenerDespierto] =
  createState<number | null>(null)

let instanteLimite: number | null = null
let temporizador: number | null = null

function obtenerPidPropio(): number {
  try {
    return new Gio.Credentials().get_unix_pid()
  } catch (error) {
    console.error("[mantener-despierto] no se pudo obtener el pid:", error)
    return 0
  }
}

function escribirEstado(activo: boolean) {
  try {
    const directorio = GLib.path_get_dirname(RUTA_ESTADO)
    if (!GLib.file_test(directorio, GLib.FileTest.EXISTS)) {
      GLib.mkdir_with_parents(directorio, 0o755)
    }
    GLib.file_set_contents(RUTA_ESTADO, JSON.stringify({
      active: activo,
      until: activo ? instanteLimite : null,
      screen: mantenerPantallaActiva.get(),
      pid: obtenerPidPropio(),
    }))
  } catch (error) {
    console.error("[mantener-despierto] no se pudo escribir el estado:", error)
  }
}

function detenerTemporizador() {
  if (temporizador === null) return
  try { GLib.source_remove(temporizador) } catch (_) {}
  temporizador = null
}

function iniciarTemporizador() {
  detenerTemporizador()
  if (instanteLimite === null) return
  temporizador = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
    const restante = instanteLimite === null ? null : instanteLimite - instanteActual()
    if (restante === null) {
      temporizador = null
      return GLib.SOURCE_REMOVE
    }
    if (restante <= 0) {
      temporizador = null
      fijarMantenerDespiertoActivo(false)
      return GLib.SOURCE_REMOVE
    }
    establecerTiempoRestanteMantenerDespierto(restante)
    return GLib.SOURCE_CONTINUE
  })
}

function programarCaducidad() {
  const minutos = interpretarMinutos(minutosMantenerDespierto.get())
  instanteLimite = minutos === null ? null : instanteActual() + minutos * 60
  establecerTiempoRestanteMantenerDespierto(
    instanteLimite === null ? null : instanteLimite - instanteActual(),
  )
  escribirEstado(true)
  iniciarTemporizador()
}

export function fijarMantenerDespiertoActivo(activo: boolean) {
  if (activo) {
    establecerMantenerDespiertoActivo(true)
    programarCaducidad()
    return
  }
  if (!mantenerDespiertoActivo.get()) return
  establecerMantenerDespiertoActivo(false)
  instanteLimite = null
  establecerTiempoRestanteMantenerDespierto(null)
  detenerTemporizador()
  escribirEstado(false)
  reiniciarHypridle().catch(() => {})
}

/** Cambiar los minutos en activo reprograma la cuenta atrás inmediatamente. */
export function fijarMinutosMantenerDespierto(texto: string) {
  establecerMinutosMantenerDespierto(normalizarTextoMinutos(texto))
  if (mantenerDespiertoActivo.get()) programarCaducidad()
}

/** Publica en caliente si también debe mantenerse encendida la pantalla. */
export function fijarMantenerPantallaActiva(activa: boolean) {
  establecerMantenerPantallaActiva(activa)
  if (mantenerDespiertoActivo.get()) escribirEstado(true)
}

/** Limpia al iniciar cualquier veto heredado de otra sesión de AGS. */
export function inicializarMantenerDespierto(): void {
  escribirEstado(false)
}
