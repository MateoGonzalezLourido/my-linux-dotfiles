// Reproducción de los sonidos de notificación. Es la única pieza con efectos del subsistema de
// audio de notificaciones; la decisión de si suena vive en `decision.ts`, que es puro y probado.
//
// **Falla en silencio a propósito.** Sin `canberra-gtk-play`, sin el fichero o con el sonido ausente
// del tema, no se notifica el error: una notificación que no suena es un inconveniente, pero una
// notificación de error *sobre* una notificación que no suena es un bucle de ruido. El fallo queda
// en el log y nada más.

import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import { comandoReproduccion, decidirSonido } from "./decision.ts"
import type { EntradaSonido } from "./decision.ts"

const cacheProgramas = new Map<string, boolean>()

function disponible(programa: string): boolean {
  const memo = cacheProgramas.get(programa)
  if (memo !== undefined) return memo
  const existe = GLib.find_program_in_path(programa) !== null
  cacheProgramas.set(programa, existe)
  return existe
}

/**
 * Reproduce el sonido que pida la notificación, si procede.
 *
 * No espera al proceso ni encadena reproducciones: una ráfaga de notificaciones sonoras se solapa,
 * que es lo que hace también cualquier otro escritorio. Serializar obligaría a mantener una cola y
 * a decidir qué hacer con la que llega la número quince.
 */
export function reproducirSonidoNotificacion(entrada: EntradaSonido): void {
  const decision = decidirSonido(entrada)
  if (!decision.reproducir) return

  const comando = comandoReproduccion(decision, disponible)
  if (comando === null) {
    console.warn(
      `[notif sonido] no hay reproductor para ${decision.tipo} «${decision.recurso}»` +
        (decision.tipo === "tema" ? " (requiere canberra-gtk-play, paquete libcanberra)" : ""),
    )
    return
  }

  execAsync(comando).catch((e) => {
    console.warn(`[notif sonido] ${comando[0]} falló:`, e)
  })
}
