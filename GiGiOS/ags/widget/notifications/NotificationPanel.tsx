import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, For, With, onCleanup } from "ags"
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
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
import { panelAutoClose } from "../state"
import { clipWindowInputToContent } from "../inputRegion"
import EmptyState from "../components/EmptyState"


// ── Header ────────────────────────────────────────────────────────────────────

function PanelHeader() {
  const notifd = AstalNotifd.get_default()
  const unread = notifications((ns) => ns?.filter(n => !n.read).length ?? 0)
  const [dnd, setDnd] = createState(notifd.dontDisturb)
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

function NotificationList() {
  const empty = notifications((ns) => (ns?.length ?? 0) === 0)

  // Vista activa combinando visibilidad + modo agrupado en un solo estado, para poder
  // usar un ÚNICO <With> (anidar dos <With> = Fragments anidados, no soportado por gnim).
  // NotificationList se construye una sola vez (no se remonta), así que estas dos
  // suscripciones viven toda la sesión sin fugarse.
  const currentView = (): ListView =>
    !notifPanelVisible.get() ? "hidden" : groupByApp.get() ? "grouped" : "flat"
  const [view, setView] = createState<ListView>(currentView())
  const updView = () => setView(currentView())
  notifPanelVisible.subscribe(updView)
  groupByApp.subscribe(updView)

  return (
    <Gtk.ScrolledWindow
      cssClasses={["np-list-scroll"]}
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      vexpand
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
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
          visible={empty}
        />

        {/* Los items solo se materializan mientras el panel está abierto y solo para la
            vista activa (lista o agrupada). Al cerrar (view="hidden"), <With> dispone el
            scope y DESTRUYE todos los widgets de items — liberando su RAM en vez de
            dejarlos residentes. Al reabrir se reconstruyen (iconos ya cacheados). */}
        <With value={view}>
          {(v) => v === "flat" ? <FlatList /> : v === "grouped" ? <GroupedList /> : null}
        </With>
      </box>
    </Gtk.ScrolledWindow>
  )
}

function FlatList() {
  // Este componente solo existe mientras el panel está abierto en modo lista (lo controla
  // <With>), así que basta con seguir a `notifications` para actualizarse en vivo. La
  // suscripción se cancela al desmontar via onCleanup para no fugarse entre reaperturas.
  const [list, setList] = createState<StoredNotification[]>(
    notifications.get().slice().reverse()
  )
  onCleanup(notifications.subscribe(() => setList(notifications.get().slice().reverse())))

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

function GroupedList() {
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
  onCleanup(notifications.subscribe(() => setGroups(getGroups())))

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
  const [confirmClear, setConfirmClear] = createState(false)
  const hasNotifs = notifications((ns) => (ns?.length ?? 0) > 0)
  const unread = notifications((ns) => ns?.filter(n => !n.read).length ?? 0)
  const hasSelected = selectedIds((s) => (s?.size ?? 0) > 0)
  let confirmTimer: number | null = null

  return (
    <box cssClasses={["np-footer"]} spacing={4}>
      <button
        cssClasses={["np-icon-btn"]}
        visible={unread((u) => u > 0)}
        onClicked={markAllRead}
      >
        <label cssClasses={["np-btn-icon"]} label="󰄵" />
      </button>

      <box hexpand />

      <button
        cssClasses={["np-icon-btn", "danger"]}
        visible={hasSelected}
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

      <button
        cssClasses={confirmClear((c) => c ? ["np-icon-btn", "danger", "confirm"] : ["np-icon-btn", "danger"])}
        visible={hasNotifs}
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
        <label cssClasses={["np-btn-icon"]} label={confirmClear((c) => c ? "󰃰" : "󰮚")} />
      </button>
    </box>
  )
}

// ── Ventana principal ─────────────────────────────────────────────────────────

export default function NotificationPanel(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor
  const PANEL_TOTAL_WIDTH = 367
  const PANEL_PANEL_WIDTH = 349
  const autoClose = panelAutoClose(closeNotifPanel, 400, notifPanelVisible)
  let panelRef: any = null

  const win = (
    <window
      name="notification-panel"
      visible={notifPanelVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={TOP | RIGHT}
      application={app}
      widthRequest={PANEL_TOTAL_WIDTH}
      marginTop={37}
      marginRight={0}
      decorated={false}
      cssClasses={["np-window"]}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) { closeNotifPanel(); return true }
          return false
        }}
      />

      <box cssClasses={["np-wrapper"]} orientation={Gtk.Orientation.HORIZONTAL} spacing={0}>
        <box cssClasses={["np-bar-connector"]} valign={Gtk.Align.START} />
        <box cssClasses={["np-panel"]} widthRequest={PANEL_PANEL_WIDTH} orientation={Gtk.Orientation.VERTICAL} spacing={0} $={(self: any) => { panelRef = self }}>
          <Gtk.EventControllerMotion onEnter={autoClose.onEnter} onLeave={autoClose.onLeave} />

          {/* Vista principal (los ajustes ahora viven en una ventana centrada aparte) */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
            <PanelHeader />
            <NotificationList />
            <PanelFooter />
          </box>
        </box>
      </box>
    </window>
  )

  clipWindowInputToContent(win, panelRef)
  return win
}
