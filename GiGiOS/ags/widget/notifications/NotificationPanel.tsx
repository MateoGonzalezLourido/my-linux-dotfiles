import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createComputed, For, With, onCleanup, type Accessor } from "ags"
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
import { barTopMargin } from "../settings/preferences"
import {
  notifications,
  notifPanelVisible,
  closeNotifPanel,
  activeAppFilter,
  setActiveAppFilter,
  selectionMode,
  setSelectionMode,
  selectedIds,
  setSelectedIds,
  groupByApp,
  setGroupByApp,
  notifSettingsVisible,
  setNotifSettingsVisible,
  clearAllNotifications,
  clearSelected,
  markAllRead,
  StoredNotification,
} from "./store"
import NotificationItem from "./NotificationItem"
import { clipWindowInputToContent } from "../inputRegion"
import EmptyState from "../components/EmptyState"
import { notifDaemonConflict, type DaemonConflict } from "./daemonCheck"
import DaemonConflictBanner from "./DaemonConflictBanner"


// ── Header ────────────────────────────────────────────────────────────────────

function PanelHeader() {
  const notifd = AstalNotifd.get_default()
  const unread = notifications((ns) => ns?.filter(n => !n.read).length ?? 0)
  const hasNotifs = notifications((ns) => (ns?.length ?? 0) > 0)
  const [dnd, setDnd] = createState(notifd.dontDisturb)
  const [confirmClear, setConfirmClear] = createState(false)
  let confirmTimer: number | null = null
  notifd.connect("notify::dont-disturb", () => setDnd(notifd.dontDisturb))

  return (
    <box cssClasses={["np-header"]} spacing={0} orientation={Gtk.Orientation.VERTICAL}>
      <box spacing={2} valign={Gtk.Align.CENTER}>
        <label cssClasses={["np-title"]} label="Notificaciones" hexpand halign={Gtk.Align.START} />

        {/* Badge no leídas — click marca todas como leídas */}
        <button
          cssClasses={["np-unread-badge-btn"]}
          visible={unread((u) => u > 0)}
          onClicked={markAllRead}
        >
          <label cssClasses={["np-unread-count"]} label={unread((u) => String(u))} />
        </button>

        <button
          cssClasses={["np-icon-btn"]}
          visible={unread((u) => u > 0)}
          tooltipText="Marcar todas como leídas"
          onClicked={markAllRead}
        >
          <label cssClasses={["np-btn-icon"]} label="󰄵" />
        </button>

        <button
          cssClasses={confirmClear((confirm) => confirm
            ? ["np-icon-btn", "danger", "confirm"]
            : ["np-icon-btn", "danger"])}
          visible={hasNotifs}
          tooltipText={confirmClear((confirm) => confirm ? "Pulsa de nuevo para confirmar" : "Borrar todas")}
          onClicked={() => {
            if (confirmClear.get()) {
              clearAllNotifications()
              setConfirmClear(false)
              if (confirmTimer !== null) GLib.source_remove(confirmTimer)
            } else {
              setConfirmClear(true)
              if (confirmTimer !== null) GLib.source_remove(confirmTimer)
              confirmTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                setConfirmClear(false)
                confirmTimer = null
                return GLib.SOURCE_REMOVE
              })
            }
          }}
        >
          <label cssClasses={["np-btn-icon"]} label={confirmClear((confirm) => confirm ? "󰃰" : "󰮚")} />
        </button>

        <button
          cssClasses={dnd((d) => d ? ["np-icon-btn", "dnd-active"] : ["np-icon-btn"])}
          onClicked={() => { notifd.dontDisturb = !notifd.dontDisturb }}
        >
          <label cssClasses={["np-btn-icon"]} label={dnd((d) => d ? "󰪑" : "󰂚")} />
        </button>

        <button
          cssClasses={selectionMode((s) => s ? ["np-icon-btn", "active"] : ["np-icon-btn"])}
          onClicked={() => {
            const next = !selectionMode.get()
            setSelectionMode(next)
            if (!next) setSelectedIds(new Set())
          }}
        >
          <label cssClasses={["np-btn-icon"]} label="󰒆" />
        </button>

        <button
          cssClasses={groupByApp((g) => g ? ["np-icon-btn", "active"] : ["np-icon-btn"])}
          onClicked={() => setGroupByApp(!groupByApp.get())}
        >
          <label cssClasses={["np-btn-icon"]} label="󰉋" />
        </button>

        <button
          cssClasses={notifSettingsVisible((v) => v ? ["np-icon-btn", "active"] : ["np-icon-btn"])}
          onClicked={() => setNotifSettingsVisible(!notifSettingsVisible.get())}
        >
          <label cssClasses={["np-btn-icon"]} label="󰒓" />
        </button>
      </box>

      <AppFilterChips />
    </box>
  )
}

// ── Filter chips ──────────────────────────────────────────────────────────────

function AppFilterChips() {
  const getApps = (): string[] => {
    const seen = new Set<string>()
    notifications.get().forEach(n => seen.add(n.appName))
    return Array.from(seen).sort()
  }
  const [apps, setApps] = createState<string[]>(getApps())
  // No recalcular la lista de apps mientras el panel está oculto; ponerla al día al abrir.
  const rebuild = () => { if (notifPanelVisible.get()) setApps(getApps()) }
  notifications.subscribe(rebuild)
  notifPanelVisible.subscribe(rebuild)

  return (
    <box cssClasses={["np-filter-row"]} spacing={2}>
      {/* "Todas" fijo a la izquierda, fuera del scroll */}
      <button
        cssClasses={activeAppFilter((f) => f === "all" ? ["np-filter-chip", "active"] : ["np-filter-chip"])}
        onClicked={() => setActiveAppFilter("all")}
      >
        <label label="Todas" cssClasses={["np-filter-chip-label"]} />
      </button>

      {/* Apps con scroll solo rueda/touchpad */}
      <Gtk.ScrolledWindow
        cssClasses={["np-filter-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vscrollbarPolicy={Gtk.PolicyType.NEVER}
        kineticScrolling={false}
        propagateNaturalHeight={true}
        hexpand
      >
        <box spacing={2}>
          <For each={apps}>
            {(appName: string) => (
              <button
                cssClasses={activeAppFilter((f) => f === appName ? ["np-filter-chip", "active"] : ["np-filter-chip"])}
                onClicked={() => setActiveAppFilter(appName)}
              >
                <label label={appName} cssClasses={["np-filter-chip-label"]} />
              </button>
            )}
          </For>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}

// ── Lista de notificaciones ───────────────────────────────────────────────────

type ListView = "hidden" | "flat" | "grouped"

function NotificationList({
  maxContentHeight,
  rendered,
}: {
  maxContentHeight: number
  rendered: Accessor<boolean>
}) {
  const empty = notifications((ns) => (ns?.length ?? 0) === 0)
  let scrollRef: Gtk.ScrolledWindow | null = null

  // <For> vuelve a insertar los widgets cuando cambia el array, incluso si solo
  // se ha marcado una notificación como leída. Restaurar el ajuste evita que GTK
  // lleve el viewport al primer elemento enfocable después de esa reinserción.
  function preserveScrollPosition(update: () => void): void {
    const adjustment = scrollRef?.get_vadjustment()
    const previousValue = adjustment?.get_value() ?? 0
    update()
    if (!adjustment) return
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      adjustment.set_value(previousValue)
      return GLib.SOURCE_REMOVE
    })
  }

  // Vista activa combinando visibilidad + modo agrupado en un solo estado, para poder
  // usar un ÚNICO <With> (anidar dos <With> = Fragments anidados, no soportado por gnim).
  // NotificationList se construye una sola vez (no se remonta), así que estas dos
  // suscripciones viven toda la sesión sin fugarse.
  const currentView = (): ListView =>
    !rendered.get() ? "hidden" : groupByApp.get() ? "grouped" : "flat"
  const [view, setView] = createState<ListView>(currentView())
  const updView = () => setView(currentView())
  rendered.subscribe(updView)
  groupByApp.subscribe(updView)

  return (
    <Gtk.ScrolledWindow
      cssClasses={["np-list-scroll"]}
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      propagateNaturalHeight={true}
      maxContentHeight={maxContentHeight}
      vexpand
      $={(self: Gtk.ScrolledWindow) => { scrollRef = self }}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
        {/* "Sin notificaciones" es mentira si lo que pasa es que otro daemon nos ha quitado
            org.freedesktop.Notifications: no es que no haya, es que no llegan. Ver daemonCheck.ts. */}
        <With value={createComputed([empty, notifDaemonConflict], (isEmpty, c) => (isEmpty && c) || null)}>
          {(c: DaemonConflict | null) => c
            ? DaemonConflictBanner({
                conflict: c,
                wrapClass: "np-empty-state",
                iconClass: "np-empty-icon",
                titleClass: "np-empty-title",
                subClass: "np-empty-sub",
                vexpand: true,
              })
            : <box visible={false} />
          }
        </With>
        <EmptyState
          icon="󰂚"
          title="Sin notificaciones"
          subtitle="Aquí aparecerán tus notificaciones"
          wrapClass="np-empty-state"
          iconClass="np-empty-icon"
          titleClass="np-empty-title"
          subClass="np-empty-sub"
          spacing={10}
          vexpand
          visible={createComputed([empty, notifDaemonConflict], (isEmpty, c) => isEmpty && !c)}
        />

        {/* Los items solo se materializan mientras el panel está abierto y solo para la
            vista activa (lista o agrupada). Al cerrar (view="hidden"), <With> dispone el
            scope y DESTRUYE todos los widgets de items — liberando su RAM en vez de
            dejarlos residentes. Al reabrir se reconstruyen (iconos ya cacheados). */}
        <With value={view}>
          {(v) => v === "flat"
            ? <FlatList preserveScroll={preserveScrollPosition} />
            : v === "grouped"
              ? <GroupedList preserveScroll={preserveScrollPosition} />
              : null}
        </With>
      </box>
    </Gtk.ScrolledWindow>
  )
}

function FlatList({ preserveScroll }: { preserveScroll: (update: () => void) => void }) {
  // Este componente solo existe mientras el panel está abierto en modo lista (lo controla
  // <With>), así que basta con seguir a `notifications` para actualizarse en vivo. La
  // suscripción se cancela al desmontar via onCleanup para no fugarse entre reaperturas.
  const [list, setList] = createState<StoredNotification[]>(
    notifications.get().slice().reverse()
  )
  onCleanup(notifications.subscribe(() => {
    preserveScroll(() => setList(notifications.get().slice().reverse()))
  }))

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
      <For each={list}>
        {(n: StoredNotification) => (
          <box visible={activeAppFilter((f) => f === "all" || f === n.appName)}>
            <NotificationItem notif={n} />
          </box>
        )}
      </For>
    </box>
  )
}

type GroupEntry = { appName: string; notifs: StoredNotification[] }

function GroupedList({ preserveScroll }: { preserveScroll: (update: () => void) => void }) {
  // Igual que FlatList: solo existe mientras el panel está abierto en modo agrupado
  // (lo controla <With>). El filtro solo hace show/hide del grupo completo.
  const getGroups = (): GroupEntry[] => {
    const ns = notifications.get()
    const map = new Map<string, StoredNotification[]>()
    ns.forEach(n => {
      const g = map.get(n.appName) ?? []
      g.push(n)
      map.set(n.appName, g)
    })
    return Array.from(map.entries()).map(([appName, notifs]) => ({ appName, notifs: notifs.slice().reverse() }))
  }
  const [groups, setGroups] = createState<GroupEntry[]>(getGroups())
  onCleanup(notifications.subscribe(() => {
    preserveScroll(() => setGroups(getGroups()))
  }))

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <For each={groups}>
        {({ appName, notifs }: GroupEntry) => (
          <box visible={activeAppFilter((f) => f === "all" || f === appName)}>
            <AppGroup appName={appName} notifs={notifs} />
          </box>
        )}
      </For>
    </box>
  )
}

function AppGroup({ appName, notifs }: { appName: string; notifs: StoredNotification[] }) {
  const [collapsed, setCollapsed] = createState(false)
  const unread = notifs.filter(n => !n.read).length

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["np-app-group"]}>
      <button
        cssClasses={["np-group-header"]}
        onClicked={() => setCollapsed(!collapsed.get())}
      >
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <label label={collapsed((c) => c ? "󰅂" : "󰅀")} cssClasses={["np-group-chevron"]} />
          <label label={appName} cssClasses={["np-group-name"]} hexpand halign={Gtk.Align.START} />
          {unread > 0 && (
            <box cssClasses={["np-group-badge"]}>
              <label label={String(unread)} cssClasses={["np-group-count"]} />
            </box>
          )}
          <label label={`${notifs.length}`} cssClasses={["np-group-total"]} />
        </box>
      </button>

      <box orientation={Gtk.Orientation.VERTICAL} spacing={2} visible={collapsed((c) => !c)}>
        {notifs.map(n => <NotificationItem notif={n} />)}
      </box>
    </box>
  )
}

// ── Footer (flotante sobre la lista via Overlay) ───────────────────────────────

function PanelFooter() {
  const hasSelected = selectedIds((s) => (s?.size ?? 0) > 0)

  return (
    <box cssClasses={["np-footer"]} spacing={4} visible={hasSelected}>
      <button
        cssClasses={["np-icon-btn", "danger"]}
        onClicked={() => {
          clearSelected()
          setSelectionMode(false)
        }}
      >
        <box spacing={3}>
          <label cssClasses={["np-btn-icon"]} label="󰆴" />
          <label cssClasses={["np-footer-count"]} label={selectedIds((s) => String(s.size))} />
        </box>
      </button>
    </box>
  )
}

// ── Ventana principal ─────────────────────────────────────────────────────────

export default function NotificationPanel(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor
  const PANEL_TOTAL_WIDTH = 407
  const PANEL_PANEL_WIDTH = 389
  // Espacio reservado para la barra superior, la cabecera del panel y un
  // pequeño margen inferior. La lista crece de forma natural hasta este límite.
  const MAX_LIST_HEIGHT = Math.max(210, gdkmonitor.get_geometry().height - 120)
  // La animación dura 280 ms; estos 20 ms extra garantizan que GTK pinte el
  // último frame con el panel completamente fuera antes de ocultar la ventana.
  const PANEL_EXIT_MS = 300
  const PANEL_PREPARE_MS = 32
  const PANEL_ENTER_MS = 280
  const [panelRendered, setPanelRendered] = createState(notifPanelVisible.get())
  // Igual que Quick Settings: mapear la superficie directamente con ON_DEMAND
  // deja el foco de puntero de Hyprland desactualizado hasta mover el ratón y se
  // pierde el clic inmediato sobre el botón del bar. Se pide teclado solo cuando
  // el usuario entra en el panel, manteniendo Escape sin romper el toggle.
  const [panelKeyboardActive, setPanelKeyboardActive] = createState(false)
  let panelRef: any = null
  let animationRef: any = null
  let windowRef: any = null
  let enterTimer: number | null = null
  let enterSettleTimer: number | null = null
  let exitTimer: number | null = null
  let hoverCloseTimer: number | null = null
  // Recorte de la región de entrada; se asigna tras construir la ventana. Debe re-ejecutarse al
  // terminar la animación de entrada (el transform de deslizamiento falsea la medida mientras corre).
  let reclipInput: (() => void) | null = null

  function cancelHoverClose(): void {
    if (hoverCloseTimer === null) return
    GLib.source_remove(hoverCloseTimer)
    hoverCloseTimer = null
  }

  function pointerIsOverPanel(): boolean {
    try {
      const surface = windowRef?.get_surface()
      const pointer = windowRef?.get_display()?.get_default_seat()?.get_pointer()
      if (!surface || !pointer) return false
      const [inside] = surface.get_device_position(pointer)
      return inside
    } catch (_) {
      return false
    }
  }

  function handlePointerEnter(): void {
    cancelHoverClose()
    setPanelKeyboardActive(true)
  }

  function handlePointerLeave(): void {
    cancelHoverClose()
    if (!notifPanelVisible.get()) return
    hoverCloseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
      hoverCloseTimer = null
      if (notifPanelVisible.get() && !pointerIsOverPanel()) closeNotifPanel()
      return GLib.SOURCE_REMOVE
    })
  }

  function beginEntrance(): void {
    if (enterTimer !== null) GLib.source_remove(enterTimer)
    if (enterSettleTimer !== null) { GLib.source_remove(enterSettleTimer); enterSettleTimer = null }
    animationRef?.remove_css_class("np-leaving")
    animationRef?.remove_css_class("np-entering")
    animationRef?.add_css_class("np-preparing")
    setPanelRendered(true)

    // Dos fotogramas aproximadamente: da tiempo a crear, medir y estilizar los
    // items antes de iniciar la animación visible, especialmente en la 1.ª apertura.
    enterTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_PREPARE_MS, () => {
      animationRef?.remove_css_class("np-preparing")
      animationRef?.add_css_class("np-entering")
      enterTimer = null
      // Al terminar el deslizamiento (transform en identidad) re-medir la región
      // de entrada, calculada desplazada mientras el panel entraba.
      enterSettleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_ENTER_MS, () => {
        reclipInput?.()
        enterSettleTimer = null
        return GLib.SOURCE_REMOVE
      })
      return GLib.SOURCE_REMOVE
    })
  }

  // La ventana permanece creada mientras está oculta, así que la clase debe
  // retirarse al cerrar y añadirse de nuevo en cada apertura para reiniciar CSS.
  // `panelRendered` retrasa el ocultado hasta que acaba la animación de salida.
  notifPanelVisible.subscribe(() => {
    cancelHoverClose()
    if (notifPanelVisible.get()) {
      setPanelKeyboardActive(false)
      if (exitTimer !== null) {
        GLib.source_remove(exitTimer)
        exitTimer = null
      }
      beginEntrance()
      return
    }

    setPanelKeyboardActive(false)
    if (enterTimer !== null) {
      GLib.source_remove(enterTimer)
      enterTimer = null
    }
    if (enterSettleTimer !== null) {
      GLib.source_remove(enterSettleTimer)
      enterSettleTimer = null
    }
    animationRef?.remove_css_class("np-preparing")
    animationRef?.remove_css_class("np-entering")
    animationRef?.add_css_class("np-leaving")
    if (exitTimer !== null) GLib.source_remove(exitTimer)
    exitTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_EXIT_MS, () => {
      setPanelRendered(false)
      animationRef?.remove_css_class("np-leaving")
      exitTimer = null
      return GLib.SOURCE_REMOVE
    })
  })

  const win = (
    <window
      name="notification-panel"
      visible={panelRendered}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={panelKeyboardActive((active) =>
        active ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
      anchor={TOP | RIGHT}
      application={app}
      widthRequest={PANEL_TOTAL_WIDTH}
      marginTop={barTopMargin(37)}
      marginRight={0}
      decorated={false}
      cssClasses={["np-window"]}
      $={(self: any) => { windowRef = self }}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) { closeNotifPanel(); return true }
          return false
        }}
      />

      <box
        cssClasses={["np-wrapper"]}
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={0}
        $={(self: any) => {
          animationRef = self
          if (notifPanelVisible.get()) beginEntrance()
        }}
      >
        <box cssClasses={["np-bar-connector"]} valign={Gtk.Align.START} />
        <box
          cssClasses={["np-panel"]}
          widthRequest={PANEL_PANEL_WIDTH}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          $={(self: any) => {
            panelRef = self
          }}
        >
          <Gtk.EventControllerMotion onEnter={handlePointerEnter} onLeave={handlePointerLeave} />

          {/* Vista principal (los ajustes ahora viven en una ventana centrada aparte) */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
            <PanelHeader />
            <NotificationList maxContentHeight={MAX_LIST_HEIGHT} rendered={panelRendered} />
            <PanelFooter />
          </box>
        </box>
      </box>
    </window>
  )

  reclipInput = clipWindowInputToContent(win, panelRef)
  return win
}
