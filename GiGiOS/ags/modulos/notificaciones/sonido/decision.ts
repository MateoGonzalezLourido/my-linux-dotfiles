// ¿Debe sonar esta notificación? Lógica pura, sin GTK ni procesos.
//
// **La decisión vive fuera del calendario a propósito.** Las alarmas y el temporizador no
// reproducen nada por su cuenta: emiten una notificación normal con los campos de sonido estándar y
// el subsistema de notificaciones decide. Así el No molestar, las reglas del usuario y el silencio
// por app se aplican a las alarmas sin escribir una línea más, y cualquier función futura que quiera
// sonar hereda el mismo contrato en vez de inventarse el suyo.
//
// Los tres campos son los del spec de escritorio de freedesktop, que AstalNotifd ya expone como
// hints: `sound-name` (nombre del tema de sonidos, p. ej. `alarm-clock-elapsed`), `sound-file`
// (ruta absoluta) y `suppress-sound` (el emisor pide explícitamente silencio).

export interface EntradaSonido {
  /** Hint `sound-name`. */
  soundName?: string
  /** Hint `sound-file`, ruta absoluta. */
  soundFile?: string
  /** Hint `suppress-sound`: quien la envía pide que no suene. */
  suppressSound?: boolean
  /** No molestar activo en el daemon. */
  noMolestar: boolean
  /** `meta.muteAudio`, calculado por el motor de reglas. */
  muteAudio: boolean
  /** Urgencia D-Bus: 0 baja, 1 normal, 2 crítica. */
  urgencia?: number
}

export type MotivoSilencio = "sin-sonido" | "suppress-sound" | "no-molestar" | "regla"

export type DecisionSonido =
  | { reproducir: true; tipo: "archivo"; recurso: string }
  | { reproducir: true; tipo: "tema"; recurso: string }
  | { reproducir: false; motivo: MotivoSilencio }

/**
 * Decide si suena y con qué.
 *
 * El orden de las guardas importa y no es arbitrario:
 *
 * 1. **Nadie ha pedido sonido → silencio.** Es la puerta más importante: sin ella, activar el audio
 *    convertiría en sonora *toda* notificación del sistema, cuando la intención es que solo suenen
 *    las que lo piden. No hay sonido por defecto.
 * 2. **`suppress-sound` gana a todo lo demás.** Lo pone quien emite, que es quien sabe si ya ha
 *    sonado por otro canal (típico de los reproductores de música).
 * 3. **No molestar**, y después las **reglas** (`muteAudio`). Las dos silencian; se distinguen solo
 *    para poder explicarlo en las pruebas y en los logs.
 *
 * Una crítica **no** se salta el No molestar. Aquí sí sería tentador —«esto es importante»— pero el
 * usuario que activa No molestar está pidiendo silencio, y la notificación sigue viéndose.
 */
export function decidirSonido(entrada: EntradaSonido): DecisionSonido {
  const archivo = entrada.soundFile?.trim()
  const tema = entrada.soundName?.trim()
  if (!archivo && !tema) return { reproducir: false, motivo: "sin-sonido" }

  if (entrada.suppressSound) return { reproducir: false, motivo: "suppress-sound" }
  if (entrada.noMolestar) return { reproducir: false, motivo: "no-molestar" }
  if (entrada.muteAudio) return { reproducir: false, motivo: "regla" }

  // El fichero manda sobre el nombre de tema: es más específico y no depende de que el tema de
  // sonidos instalado tenga esa entrada.
  if (archivo) return { reproducir: true, tipo: "archivo", recurso: archivo }
  return { reproducir: true, tipo: "tema", recurso: tema! }
}

/** Nombre de tema estándar para las alertas del reloj. Existe en el tema freedesktop. */
export const SONIDO_ALARMA = "alarm-clock-elapsed"

/** Nombre de tema para el fin del temporizador. */
export const SONIDO_TEMPORIZADOR = "complete"

/**
 * Comando de reproducción como **array de argumentos**, nunca una cadena para `sh -c`.
 *
 * El nombre del sonido y la ruta pueden venir de una notificación ajena —cualquier proceso de la
 * sesión puede mandar hints—, así que pasar por un shell convertiría un `sound-file` malicioso en
 * ejecución de comandos. Con argv no hay nada que interpretar.
 *
 * `null` = no hay reproductor utilizable.
 */
export function comandoReproduccion(
  decision: DecisionSonido,
  disponible: (programa: string) => boolean,
): string[] | null {
  if (!decision.reproducir) return null

  if (decision.tipo === "tema") {
    // Solo canberra entiende nombres de tema: resuelve el `.oga` según el tema instalado y el
    // idioma. Sin él, un `sound-name` no se puede reproducir — y eso es correcto, no un fallo que
    // haya que suplir adivinando rutas.
    return disponible("canberra-gtk-play") ? ["canberra-gtk-play", "-i", decision.recurso] : null
  }

  for (const programa of ["canberra-gtk-play", "pw-play", "paplay"]) {
    if (!disponible(programa)) continue
    return programa === "canberra-gtk-play"
      ? ["canberra-gtk-play", "-f", decision.recurso]
      : [programa, decision.recurso]
  }
  return null
}
