// Lógica pura del Wake up: interpretar el campo de minutos y dar formato a la
// cuenta atrás. SIN imports GTK/GLib (corre bajo `node --test`). El estado y los
// efectos (escribir wakeup.json, reiniciar hypridle) viven en wakeup.ts.

/** Techo del plazo: 24 h. Un Wake up más largo que eso es "sin límite" con pasos extra. */
export const MAX_MINUTES = 24 * 60

/**
 * Texto del campo de minutos → minutos, o null = SIN LÍMITE.
 *
 * El campo vacío es la forma documentada de pedir "indefinido", así que "" → null.
 * Lo que no sea un número positivo cae también en null en vez de reventar: el campo
 * ya está restringido a dígitos (Gtk.InputPurpose.DIGITS), de modo que aquí solo
 * llegan casos límite como "0", "  " o un pegado raro. Cero minutos tampoco es un
 * plazo: pedir "0" y que el Wake up se apagara al instante sería una función que no
 * hace nada, así que se lee como "sin límite".
 */
export function parseMinutes(text: string): number | null {
  const t = text.trim()
  if (t === "") return null
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(n, MAX_MINUTES)
}

/** Normaliza lo que se enseña en el campo tras confirmar (vacío = sin límite). */
export function normalizeMinutesText(text: string): string {
  const m = parseMinutes(text)
  return m === null ? "" : String(m)
}

/**
 * Segundos restantes → texto corto para el chip del menú.
 * < 1 h → "M:SS" (29:59) · >= 1 h → "H:MM:SS" (1:05:00).
 * Se redondea hacia arriba para que un plazo de 30 min enseñe "30:00" al pulsar y
 * no "29:59" (el primer tick llega un instante después de armarlo).
 */
export function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

/** Texto del chip de la fila: cuenta atrás, ∞ si no hay plazo, OFF si está apagado. */
export function chipText(active: boolean, remaining: number | null): string {
  if (!active) return "OFF"
  return remaining === null ? "∞" : formatRemaining(remaining)
}

/** Tooltip del icono de la barra. */
export function tooltipText(remaining: number | null, screen: boolean): string {
  const head = remaining === null
    ? "Wake up · sin límite"
    : `Wake up · ${formatRemaining(remaining)} restantes`
  return screen
    ? `${head}\nLa pantalla tampoco se apaga`
    : `${head}\nLa pantalla se apaga y bloquea con normalidad`
}
