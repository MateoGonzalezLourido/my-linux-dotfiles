import GLib from "gi://GLib"
import { createState } from "ags"

/** Tic global alineado al minuto; todos los monitores comparten este único timer. */
export const [ticReloj, establecerTicReloj] = createState(0)

const ahora = GLib.DateTime.new_now_local()
GLib.timeout_add(GLib.PRIORITY_DEFAULT, (60 - ahora.get_second()) * 1000, () => {
  establecerTicReloj(ticReloj.get() + 1)
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60000, () => {
    establecerTicReloj(ticReloj.get() + 1)
    return GLib.SOURCE_CONTINUE
  })
  return GLib.SOURCE_REMOVE
})
