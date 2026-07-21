import { Gtk } from "ags/gtk4"
import { createState, With } from "ags"
import { type StoredNotification } from "../store"
import ItemNotificacion from "./item/ItemNotificacion"

export default function GrupoAplicacion({
  appName,
  notificaciones,
}: {
  appName: string
  notificaciones: StoredNotification[]
}) {
  const [plegado, setPlegado] = createState(false)
  const noLeidas = notificaciones.filter((notificacion) => !notificacion.read).length

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["np-app-group"]}>
      <button
        cssClasses={["np-group-header"]}
        onClicked={() => setPlegado(!plegado.get())}
      >
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <label label={plegado((valor) => valor ? "󰅂" : "󰅀")} cssClasses={["np-group-chevron"]} />
          <label label={appName} cssClasses={["np-group-name"]} hexpand halign={Gtk.Align.START} />
          {noLeidas > 0 && (
            <box cssClasses={["np-group-badge"]}>
              <label label={String(noLeidas)} cssClasses={["np-group-count"]} />
            </box>
          )}
          <label label={`${notificaciones.length}`} cssClasses={["np-group-total"]} />
        </box>
      </button>

      {/* El contenido plegado se destruye para liberar sus widgets. La caja exterior
          conserva el punto de inserción al volver a desplegar el grupo. */}
      <box>
        <With value={plegado}>
          {(estaPlegado: boolean) => estaPlegado
            ? <box visible={false} />
            : (
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                {notificaciones.map((notificacion) => <ItemNotificacion notif={notificacion} />)}
              </box>
            )}
        </With>
      </box>
    </box>
  )
}
