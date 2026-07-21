export type EstadoRestauracionBluetooth = {
  accion: boolean | null
  completada: boolean
}

/**
 * @param asentado `true` cuando al adaptador ya se le ha dado tiempo a estabilizarse.
 *
 * BlueZ enciende el controlador él solo en cuanto lo encuentra (`AutoEnable`, activado
 * por defecto en `/etc/bluetooth/main.conf`) y lo hace DESPUÉS de registrar el adaptador.
 * Queda pues una ventana en la que el adaptador ya existe y todavía está apagado: si ahí
 * damos la restauración por terminada solo porque el estado coincide con el objetivo, el
 * power-on de BlueZ llega justo después, nadie lo corrige, y `guardarEstadoSistema` lo
 * adopta como si lo hubiera pedido el usuario — reescribiendo `bluetooth: true` y
 * borrando su "apagado" para siempre. Por eso "coincide" NO basta para cerrar: hace falta
 * además que el adaptador se haya asentado. Mientras no lo esté no se actúa (no se pelea
 * con nada), pero la restauración sigue viva y corrige cualquier encendido que llegue.
 */
export function resolverRestauracionBluetooth(
  objetivo: boolean | null,
  adaptadorDisponible: boolean,
  encendido: boolean,
  asentado: boolean,
): EstadoRestauracionBluetooth {
  if (objetivo === null) return { accion: null, completada: true }
  if (!adaptadorDisponible) return { accion: null, completada: false }
  if (encendido === objetivo) return { accion: null, completada: asentado }
  return { accion: objetivo, completada: false }
}

export function valorBluetoothParaGuardar(
  objetivo: boolean | null,
  restauracionCompletada: boolean,
  adaptadorDisponible: boolean,
  encendido: boolean,
): boolean | null {
  if (objetivo !== null && (!restauracionCompletada || !adaptadorDisponible)) return objetivo
  return adaptadorDisponible ? encendido : null
}
