// Lógica pura de «Mantener despierto»: interpreta el campo de minutos y da
// formato a la cuenta atrás. El estado y los efectos viven en mantenerDespierto.ts.

/** Techo del plazo: 24 h. Para plazos mayores se puede usar «sin límite». */
export const MAXIMO_MINUTOS = 24 * 60

/** Texto del campo de minutos → minutos, o null = sin límite. */
export function interpretarMinutos(texto: string): number | null {
  const limpio = texto.trim()
  if (limpio === "" || !/^\d+$/.test(limpio)) return null
  const minutos = Number(limpio)
  if (!Number.isFinite(minutos)) return MAXIMO_MINUTOS
  if (minutos <= 0) return null
  return Math.min(minutos, MAXIMO_MINUTOS)
}

/** Normaliza lo que se enseña en el campo tras confirmar (vacío = sin límite). */
export function normalizarTextoMinutos(texto: string): string {
  const minutos = interpretarMinutos(texto)
  return minutos === null ? "" : String(minutos)
}

/**
 * Segundos restantes → texto corto para el chip del menú.
 * Menos de una hora usa M:SS; a partir de una hora usa H:MM:SS.
 */
export function formatearTiempoRestante(segundos: number): string {
  const total = Number.isFinite(segundos) ? Math.max(0, Math.ceil(segundos)) : 0
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundosRestantes = total % 60
  const dosDigitos = (numero: number) => String(numero).padStart(2, "0")
  return horas > 0
    ? `${horas}:${dosDigitos(minutos)}:${dosDigitos(segundosRestantes)}`
    : `${minutos}:${dosDigitos(segundosRestantes)}`
}

/** Texto del chip: cuenta atrás, ∞ si no hay plazo y OFF si está apagado. */
export function textoChipMantenerDespierto(
  activo: boolean,
  segundosRestantes: number | null,
): string {
  if (!activo) return "OFF"
  return segundosRestantes === null ? "∞" : formatearTiempoRestante(segundosRestantes)
}

/** Tooltip del icono de la barra. */
export function textoTooltipMantenerDespierto(
  segundosRestantes: number | null,
  mantenerPantalla: boolean,
): string {
  const cabecera = segundosRestantes === null
    ? "Wake up · sin límite"
    : `Wake up · ${formatearTiempoRestante(segundosRestantes)} restantes`
  return mantenerPantalla
    ? `${cabecera}\nLa pantalla tampoco se apaga`
    : `${cabecera}\nLa pantalla se apaga y bloquea con normalidad`
}
