// widget/notifications/persist.ts
// Escritura atómica y asíncrona de los almacenes JSON de notificaciones.
//
// `GLib.file_set_contents` es síncrono y hace fsync: bloquea el bucle principal (y con él el
// dibujado del popup que acaba de llegar) mientras el dato baja al disco. Los ficheros son
// pequeños, pero la escritura ocurre justo en el instante más sensible —cuando entra una
// notificación—, así que se saca del hilo de UI.
//
// Se usa `replace_contents_bytes_async` y NO `replace_contents_async`: esta última no retiene el
// buffer que le pasas, así que el GC de GJS puede liberarlo mientras la escritura sigue en vuelo.
// La variante `_bytes_` toma un GLib.Bytes cuyo ciclo de vida sí queda garantizado.
import GLib from "gi://GLib"
import Gio from "gi://Gio"

export function saveJsonAsync(path: string, data: unknown, label: string): void {
  let text: string
  try {
    text = JSON.stringify(data)
  } catch (e) {
    console.error(`[notif] serialize ${label} failed:`, e)
    return
  }

  try {
    const dir = GLib.path_get_dirname(path)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)

    const bytes = new GLib.Bytes(new TextEncoder().encode(text))
    const file = Gio.File.new_for_path(path)
    file.replace_contents_bytes_async(
      bytes,
      null,   // etag
      false,  // make_backup
      Gio.FileCreateFlags.REPLACE_DESTINATION, // escribe a temporal + rename: nunca deja el fichero a medias
      null,   // cancellable
      (f, res) => {
        try {
          (f as Gio.File).replace_contents_finish(res)
        } catch (e) {
          console.error(`[notif] save ${label} failed:`, e)
        }
      },
    )
  } catch (e) {
    console.error(`[notif] save ${label} failed:`, e)
  }
}
