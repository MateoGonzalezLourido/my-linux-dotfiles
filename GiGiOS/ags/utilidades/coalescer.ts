import GLib from "gi://GLib"

/**
 * Colapsa en UNA sola ejecución todas las peticiones de reconstrucción de un mismo turno.
 *
 * **Existe porque `gnim` no agrupa notificaciones.** Cada `set` de un estado llama a sus
 * suscriptores de forma síncrona, uno a uno (`jsx/state.ts`), así que un widget suscrito a un
 * estado *y* a un derivado de ese estado se reconstruye dos veces por cambio — y tres si el
 * llamante toca dos estados seguidos, como hace `seleccionarFecha()` sobre un día de relleno.
 * Con la cuadrícula del mes eso eran hasta tres reconstrucciones de 42 botones, en cada monitor,
 * por un solo clic.
 *
 * Peor que el coste: la **primera** de esas pasadas lee el derivado todavía sin invalidar (el
 * `createComputed` de gnim invalida su caché en el mismo recorrido de suscriptores en el que
 * avisa), o sea que pinta los datos del mes anterior y los tira en el mismo turno. Al colapsar,
 * la única pasada que queda ocurre ya con todo asentado.
 *
 * El retraso es un `idle` de baja prioridad, no un temporizador: no hay reloj nuevo, la
 * reconstrucción entra cuando el bucle principal se queda sin trabajo del frame en curso.
 */
export function crearReconstruccionCoalescida(reconstruir: () => void) {
  let pendiente: number | null = null

  function cancelar(): void {
    if (pendiente !== null) {
      GLib.source_remove(pendiente)
      pendiente = null
    }
  }

  /** Pide una reconstrucción. Llamarla N veces en el mismo turno ejecuta `reconstruir` una vez. */
  function programar(): void {
    if (pendiente !== null) return
    pendiente = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      pendiente = null
      reconstruir()
      return GLib.SOURCE_REMOVE
    })
  }

  /**
   * Reconstruye ya, descartando lo que hubiera pendiente. Para el primer pintado: el widget tiene
   * que devolverse con contenido, no vacío a la espera de un idle.
   */
  function ahora(): void {
    cancelar()
    reconstruir()
  }

  return { programar, ahora, cancelar }
}
