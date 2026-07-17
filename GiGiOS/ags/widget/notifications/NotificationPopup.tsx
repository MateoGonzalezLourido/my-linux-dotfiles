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
import { canFitPopup } from "./popupLayout.ts"
import { PopupBurstGuard } from "./popupBurst.ts"
import { barVisible, powerMenuVisible, quickSettingsVisible } from "../state"
import { barAutoHideEnabled } from "../settings/preferences"

// ── Constantes ────────────────────────────────────────────────────────────────

const POPUP_TIMEOUT_MS = 5500
const POPUP_TIMEOUT_ACTION_MS     = 20000   // suelo cuando hay un botón que pulsar
const POPUP_TIMEOUT_ACTION_MAX_MS = 60000   // techo: ni con `-t 0` se queda clavado
const ANIM_OUT_MS      = 220
const POPUP_MAX        = 5
const POPUP_WIDTH      = 360
const POPUP_SPACING    = 8
const SCREEN_GAP       = 16
const BURST_THRESHOLD  = 20
const BURST_WINDOW_MS  = 8000
const BURST_QUIET_MS   = 1200
const PANEL_MARGIN_TOP = 38   // marginTop común de todos los paneles
const POPUP_GAP        = 10   // separación entre el borde inferior del panel y el popup

// Offset real del bar para las superficies ancladas arriba. Sin auto-ocultado el bar
// tiene zona exclusiva y el compositor ya desplaza tanto a los paneles como a este
// popup por debajo de él, así que aquí (y en el marginTop de los paneles) el offset
// propio pasa a 0; sumarlo dejaría el doble de hueco. Ver barTopMargin en preferences.
const panelOffset = (): number => (barAutoHideEnabled.get() ? PANEL_MARGIN_TOP : 0)

// ── Margen dinámico ───────────────────────────────────────────────────────────
// Cuando un panel está abierto, leemos su altura real para posicionar los popups
// justo debajo en lugar de usar un offset fijo.

const PANEL_NAMES = ["notification-panel", "quick-settings", "power-menu"]
// No usar anyPanelVisible: también incluye superficies que no se solapan con el
// popup (Orion, calendario, menús de la izquierda...) y activaría el fallback
// vertical de 260 px aunque ninguna ocupe esta esquina.
const panelesQueDesplazanPopup = [notifPanelVisible, quickSettingsVisible, powerMenuVisible]

const hayPanelQueDesplazaPopup = (): boolean =>
  panelesQueDesplazanPopup.some((estado) => estado.get())

function getOpenPanelBottom(): number {
  for (const name of PANEL_NAMES) {
    try {
      const win = app.get_window(name)
      if (!win || !win.visible) continue
      const h = win.get_height()
      if (h > 0) return panelOffset() + h
    } catch (_) {}
  }
  return 0
}

const computeMargin = (): number => {
  if (!hayPanelQueDesplazaPopup()) {
    return barVisible.get() ? panelOffset() + 16 : 16
  }
  const bottom = getOpenPanelBottom()
  // Si la altura aún no está disponible (layout pendiente) usamos un fallback
  return (bottom > 0 ? bottom : panelOffset() + 260) + POPUP_GAP
}

const [popupMargin, setPopupMargin] = createState(computeMargin())

function scheduleMarginUpdate() {
  // Si el panel de notificaciones acaba de abrirse, eliminar popups visibles
  if (notifPanelVisible.get()) dismissAll()

  if (hayPanelQueDesplazaPopup()) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
      setPopupMargin(computeMargin())
      drainQueue()
      return GLib.SOURCE_REMOVE
    })
  } else {
    setPopupMargin(computeMargin())
    drainQueue()
  }
}

panelesQueDesplazanPopup.forEach((estado) => estado.subscribe(scheduleMarginUpdate))
barVisible.subscribe(scheduleMarginUpdate)
barAutoHideEnabled.subscribe(scheduleMarginUpdate)

// ── Estado imperativo ─────────────────────────────────────────────────────────

const [hasPopups, setHasPopups] = createState(false)

let popupContainer: Gtk.Box | null = null
let popupMonitor: Gdk.Monitor | null = null
const popupWidgets = new Map<number, Gtk.Widget>()
const popupHeights = new Map<number, number>()
const popupTimers  = new Map<number, number>()
const dismissCbs   = new Map<number, () => void>()
const pendingPopups: StoredNotification[] = []
const burstGuard = new PopupBurstGuard(BURST_THRESHOLD, BURST_WINDOW_MS)
let burstSummaryTimer: number | null = null
let nextSyntheticId = -1
let notificationSignalConnected = false

function _removeImmediate(id: number, refill = true) {
  const timer = popupTimers.get(id)
  if (timer != null) { GLib.source_remove(timer); popupTimers.delete(id) }
  dismissCbs.delete(id)
  const widget = popupWidgets.get(id)
  if (widget) {
    widget.set_visible(false)
    try { popupContainer?.remove(widget) } catch (_) {}
    popupWidgets.delete(id)
    popupHeights.delete(id)
  }
  setHasPopups(popupWidgets.size > 0)
  if (refill) drainQueue()
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
    _removeImmediate(id, false)
  }
}

// Cuánto vive el popup. Sin acciones: los 5,5 s de siempre, intactos.
//
// Con acciones el popup ES la acción: el botón solo se puede pulsar mientras está en
// pantalla (`_removeImmediate` no cierra la notificación en el daemon, pero se lleva el
// widget, y lo que sale de hypr/scripts no llega al historial porque la builtin
// `system-dunst` ya lo "gestiona"). 5,5 s no dan ni para leer «¿reparo el pendrive?»,
// así que se respeta el `-t` que pidió quien la mandó, con suelo (que un -t corto no la
// haga impulsable) y techo (que un `-t 0` —"no expira nunca" en el spec— no deje un
// popup clavado para siempre).
function popupLifetime(notif: StoredNotification): number {
  const actionable = (notif.actions ?? []).some(a => a.id !== "default" && a.label.trim() !== "")
  if (!actionable) return POPUP_TIMEOUT_MS

  const requested = notif.expireTimeout ?? 0
  const base = requested > 0 ? requested : POPUP_TIMEOUT_ACTION_MS
  return Math.min(Math.max(base, POPUP_TIMEOUT_ACTION_MS), POPUP_TIMEOUT_ACTION_MAX_MS)
}

function scheduleAutoDismiss(notif: StoredNotification) {
  const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, popupLifetime(notif), () => {
    triggerDismiss(notif.id)
    return GLib.SOURCE_REMOVE
  })
  popupTimers.set(notif.id, timerId)
}

function availablePopupHeight(): number {
  if (!popupMonitor) return Number.POSITIVE_INFINITY
  return Math.max(0, popupMonitor.get_geometry().height - popupMargin.get() - SCREEN_GAP)
}

function drainQueue() {
  if (!popupContainer || notifPanelVisible.get()) return

  while (pendingPopups.length > 0 && popupWidgets.size < POPUP_MAX) {
    const notif = pendingPopups[0]
    let measuredHeight = 0
    const item = PopupItem({
      notif,
      onDismiss:         () => _removeImmediate(notif.id),
      registerDismissCb: (cb) => dismissCbs.set(notif.id, cb),
    }) as Gtk.Widget

    try {
      const [, naturalHeight] = item.measure(Gtk.Orientation.VERTICAL, POPUP_WIDTH)
      measuredHeight = naturalHeight
    } catch (_) {
      measuredHeight = 96
    }

    if (!canFitPopup(
      Array.from(popupHeights.values()),
      measuredHeight,
      availablePopupHeight(),
      POPUP_MAX,
      POPUP_SPACING,
    )) {
      dismissCbs.delete(notif.id)
      break
    }

    pendingPopups.shift()
    popupWidgets.set(notif.id, item)
    popupHeights.set(notif.id, measuredHeight)
    popupContainer.append(item)
    scheduleAutoDismiss(notif)
    setHasPopups(true)
  }
}

function addPopup(notif: StoredNotification) {
  const queuedIndex = pendingPopups.findIndex(n => n.id === notif.id)
  if (queuedIndex >= 0) pendingPopups.splice(queuedIndex, 1)
  if (popupWidgets.has(notif.id)) _removeImmediate(notif.id, false)
  pendingPopups.push(notif)
  drainQueue()
}

function createBurstSummary(count: number): StoredNotification {
  return {
    id: nextSyntheticId--,
    appName: "GiGiOS",
    appIcon: "",
    summary: "Muchas notificaciones nuevas",
    body: `Han llegado ${count} notificaciones. Revísalas en el panel de notificaciones.`,
    timestamp: Date.now(),
    read: false,
    urgency: 1,
    actions: [],
    meta: {
      lifetime: "timed",
      clearOnBoot: false,
      noHistory: true,
      muteAudio: true,
      dontShow: false,
      dedupKey: "gigios-popup-burst-summary",
      conditions: [],
      matchedRules: [],
    },
  }
}

function scheduleBurstSummary() {
  if (burstSummaryTimer !== null) GLib.source_remove(burstSummaryTimer)

  burstSummaryTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BURST_QUIET_MS, () => {
    burstSummaryTimer = null
    const count = burstGuard.finish()
    if (count > BURST_THRESHOLD) addPopup(createBurstSummary(count))
    return GLib.SOURCE_REMOVE
  })
}

function handleIncomingPopup(notif: StoredNotification) {
  const burst = burstGuard.record(Date.now())
  if (!burst.bursting) {
    addPopup(notif)
    return
  }

  if (burst.triggered) {
    pendingPopups.splice(0)
    dismissAll()
  }
  scheduleBurstSummary()
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

  // Skin dunst: replica el dunstrc POR DEFECTO, que es el que se echaba de menos:
  // `format = "<b>%s</b>\n%b"` — o sea resumen en negrita + cuerpo, SIN nombre de app ni icono —
  // esquinas rectas, marco de 3px, monoespaciada y fondo sólido por urgencia. De ahí que aquí se
  // oculten icono/app/punto y que el `css` inline (que pintaría el borde izquierdo de color y
  // tintaría el icono) se anule: inline gana al stylesheet, así que dejarlo puesto rompería el
  // marco del skin.
  //
  // Lo decide SIEMPRE una regla, vía `meta.style` (horneado al ingerir). Lo que pone en el skin a
  // las notificaciones de hypr/scripts es la builtin `builtin.system-dunst`, que casa por el hint
  // `x-gigios-source:system` (match.source). Aquí NO se mira el hint directamente a propósito:
  // como fallback haría que desactivar esa regla desde la UI no sirviera de nada — el skin
  // seguiría aplicándose por detrás. Una regla de usuario de más prioridad la pisa, poniendo
  // `dunst` en una app normal o `default` para sacar del skin a algo del sistema.
  const dunst = notif.meta.style === "dunst"
  const urgencyClass = notif.urgency >= 2 ? "u-critical" : notif.urgency <= 0 ? "u-low" : "u-normal"

  // Acciones D-Bus (notify-send -A). "default" es la activación implícita al hacer
  // click, no un botón: se excluye, igual que en NotificationItem.
  //
  // El popup NUNCA las ha pintado (aquí solo había un `actions: []`), así que cualquier
  // `-A` que mandara un script era INVISIBLE e impulsable — lo era el "Lanzar aislado" de
  // las alertas de descarga de oom-monitor.sh desde que se escribió. Y no valía con mirar
  // el historial: las notificaciones de hypr/scripts casan con la builtin `system-dunst`,
  // y `shouldIndex()` no indexa lo que ya gestiona una regla, así que tampoco llegaban ahí.
  // Quedaban muertas en los dos sitios.
  const actions = (notif.actions ?? []).filter(a => a.id !== "default" && a.label.trim() !== "")
  const primaryAction = actions[0]

  function invokePrimary() {
    if (!primaryAction) return
    try {
      const live = AstalNotifd.get_default().get_notification(notif.id)
      if (live) live.invoke(primaryAction.id)
    } catch { /* la notificación ya expiró: nada que invocar */ }
  }

  const itemBox = (
    <box
      cssClasses={dunst ? ["notif-popup-item", "dunst", urgencyClass] : ["notif-popup-item"]}
      css={dunst ? "" : `border-left: 3px solid ${color};`}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={6}
    >
      <box spacing={5} valign={Gtk.Align.CENTER} visible={!dunst || !!notif.summary}>
        <label cssClasses={["notif-popup-app-icon"]} label={icon} css={dunst ? "" : `color: ${color};`} visible={!dunst} />
        <label
          cssClasses={["notif-popup-app-name"]}
          label={notif.appName}
          halign={Gtk.Align.START}
          ellipsize={3}
          maxWidthChars={18}
          visible={!dunst && !!notif.appName}
        />
        <label cssClasses={["notif-popup-dot"]} label="·" visible={!dunst && !!notif.appName && !!(notif.summary)} />
        <label
          cssClasses={["notif-popup-summary"]}
          label={notif.summary}
          hexpand
          halign={Gtk.Align.START}
          ellipsize={3}
          maxWidthChars={28}
          visible={!!(notif.summary)}
        />
      </box>
      <label
        cssClasses={["notif-popup-body"]}
        label={notif.body}
        halign={Gtk.Align.START}
        xalign={0}
        wrap={true}
        ellipsize={3}
        lines={4}
        maxWidthChars={48}
        visible={!!(notif.body)}
      />
      {/* Sin esto la acción sería invisible: no hay botón que ver, y el gesto que la
          dispara (clic derecho) no se adivina. Se pinta también en el skin dunst —
          se aparta del `format` por defecto del dunstrc a sabiendas, porque una acción
          que nadie sabe pulsar es exactamente lo que acabamos de arreglar. */}
      <label
        cssClasses={["notif-popup-action-hint"]}
        label={primaryAction ? `▸ clic derecho · ${primaryAction.label}` : ""}
        halign={Gtk.Align.START}
        xalign={0}
        visible={!!primaryAction}
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

  // Clic derecho: si la notificación trae una acción, la ejecuta; si no, conserva el
  // gesto de siempre (saltar a la ventana que la lanzó). No se pisan porque son
  // excluyentes en la práctica: las notificaciones con acción vienen de scripts de
  // hypr/scripts, cuyo "app" no es una ventana — enfocarla no hacía nada útil, así que
  // ese gesto estaba libre justo donde hace falta.
  //
  // Invocar ANTES de dismiss(): dismiss cierra la notificación en el daemon, y una vez
  // cerrada `get_notification(id)` ya no la encuentra y el invoke se perdería.
  const clickRight = new Gtk.GestureClick({ button: 3 })
  clickRight.connect("pressed", () => {
    if (primaryAction) invokePrimary()
    else focusAppWindow(notif.appName)
    dismiss()
  })
  itemBox.add_controller(clickRight)

  return itemBox
}

// ── Ventana ───────────────────────────────────────────────────────────────────

export default function NotificationPopup(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor
  const notifd = AstalNotifd.get_default()

  if (!notificationSignalConnected) {
    notificationSignalConnected = true
    notifd.connect("notified", (_self, id) => {
      const n = notifd.get_notification(id)
      if (!n) return
      const stored = ingest(n)
      if (!stored) return            // suppressed or dontShow
      if (notifd.dontDisturb) return
      handleIncomingPopup(stored)
    })
  }

  const container = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={POPUP_SPACING}
      halign={Gtk.Align.END}
      valign={Gtk.Align.START}
    />
  ) as Gtk.Box

  popupContainer = container
  popupMonitor = gdkmonitor
  drainQueue()

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
      widthRequest={POPUP_WIDTH}
      cssClasses={["notif-popup-window"]}
      visible={hasPopups}
    >
      {container}
    </window>
  )
}
