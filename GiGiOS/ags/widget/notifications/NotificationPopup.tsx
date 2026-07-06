/**
 * notifications/NotificationPopup.tsx
 * Popups temporales en esquina superior derecha.
 * - Apilado imperativo: newest at bottom, sin re-renders de items existentes.
 * - Margin dinámico: se lee la altura real del panel abierto via app.get_window().
 * - Se eliminan instantáneamente al abrir el panel de notificaciones.
 */

import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
// createState se usa solo para popupMargin y hasPopups (módulo, no componentes)
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
import { execAsync } from "ags/process"
import {
  resolveNotifColor,
  getAppIcon,
  notifPanelVisible,
  openNotifPanel,
  StoredNotification,
} from "./store"
import { ingest } from "./ingest.ts"
import { barVisible, anyPanelVisible } from "../state"

// ── Constantes ────────────────────────────────────────────────────────────────

const POPUP_TIMEOUT_MS = 5500
const ANIM_OUT_MS      = 220
const POPUP_MAX        = 5
const PANEL_MARGIN_TOP = 38   // marginTop común de todos los paneles
const POPUP_GAP        = 10   // separación entre el borde inferior del panel y el popup

// ── Margen dinámico ───────────────────────────────────────────────────────────
// Cuando un panel está abierto, leemos su altura real para posicionar los popups
// justo debajo en lugar de usar un offset fijo.

const PANEL_NAMES = ["notification-panel", "quick-settings", "power-menu"]

function getOpenPanelBottom(): number {
  for (const name of PANEL_NAMES) {
    try {
      const win = app.get_window(name)
      if (!win || !win.visible) continue
      const h = win.get_height()
      if (h > 0) return PANEL_MARGIN_TOP + h
    } catch (_) {}
  }
  return 0
}

const computeMargin = (): number => {
  if (!anyPanelVisible.get()) {
    return barVisible.get() ? PANEL_MARGIN_TOP + 16 : 16
  }
  const bottom = getOpenPanelBottom()
  // Si la altura aún no está disponible (layout pendiente) usamos un fallback
  return (bottom > 0 ? bottom : PANEL_MARGIN_TOP + 260) + POPUP_GAP
}

const [popupMargin, setPopupMargin] = createState(computeMargin())

function scheduleMarginUpdate() {
  // Si el panel de notificaciones acaba de abrirse, eliminar popups visibles
  if (notifPanelVisible.get()) dismissAll()

  if (anyPanelVisible.get()) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
      setPopupMargin(computeMargin())
      return GLib.SOURCE_REMOVE
    })
  } else {
    setPopupMargin(computeMargin())
  }
}

anyPanelVisible.subscribe(scheduleMarginUpdate)
barVisible.subscribe(scheduleMarginUpdate)

// ── Estado imperativo ─────────────────────────────────────────────────────────

const [hasPopups, setHasPopups] = createState(false)

let popupContainer: Gtk.Box | null = null
const popupWidgets = new Map<number, Gtk.Widget>()
const popupTimers  = new Map<number, number>()
const dismissCbs   = new Map<number, () => void>()
const pendingPopups: StoredNotification[] = []

function _removeImmediate(id: number) {
  const timer = popupTimers.get(id)
  if (timer != null) { GLib.source_remove(timer); popupTimers.delete(id) }
  dismissCbs.delete(id)
  const widget = popupWidgets.get(id)
  if (widget) {
    widget.set_visible(false)
    try { popupContainer?.remove(widget) } catch (_) {}
    popupWidgets.delete(id)
  }
  setHasPopups(popupWidgets.size > 0)
}

function triggerDismiss(id: number) {
  const timer = popupTimers.get(id)
  if (timer != null) { GLib.source_remove(timer); popupTimers.delete(id) }
  const cb = dismissCbs.get(id)
  if (cb) cb()
  else _removeImmediate(id)
}

function dismissAll() {
  for (const id of Array.from(popupWidgets.keys())) {
    _removeImmediate(id)
  }
}

function scheduleAutoDismiss(id: number) {
  const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POPUP_TIMEOUT_MS, () => {
    triggerDismiss(id)
    return GLib.SOURCE_REMOVE
  })
  popupTimers.set(id, timerId)
}

function addPopup(notif: StoredNotification) {
  if (!popupContainer) {
    pendingPopups.push(notif)
    return
  }
  if (popupWidgets.size >= POPUP_MAX) {
    _removeImmediate(popupWidgets.keys().next().value!)
  }
  const item = PopupItem({
    notif,
    onDismiss:         () => _removeImmediate(notif.id),
    registerDismissCb: (cb) => dismissCbs.set(notif.id, cb),
  }) as Gtk.Widget

  popupWidgets.set(notif.id, item)
  popupContainer.append(item)
  setHasPopups(true)
}

// Nivel de módulo: garantiza que se registra una sola vez y no depende del
// ciclo de vida del componente.
notifPanelVisible.subscribe((v) => { if (v) dismissAll() })

// ── Componente individual ─────────────────────────────────────────────────────
// No usa createState — la animación de salida se maneja con add_css_class
// para evitar el warning "out of tracking context" al crear widgets imperativamente.

function focusAppWindow(appName: string) {
  const lower = appName.toLowerCase().replace(/\s+/g, "")
  execAsync([
    "bash", "-c",
    `hyprctl dispatch focuswindow "class:(?i)${lower}" 2>/dev/null || \
     hyprctl dispatch focuswindow "title:(?i)${lower}" 2>/dev/null || true`,
  ]).catch(() => {})
}

function PopupItem({ notif, onDismiss, registerDismissCb }: {
  notif: StoredNotification
  onDismiss: () => void
  registerDismissCb: (cb: () => void) => void
}) {
  const color = resolveNotifColor(notif)
  const icon  = getAppIcon(notif.appName)

  const itemBox = (
    <box
      cssClasses={["notif-popup-item"]}
      css={`border-left: 3px solid ${color};`}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={3}
    >
      <box spacing={4} valign={Gtk.Align.CENTER}>
        <label cssClasses={["notif-popup-app-icon"]} label={icon} css={`color: ${color};`} />
        <label
          cssClasses={["notif-popup-app-name"]}
          label={notif.appName}
          halign={Gtk.Align.START}
          ellipsize={3}
          visible={!!notif.appName}
        />
        <label cssClasses={["notif-popup-dot"]} label="·" visible={!!notif.appName && !!(notif.summary)} />
        <label
          cssClasses={["notif-popup-summary"]}
          label={notif.summary}
          hexpand
          halign={Gtk.Align.START}
          ellipsize={3}
          visible={!!(notif.summary)}
        />
      </box>
      <label
        cssClasses={["notif-popup-body"]}
        label={notif.body}
        halign={Gtk.Align.START}
        ellipsize={3}
        lines={2}
        visible={!!(notif.body)}
      />
    </box>
  ) as Gtk.Box

  function dismiss() {
    itemBox.add_css_class("leaving")
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ANIM_OUT_MS, () => {
      onDismiss()
      return GLib.SOURCE_REMOVE
    })
  }

  registerDismissCb(dismiss)

  const clickOpen = new Gtk.GestureClick({ button: 1 })
  clickOpen.connect("pressed", () => { dismiss(); openNotifPanel() })
  itemBox.add_controller(clickOpen)

  const clickDismiss = new Gtk.GestureClick({ button: 2 })
  clickDismiss.connect("pressed", () => dismiss())
  itemBox.add_controller(clickDismiss)

  const clickFocusApp = new Gtk.GestureClick({ button: 3 })
  clickFocusApp.connect("pressed", () => { dismiss(); focusAppWindow(notif.appName) })
  itemBox.add_controller(clickFocusApp)

  return itemBox
}

// ── Ventana ───────────────────────────────────────────────────────────────────

export default function NotificationPopup(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor
  const notifd = AstalNotifd.get_default()

  notifd.connect("notified", (_self, id) => {
    const n = notifd.get_notification(id)
    if (!n) return
    const stored = ingest(n)
    if (!stored) return            // suppressed or dontShow
    if (notifd.dontDisturb) return
    addPopup(stored)
    scheduleAutoDismiss(id)
  })

  const container = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      halign={Gtk.Align.END}
      valign={Gtk.Align.START}
    />
  ) as Gtk.Box

  popupContainer = container
  pendingPopups.splice(0).forEach(n => addPopup(n))

  return (
    <window
      name="notification-popups"
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.NORMAL}
      anchor={TOP | RIGHT}
      application={app}
      marginTop={popupMargin}
      marginRight={16}
      cssClasses={["notif-popup-window"]}
      visible={hasPopups}
    >
      {container}
    </window>
  )
}
