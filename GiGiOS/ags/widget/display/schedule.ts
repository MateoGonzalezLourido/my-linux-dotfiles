// Lógica pura de la programación horaria de la luz nocturna (SIN GTK/GLib).

export interface NightSchedule {
  enabled: boolean
  start: string  // "HH:MM"
  end: string    // "HH:MM"
}

export function parseHM(hm: string): number {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  return Number(m[1]) * 60 + Number(m[2])
}

// ¿La hora `now` cae dentro de la ventana [start, end)? Soporta ventanas que
// cruzan medianoche (start > end). Fin exclusivo.
export function isWithinSchedule(now: { h: number; m: number }, s: NightSchedule): boolean {
  if (!s.enabled) return false
  const cur = now.h * 60 + now.m
  const start = parseHM(s.start)
  const end = parseHM(s.end)
  if (start === end) return false
  if (start < end) return cur >= start && cur < end
  return cur >= start || cur < end   // cruza medianoche
}

// Una regla de luz nocturna: a partir de `time` (HH:MM) se aplica `temp` (K) hasta
// la siguiente regla del día.
export interface NightRule { time: string; temp: number }

// Regla activa ahora mismo: la de mayor hora que ya haya pasado. Si ninguna ha
// pasado aún hoy, se envuelve a la última del día (la de ayer sigue vigente).
export function activeRule(now: { h: number; m: number }, rules: NightRule[]): NightRule | null {
  if (rules.length === 0) return null
  const nowM = now.h * 60 + now.m
  const sorted = rules.map(r => ({ r, m: parseHM(r.time) })).sort((a, b) => a.m - b.m)
  let pick: NightRule | null = null
  for (const x of sorted) { if (x.m <= nowM) pick = x.r }
  if (!pick) pick = sorted[sorted.length - 1].r   // envuelve a la última del día
  return pick
}
