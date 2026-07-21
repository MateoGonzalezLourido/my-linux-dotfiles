import { createState } from "ags"
import { Gtk } from "ags/gtk4"
import AstalNotifd from "gi://AstalNotifd"
import { notifications, notifPanelVisible } from "../notificaciones/store"
import { alternarPanelNotificaciones } from "../../estado/shell"
import { crearCicloVida } from "../../utilidades/cicloVida"

export default function NotificationButton() {
  const cicloVida = crearCicloVida()
  const notifd = AstalNotifd.get_default()

  const getUnread    = () => notifications.get().filter(n => !n.read).length
  const getDnd       = () => notifd.dontDisturb
  const getPanelOpen = () => notifPanelVisible.get()
  const getHasNotifs  = () => notifications.get().length > 0

  const getIconLabel   = () => getDnd() ? "󰪑" : getUnread() > 0 ? "󰂚" : "󰂜"
  const getIconClasses = () => getDnd() ? ["nb-icon", "dnd"] : getUnread() > 0 ? ["nb-icon", "has-notifs"] : ["nb-icon"]

  const [unread,      setUnread]      = createState(getUnread())
  const [panelOpen,   setPanelOpen]   = createState(getPanelOpen())
  const [iconLabel,   setIconLabel]   = createState(getIconLabel())
  const [iconClasses, setIconClasses] = createState(getIconClasses())
  const [hasNotifs,   setHasNotifs]   = createState(getHasNotifs())

  const update = () => {
    setUnread(getUnread())
    setPanelOpen(getPanelOpen())
    setIconLabel(getIconLabel())
    setIconClasses(getIconClasses())
    setHasNotifs(getHasNotifs())
  }

  cicloVida.conectarSenales(notifd, ["notify::dont-disturb", "notified", "resolved"], update)
  cicloVida.suscribir(notifications, update)
  cicloVida.suscribir(notifPanelVisible, update)

  return (
    <button
      visible={hasNotifs((hn) => hn)}
      cssClasses={["bar-pill-btn"]}
      tooltipText={unread((u) => String(u))}
      onClicked={alternarPanelNotificaciones}
    >
      <Gtk.GestureClick
        button={3}
        onPressed={() => { notifd.dontDisturb = !notifd.dontDisturb }}
      />
      <box
        cssClasses={panelOpen((p) => p ? ["bar-pill", "nb-pill", "panel-open"] : ["bar-pill", "nb-pill"])}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        <label
          cssClasses={iconClasses}
          label={iconLabel}
          hexpand
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      </box>
    </button>
  )
}
