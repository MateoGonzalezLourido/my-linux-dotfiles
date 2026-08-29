export interface AccionEnergia {
  /** Identificador estable de la acción: es también su clase CSS y la clave con la
   *  que se guarda en `preferences.json`. No renombrar sin migrar la preferencia. */
  claseCss: string
  icono: string
  etiqueta: string
  comando: string
}

export const ACCIONES_ENERGIA: readonly AccionEnergia[] = [
  { claseCss: "lock", icono: "󰌾", etiqueta: "Bloquear", comando: "hyprlock" },
  // Forma Lua del dispatcher (bajo config Lua la sintaxis legacy `dispatch exit`
  // no existe). Las comillas sobreviven: execAsync con string parsea con
  // GLib.shell_parse_argv, así que llega como un solo argumento.
  { claseCss: "logout", icono: "󰍃", etiqueta: "Salir", comando: 'hyprctl dispatch "hl.dsp.exit()"' },
  { claseCss: "suspend", icono: "󰏤", etiqueta: "Suspender", comando: "systemctl suspend" },
  { claseCss: "shutdown", icono: "󰐥", etiqueta: "Apagar", comando: "systemctl poweroff" },
  { claseCss: "hibernate", icono: "󰒲", etiqueta: "Hibernar", comando: "systemctl hibernate" },
  { claseCss: "reboot", icono: "󰜉", etiqueta: "Reiniciar", comando: "systemctl reboot" },
]

/** Ids conocidos, en el orden en que se pintan. */
export const IDS_ACCIONES_ENERGIA: readonly string[] = ACCIONES_ENERGIA.map((a) => a.claseCss)

/**
 * Limpia la lista de acciones ocultas que llega de `preferences.json`: descarta lo que
 * no sea un id conocido, quita duplicados y **garantiza que al menos una acción siga
 * visible**. Sin ese tope, ocultarlas todas dejaría un menú de energía vacío desde el
 * que ya no se puede ni bloquear ni apagar, y el único camino de vuelta sería editar
 * el JSON a mano.
 *
 * Cuando la lista pide ocultarlas todas se conserva la primera del orden de
 * `ACCIONES_ENERGIA` (no la primera de la lista recibida) para que el resultado sea el
 * mismo lea quien lea el fichero.
 */
export function normalizarAccionesOcultas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const ocultas = IDS_ACCIONES_ENERGIA.filter((id) => valor.includes(id))
  if (ocultas.length < IDS_ACCIONES_ENERGIA.length) return ocultas
  return ocultas.slice(1)
}

/** Acciones que se pintan en el menú, respetando el orden de `ACCIONES_ENERGIA`. */
export function accionesVisibles(ocultas: readonly string[]): AccionEnergia[] {
  const fuera = normalizarAccionesOcultas([...ocultas])
  return ACCIONES_ENERGIA.filter((accion) => !fuera.includes(accion.claseCss))
}
