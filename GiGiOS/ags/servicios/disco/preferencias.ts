// servicios/disco/preferencias.ts — configuración de la autolimpieza.
//
// Se persiste en su PROPIO fichero, `~/.config/gigios/almacenamiento.json`, y no en
// `preferences.json`, por la misma razón que `security.json`: **lo lee un script bash**
// (`hypr/scripts/limpieza-arranque.sh` y `limpiar-almacenamiento.sh`, con `jq`). Un fichero
// compartido con las preferencias del shell obligaría a esos scripts a conocer claves que no les
// incumben, y a este módulo a no pisar las que escribe otro.
//
// A DIFERENCIA de `security.json` —que `oom-monitor.sh` lee UNA vez al arrancar—, aquí no hay nada
// cacheado en ningún proceso: `limpieza-arranque.sh` no es un daemon, así que cada ejecución suya
// parte de leer este fichero. Guardar es toda la sincronización que existe; no hay ningún vigilante
// al que avisar ni que relanzar.
import GLib from "gi://GLib"
import { createState } from "ags"
import { execAsync } from "ags/process"
import { ACCIONES_AUTOMATIZABLES, type IdAccion } from "./catalogo"

const RUTA = `${GLib.get_user_config_dir()}/gigios/almacenamiento.json`
const ARRANQUE = `${GLib.get_user_config_dir()}/hypr/scripts/limpieza-arranque.sh`
const VERSION = 1

/** Retención del journal por defecto. Cabe en cualquier disco y conserva varios días de arranques. */
const RETENCION_DEFECTO = "200M"

export const [autoLimpieza, _setAutoLimpieza] = createState(false)
export const [intervaloHoras, _setIntervaloHoras] = createState(24)
export const [umbralUso, _setUmbralUso] = createState(0)
export const [retenerJournal, _setRetenerJournal] = createState(RETENCION_DEFECTO)
export const [diasPapelera, _setDiasPapelera] = createState(0)
export const [diasDescargas, _setDiasDescargas] = createState(0)
export const [notificarLimpieza, _setNotificarLimpieza] = createState(true)

// Una sola fuente para las casillas: cada acción automatizable tiene su estado. Todas nacen
// APAGADAS. Es lo contrario del criterio de `security.json` (todo ON) y es deliberado: allí los
// defaults solo deciden si algo se vigila, aquí deciden si algo se borra sin preguntar.
const acciones = {} as Record<IdAccion, ReturnType<typeof createState<boolean>>>
for (const id of ACCIONES_AUTOMATIZABLES) acciones[id] = createState(false)

export function accionAutomatica(id: IdAccion) {
  return acciones[id][0]
}

/** Las acciones marcadas ahora mismo. Es lo que usa la estimación de espacio liberable. */
export function accionesActivas(): IdAccion[] {
  return ACCIONES_AUTOMATIZABLES.filter(id => acciones[id][0].get())
}

function cargar(): void {
  try {
    const [ok, contenido] = GLib.file_get_contents(RUTA)
    if (!ok) return
    const guardado = JSON.parse(new TextDecoder().decode(contenido))
    if (typeof guardado.auto === "boolean") _setAutoLimpieza(guardado.auto)
    if (Number.isFinite(guardado.intervaloHoras) && guardado.intervaloHoras > 0) _setIntervaloHoras(guardado.intervaloHoras)
    if (Number.isFinite(guardado.umbralUso) && guardado.umbralUso >= 0 && guardado.umbralUso <= 100) _setUmbralUso(guardado.umbralUso)
    if (typeof guardado.retenerJournal === "string" && /^\d+[KMG]$/.test(guardado.retenerJournal)) _setRetenerJournal(guardado.retenerJournal)
    if (Number.isFinite(guardado.diasPapelera) && guardado.diasPapelera >= 0) _setDiasPapelera(guardado.diasPapelera)
    if (Number.isFinite(guardado.diasDescargas) && guardado.diasDescargas >= 0) _setDiasDescargas(guardado.diasDescargas)
    if (typeof guardado.notificar === "boolean") _setNotificarLimpieza(guardado.notificar)
    const marcadas = guardado.acciones
    if (marcadas && typeof marcadas === "object") {
      for (const id of ACCIONES_AUTOMATIZABLES) {
        if (typeof marcadas[id] === "boolean") acciones[id][1](marcadas[id])
      }
    }
  } catch (_) {
    /* ausente o corrupto → defaults, o sea autolimpieza apagada */
  }
}

function guardar(): void {
  try {
    const dir = GLib.path_get_dirname(RUTA)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    const marcadas: Record<string, boolean> = {}
    for (const id of ACCIONES_AUTOMATIZABLES) marcadas[id] = acciones[id][0].get()
    GLib.file_set_contents(RUTA, JSON.stringify({
      version: VERSION,
      auto: autoLimpieza.get(),
      intervaloHoras: intervaloHoras.get(),
      umbralUso: umbralUso.get(),
      retenerJournal: retenerJournal.get(),
      diasPapelera: diasPapelera.get(),
      diasDescargas: diasDescargas.get(),
      notificar: notificarLimpieza.get(),
      acciones: marcadas,
    }, null, 2))
  } catch (_) {
    /* un fallo de escritura no debe romper la UI */
  }
}

/**
 * NO hay nada que arrancar ni que matar al tocar el interruptor, y eso es la consecuencia visible
 * de que la autolimpieza dejara de ser un daemon.
 *
 * Antes esto hacía `pkill -f limpieza-monitor.sh` + relanzar, como los interruptores de
 * `screencast-monitor` y `updates-monitor`, porque había un bucle durmiendo una hora entre pasadas.
 * Hoy `limpieza-arranque.sh` corre una vez al iniciar sesión, lee el JSON y se muere: apagar la
 * opción es simplemente escribir `auto: false`, que es lo que leerá el siguiente arranque. Guardar
 * es toda la sincronización que hace falta.
 */
export function setAutoLimpieza(valor: boolean): void {
  _setAutoLimpieza(valor)
  guardar()
}

export function setAccionAutomatica(id: IdAccion, valor: boolean): void {
  acciones[id][1](valor)
  guardar()
}

export function setIntervaloHoras(valor: number): void {
  if (!Number.isFinite(valor) || valor <= 0) return
  _setIntervaloHoras(Math.round(valor))
  guardar()
}

export function setUmbralUso(valor: number): void {
  if (!Number.isFinite(valor) || valor < 0 || valor > 100) return
  _setUmbralUso(Math.round(valor))
  guardar()
}

/** Solo acepta el formato de systemd; el helper root lo vuelve a validar por su cuenta. */
export function setRetenerJournal(valor: string): void {
  const limpio = valor.trim().toUpperCase()
  if (!/^\d+[KMG]$/.test(limpio)) return
  _setRetenerJournal(limpio)
  guardar()
}

export function setDiasPapelera(valor: number): void {
  if (!Number.isFinite(valor) || valor < 0) return
  _setDiasPapelera(Math.round(valor))
  guardar()
}

export function setDiasDescargas(valor: number): void {
  if (!Number.isFinite(valor) || valor < 0) return
  _setDiasDescargas(Math.round(valor))
  guardar()
}

export function setNotificarLimpieza(valor: boolean): void {
  _setNotificarLimpieza(valor)
  guardar()
}

/**
 * Limpia ya, saltándose intervalo y umbral. Es lo que cubre el caso que perdió la sesión al dejar
 * de haber comprobación periódica: un equipo encendido varios días sin volver a iniciar sesión.
 */
export function limpiarAhora(): Promise<string> {
  return execAsync([ARRANQUE, "--ahora"])
}

cargar()
