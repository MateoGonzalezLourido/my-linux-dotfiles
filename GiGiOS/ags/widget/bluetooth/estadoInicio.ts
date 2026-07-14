export type EstadoRestauracionBluetooth = {
  accion: boolean | null
  completada: boolean
}

export function resolverRestauracionBluetooth(
  objetivo: boolean | null,
  adaptadorDisponible: boolean,
  encendido: boolean,
): EstadoRestauracionBluetooth {
  if (objetivo === null) return { accion: null, completada: true }
  if (!adaptadorDisponible) return { accion: null, completada: false }
  if (encendido === objetivo) return { accion: null, completada: true }
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
