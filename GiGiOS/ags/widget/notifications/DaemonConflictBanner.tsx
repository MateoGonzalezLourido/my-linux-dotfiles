// widget/notifications/DaemonConflictBanner.tsx
// Lo que se pinta EN VEZ del "no hay nada" cuando el vacío no es que no haya notificaciones,
// sino que otro daemon nos ha robado el servidor de notificaciones (ver daemonCheck.ts).
// Sin esto, el síntoma ("historial vacío") es indistinguible del estado normal de reposo.
//
// Astal ya grita al no conseguir el nombre ("cannot get proxy: dunst is already running"), pero
// por el stdout de `ags`, que arrancando desde autostart.conf no acaba ni en hyprland.log ni en
// el journal — y no dice ni la consecuencia ni el arreglo. Aquí sí.
import { Gtk } from "ags/gtk4"
import type { DaemonConflict } from "./daemonCheck.ts"
import EmptyState from "../components/EmptyState.tsx"

export function conflictText(c: DaemonConflict): { title: string; subtitle: string } {
  const who = c.comm || `PID ${c.pid}`
  const unit = c.comm ? `${c.comm}.service` : "<daemon>.service"
  return {
    title: `${who} tiene las notificaciones`,
    subtitle:
      `El shell no recibe ninguna notificación mientras otro daemon sea el dueño de\n` +
      `org.freedesktop.Notifications, así que no hay nada que guardar.\n\n` +
      `systemctl --user mask ${unit}\n` +
      `systemctl --user stop ${unit}`,
  }
}

export default function DaemonConflictBanner({
  conflict, wrapClass, iconClass, titleClass, subClass, vexpand,
}: {
  conflict: DaemonConflict
  wrapClass: string
  iconClass: string
  titleClass: string
  subClass: string
  vexpand?: boolean
}): Gtk.Widget {
  const { title, subtitle } = conflictText(conflict)
  return EmptyState({
    icon: "󰀦", title, subtitle, wrapClass, iconClass, titleClass, subClass, vexpand,
  })
}
