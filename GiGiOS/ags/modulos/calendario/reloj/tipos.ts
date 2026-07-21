// Modelo del reloj: alarmas, temporizador y cronómetro. Puro.
//
// **Solo las alarmas se persisten.** El temporizador y el cronómetro son estado de sesión y se
// reinician con AGS, porque lo que miden es una intención del momento («avísame en 10 minutos») que
// no sobrevive a un reinicio del shell — restaurar un temporizador de hace tres horas sería avisar
// de algo que ya no interesa a nadie.

/** Lunes = 0 … domingo = 6, igual que en `dominio/fechas.ts`. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6

interface AlarmaBase {
  id: string
  etiqueta: string
  /** `"HH:MM"` en hora local. */
  hora: string
  activa: boolean
  /** `sound-name` estándar que se le pide al sistema de notificaciones. */
  sonido?: string
}

/**
 * Alarma de una sola vez, atada a una fecha concreta.
 *
 * La fecha es imprescindible: sin ella, «suena a las 7:00» no distingue mañana de dentro de una
 * semana, y al arrancar no habría forma de saber si ya venció.
 */
export interface AlarmaPuntual extends AlarmaBase {
  tipo: "puntual"
  /** `"YYYY-MM-DD"`. */
  fecha: string
}

export interface AlarmaSemanal extends AlarmaBase {
  tipo: "semanal"
  /** Días en los que suena. Vacío = no sonará nunca (el planificador lo trata como inactiva). */
  dias: DiaSemana[]
}

export type Alarma = AlarmaPuntual | AlarmaSemanal

export const VERSION_RELOJ = 1

export interface ArchivoReloj {
  version: number
  alarmas: Alarma[]
}

export function archivoRelojVacio(): ArchivoReloj {
  return { version: VERSION_RELOJ, alarmas: [] }
}

// ── Temporizador ─────────────────────────────────────────────────────────────

export type EstadoTemporizador = "parado" | "corriendo" | "pausado"

export interface Temporizador {
  estado: EstadoTemporizador
  /** Duración configurada, en ms. */
  duracionMs: number
  /**
   * Instante absoluto de vencimiento (epoch ms) mientras corre.
   *
   * Es un instante y no un contador por el mismo motivo que el `until` de `wakeup.json`: los
   * temporizadores de GLib no corren mientras el equipo está suspendido, así que un contador se
   * desfasaría en cada suspensión. Contra el reloj de pared, volver de suspender simplemente
   * descubre que ya venció.
   */
  venceEn: number | null
  /** Restante congelado mientras está en pausa, en ms. */
  restanteMs: number
}

export function temporizadorInicial(duracionMs = 5 * 60_000): Temporizador {
  return { estado: "parado", duracionMs, venceEn: null, restanteMs: duracionMs }
}

// ── Cronómetro ───────────────────────────────────────────────────────────────

export type EstadoCronometro = "parado" | "corriendo" | "pausado"

export interface Cronometro {
  estado: EstadoCronometro
  /** Epoch ms del último arranque, o `null` si no corre. */
  desde: number | null
  /** Milisegundos acumulados en los tramos anteriores. */
  acumuladoMs: number
}

export function cronometroInicial(): Cronometro {
  return { estado: "parado", desde: null, acumuladoMs: 0 }
}
