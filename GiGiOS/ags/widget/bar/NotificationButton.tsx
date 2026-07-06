import { createState } from "ags"
import { Gtk } from "ags/gtk4"
import AstalNotifd from "gi://AstalNotifd"
import { notifications, notifPanelVisible, openNotifPanel, closeNotifPanel } from "../notifications/store"
import { closeAllPanels } from "../state"

export default function NotificationButton() {
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

  notifd.connect("notify::dont-disturb", update)
  notifd.connect("notified", update)
  notifd.connect("resolved", update)
  notifications.subscribe(update)
  notifPanelVisible.subscribe(update)

  return (
    <button
      visible={hasNotifs((hn) => hn)}
      cssClasses={["bar-pill-btn"]}
      tooltipText={unread((u) => u > 0 ? `${u} sin leer` : "Notificaciones")}
      onClicked={() => {
        if (notifPanelVisible.get()) {
          closeNotifPanel()
        } else {
          closeAllPanels()
          openNotifPanel()
        }
      }}
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
        <label cssClasses={iconClasses} label={iconLabel} hexpand halign={Gtk.Align.CENTER} />
      </box>
    </button>
  )
}
