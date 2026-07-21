import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
import {
  getAppIcon,
  openNotifPanel,
  resolveNotifColor,
  type StoredNotification,
} from "../store"
import { obtenerAccionesVisibles } from "./logica.ts"

const DURACION_ANIMACION_SALIDA_MS = 220

interface PropiedadesElementoPopup {
  notificacion: StoredNotification
  alDescartar: () => void
  registrarDescarte: (callback: () => void) => void
}

function enfocarVentanaAplicacion(nombreAplicacion: string): void {
  const nombreNormalizado = nombreAplicacion.toLowerCase().replace(/\s+/g, "")
  execAsync([
    "bash", "-c",
    `hyprctl dispatch focuswindow "class:(?i)${nombreNormalizado}" 2>/dev/null || \
     hyprctl dispatch focuswindow "title:(?i)${nombreNormalizado}" 2>/dev/null || true`,
  ]).catch(() => {})
}

export default function ElementoPopup({
  notificacion,
  alDescartar,
  registrarDescarte,
}: PropiedadesElementoPopup) {
  const color = resolveNotifColor(notificacion)
  const icono = getAppIcon(notificacion.appName)

  // El aspecto dunst lo decide siempre una regla mediante `meta.style`. No se usa el
  // hint de origen como fallback: hacerlo impediría desactivar la regla desde la UI.
  const esDunst = notificacion.meta.style === "dunst"
  const claseUrgencia = notificacion.urgency >= 2
    ? "u-critical"
    : notificacion.urgency <= 0 ? "u-low" : "u-normal"

  // "default" es la activación implícita y no un botón visible. El popup expone la
  // primera acción real mediante el gesto de clic derecho.
  const accionPrincipal = obtenerAccionesVisibles(notificacion)[0]

  function invocarAccionPrincipal(): void {
    if (!accionPrincipal) return
    try {
      const notificacionActiva = AstalNotifd.get_default().get_notification(notificacion.id)
      notificacionActiva?.invoke(accionPrincipal.id)
    } catch {
      // La notificación ya expiró: no queda ninguna acción que invocar.
    }
  }

  const caja = (
    <box
      cssClasses={esDunst ? ["notif-popup-item", "dunst", claseUrgencia] : ["notif-popup-item"]}
      css={esDunst ? "" : `border-left: 3px solid ${color};`}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={6}
    >
      <box spacing={5} valign={Gtk.Align.CENTER} visible={!esDunst || !!notificacion.summary}>
        <label
          cssClasses={["notif-popup-app-icon"]}
          label={icono}
          css={esDunst ? "" : `color: ${color};`}
          visible={!esDunst}
        />
        <label
          cssClasses={["notif-popup-app-name"]}
          label={notificacion.appName}
          halign={Gtk.Align.START}
          ellipsize={3}
          maxWidthChars={18}
          visible={!esDunst && !!notificacion.appName}
        />
        <label
          cssClasses={["notif-popup-dot"]}
          label="·"
          visible={!esDunst && !!notificacion.appName && !!notificacion.summary}
        />
        <label
          cssClasses={["notif-popup-summary"]}
          label={notificacion.summary}
          hexpand
          halign={Gtk.Align.START}
          ellipsize={3}
          maxWidthChars={28}
          visible={!!notificacion.summary}
        />
      </box>
      <label
        cssClasses={["notif-popup-body"]}
        label={notificacion.body}
        halign={Gtk.Align.START}
        xalign={0}
        wrap={true}
        ellipsize={3}
        lines={4}
        maxWidthChars={48}
        visible={!!notificacion.body}
      />
      <label
        cssClasses={["notif-popup-action-hint"]}
        label={accionPrincipal ? `▸ clic derecho · ${accionPrincipal.label}` : ""}
        halign={Gtk.Align.START}
        xalign={0}
        visible={!!accionPrincipal}
      />
    </box>
  ) as Gtk.Box

  function descartar(): void {
    caja.add_css_class("leaving")
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, DURACION_ANIMACION_SALIDA_MS, () => {
      alDescartar()
      return GLib.SOURCE_REMOVE
    })
  }

  registrarDescarte(descartar)

  const clicAbrir = new Gtk.GestureClick({ button: 1 })
  clicAbrir.connect("pressed", () => {
    descartar()
    openNotifPanel()
  })
  caja.add_controller(clicAbrir)

  const clicDescartar = new Gtk.GestureClick({ button: 2 })
  clicDescartar.connect("pressed", () => descartar())
  caja.add_controller(clicDescartar)

  // Se invoca antes de descartar porque, una vez cerrada en el daemon, ya no puede
  // recuperarse por id. Sin acción se conserva el gesto de enfocar la aplicación.
  const clicDerecho = new Gtk.GestureClick({ button: 3 })
  clicDerecho.connect("pressed", () => {
    if (accionPrincipal) invocarAccionPrincipal()
    else enfocarVentanaAplicacion(notificacion.appName)
    descartar()
  })
  caja.add_controller(clicDerecho)

  return caja
}
