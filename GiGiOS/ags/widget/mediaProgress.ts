const MPRIS_MICROSECONDS_PER_SECOND = 1_000_000

function positiveNumber(value: unknown): number | null {
  try {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
  } catch (_) {
    return null
  }
}

/**
 * Astal exposes Player.length in seconds, while the raw MPRIS mpris:length
 * metadata (and playerctl's value for it) is expressed in microseconds.
 */
export function resolveMediaLengthSeconds(
  astalSeconds: unknown,
  mprisMicroseconds: unknown,
): number | null {
  const length = positiveNumber(astalSeconds)
  if (length !== null) return length

  const rawLength = positiveNumber(mprisMicroseconds)
  return rawLength === null ? null : rawLength / MPRIS_MICROSECONDS_PER_SECOND
}

export function safeMediaPosition(position: unknown, length: number): number {
  const value = Number(position)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, length)
}
