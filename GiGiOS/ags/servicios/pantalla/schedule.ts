// Lógica pura de la programación horaria de pantalla (SIN GTK/GLib).

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

// ¿La hora `now` cae dentro de la ventana [start, end)? Soporta ventanas que cruzan
// medianoche (start > end). Fin exclusivo. start === end ⇒ ventana vacía (nunca).
export function isWithinWindow(now: { h: number; m: number }, start: string, end: string): boolean {
  const cur = now.h * 60 + now.m
  const s = parseHM(start)
  const e = parseHM(end)
  if (s === e) return false
  if (s < e) return cur >= s && cur < e
  return cur >= s || cur < e   // cruza medianoche
}

export function isWithinSchedule(now: { h: number; m: number }, s: NightSchedule): boolean {
  return s.enabled && isWithinWindow(now, s.start, s.end)
}

// Una regla es una FRANJA [start, end) y lo que hace en ella con DOS canales
// independientes. Fuera de su franja no existe: no arrastra su valor ni "hasta que otra
// regla lo cambie" (ese era el modelo anterior, de puntos de cambio encadenados, y hacía
// que una sola regla de las 22:00 rigiera también a las 19:00 — envolvía a la de ayer).
//
//   temp:       null = no toca la luz nocturna · >0 = K mientras dure la franja
//   brightness: null = no toca el brillo       · 1..100 = % al entrar en la franja
//
// Fuera de toda franja, cada canal vuelve a su dueño natural: la luz nocturna, al
// interruptor manual; el brillo, al valor que tenía antes de entrar (lo restaura el
// servicio, ver `service.ts`).
export type Channel = "temp" | "brightness"
export interface NightRule { start: string; end: string; temp: number | null; brightness?: number | null }

// Regla que rige un canal AHORA: de las que están dentro de su franja y hablan de ese
// canal, la que arrancó más recientemente (contando la vuelta de medianoche); a igualdad,
// la última de la lista. Así, si dos franjas se solapan, gana la que acaba de empezar.
export function activeRuleFor(now: { h: number; m: number }, rules: NightRule[], channel: Channel): NightRule | null {
  const cur = now.h * 60 + now.m
  let best: NightRule | null = null
  let bestAge = Infinity
  rules.forEach((r) => {
    if (r[channel] == null) return
    if (!isWithinWindow(now, r.start, r.end)) return
    const age = (cur - parseHM(r.start) + 1440) % 1440   // minutos desde que empezó
    if (age <= bestAge) { best = r; bestAge = age }      // <= : a igualdad gana la última
  })
  return best
}

// Valor vigente de un canal, o null si ninguna franja lo programa ahora mismo.
export function activeSetpoint(now: { h: number; m: number }, rules: NightRule[], channel: Channel): number | null {
  const r = activeRuleFor(now, rules, channel)
  return r ? (r[channel] as number) : null
}

// Saneado de lo que venga del JSON: un valor basura (string, NaN, fuera de rango) llegaría
// hasta el hardware. Migra además el formato viejo de puntos de cambio (`{time, temp}`,
// encadenados hasta la siguiente regla) a franjas: cada regla se extiende hasta la hora de
// la siguiente (envolviendo al día siguiente), y las que solo servían de terminador
// ("apagar desde esa hora", temp 0 y sin brillo) desaparecen: en el modelo de franjas, no
// programar nada YA significa que manda el manual.
export function normalizeRules(raw: unknown): NightRule[] {
  if (!Array.isArray(raw)) return []
  const hm = (v: unknown): string | null => {
    const s = String(v ?? "")
    return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : null
  }
  const num = (v: unknown, lo: number, hi: number): number | null => {
    const n = typeof v === "number" ? v : Number(v)
    if (v == null || v === "" || !Number.isFinite(n)) return null
    const c = Math.max(lo, Math.min(hi, Math.round(n)))
    return c
  }
  const temp = (v: unknown): number | null => (v == null || v === 0 ? null : num(v, 1000, 6500))
  const bright = (v: unknown): number | null => num(v, 1, 100)

  const items = raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")

  // ¿Formato viejo? (sin `end`, con `time`). Se migra la lista entera de golpe.
  const legacy = items.filter(r => r.end == null && r.time != null)
  if (legacy.length === items.length && items.length > 0) {
    const sorted = legacy
      .map(r => ({ at: hm(r.time), temp: temp(r.temp), brightness: bright(r.brightness) }))
      .filter((r): r is { at: string; temp: number | null; brightness: number | null } => r.at !== null)
      .sort((a, b) => parseHM(a.at) - parseHM(b.at))
    const out: NightRule[] = []
    sorted.forEach((r, i) => {
      if (r.temp == null && r.brightness == null) return   // era solo un terminador
      const next = sorted[(i + 1) % sorted.length]
      const end = sorted.length > 1 ? next.at : r.at       // regla única: no hay dónde acabar
      if (end === r.at) return                             // franja vacía: se descarta
      out.push({ start: r.at, end, temp: r.temp, brightness: r.brightness })
    })
    return out
  }

  const out: NightRule[] = []
  for (const r of items) {
    const start = hm(r.start)
    const end = hm(r.end)
    if (!start || !end) continue
    out.push({ start, end, temp: temp(r.temp), brightness: bright(r.brightness) })
  }
  return out
}
