import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createComputed, For, With, onCleanup, type Accessor } from "ags"
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
import { barTopMargin } from "../ajustes/preferences"
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
import { clipWindowInputToContent } from "../../utilidades/inputRegion"
import EmptyState from "../../componentes/EmptyState"
import { notifDaemonConflict, type DaemonConflict } from "./daemonCheck"
import DaemonConflictBanner from "./DaemonConflictBanner"


// ── Header ────────────────────────────────────────────────────────────────────

function PanelHeader() {
  const notifd = AstalNotifd.get_default()

  // Los contadores NO se recalculan con el panel cerrado: se ponen al día al abrir.
  // Antes eran dos derivados sueltos de `notifications`, o sea dos recorridos O(n) en
  // CADA notificación entrante aunque nadie estuviera mirando. Mismo patrón que
  // AppFilterChips, y de paso un solo recorrido en vez de dos. Sólo alimentan `visible`
  // de tres botones, así que quedarse rancios mientras el panel no se ve es invisible:
  // `notifPanelVisible` pasa a true ANTES de que se pinte nada (la animación de entrada
  // la gobierna `panelRendered`, que va detrás).
  const readCounts = () => {
    const ns = notifications.get() ?? []
    let unreadCount = 0
    for (const n of ns) if (!n.read) unreadCount++
    return { unread: unreadCount, has: ns.length > 0 }
  }
  const [counts, setCounts] = createState(readCounts())
  const refreshCounts = () => { if (notifPanelVisible.get()) setCounts(readCounts()) }
  notifications.subscribe(refreshCounts)
  notifPanelVisible.subscribe(refreshCounts)

  const unread = counts((c) => c.unread)
  const hasNotifs = counts((c) => c.has)
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

  // ── Montaje incremental ─────────────────────────────────────────────────────
  // Abrir el panel construía los N items DE GOLPE. Con el cap actual (NOTIF_CAP=200)
  // eso es ~31 MB y todo el árbol de widgets en el frame de apertura; el techo crece
  // lineal si algún día se sube el cap. Ahora se monta un primer tramo y se amplía al
  // acercarse al final del scroll.
  //
  // Es montaje incremental, NO reciclado: lo que se acota es el coste de APERTURA (y de
  // los ~99% de aperturas en las que sólo miras lo de arriba), no el máximo si bajas del
  // todo. Se eligió así a propósito frente a un Gtk.ListView con SignalListItemFactory:
  // el reciclado obligaría a partir NotificationItem en bind/unbind y a destruir widgets
  // bajo el puntero mientras se hace scroll — justo la clase de destrucción-en-caliente
  // que ya provocó un SIGSEGV en las filas de franjas horarias (ver ags/CLAUDE.md). Aquí
  // todo lo montado es real, así que la geometría de la barra de scroll siempre es
  // correcta y no hay que estimar alturas (que además varían: cuerpo largo, desplegados).
  const CHUNK = 20
  // Colchón de scroll por debajo de lo visible. NO puede acercarse a la altura del
  // viewport (~1032 px medidos aquí): con 600 px, `value + page_size >= upper - margen`
  // seguía siendo cierto con el scroll ARRIBA DEL TODO, así que el panel se auto-ampliaba
  // solo hasta montarlo casi todo — la optimización quedaba anulada en silencio. Medido.
  const GROW_MARGIN_PX = 300
  const [limit, setLimit] = createState(CHUNK)
  let growing = false

  /** Total montable en la vista activa: items en lista, grupos en agrupado. */
  const mountableTotal = (): number => {
    const ns = notifications.get() ?? []
    if (!groupByApp.get()) return ns.length
    const apps = new Set<string>()
    ns.forEach((n) => apps.add(n.appName))
    return apps.size
  }

  // Crece si el usuario está cerca del final O si lo montado todavía no llena el
  // viewport. Sin la segunda condición, un tramo más corto que la ventana no generaría
  // NINGÚN evento de scroll y el resto quedaría inalcanzable para siempre.
  function maybeGrow(): void {
    if (growing || !rendered.get()) return
    const adj = scrollRef?.get_vadjustment()
    if (!adj) return
    if (limit.get() >= mountableTotal()) return

    // `scrollable` es la guarda que faltaba: mientras el contenido no desborda, el
    // ScrolledWindow crece con él (propagateNaturalHeight) y page_size sube a la par que
    // upper, así que "estoy cerca del final" es trivialmente cierto y no significa nada.
    // Sólo hay un final al que acercarse cuando ya hay algo que scrollear.
    const scrollable = adj.get_upper() > adj.get_page_size() + 1
    const doesNotFill = !scrollable
    const nearBottom = scrollable
      && adj.get_value() + adj.get_page_size() >= adj.get_upper() - GROW_MARGIN_PX
    if (!nearBottom && !doesNotFill) return

    // Fuera del handler: ampliar reconstruye el <For> y GTK está a mitad de layout.
    growing = true
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      setLimit(limit.get() + CHUNK)
      growing = false
      return GLib.SOURCE_REMOVE
    })
  }

  function watchScroll(self: Gtk.ScrolledWindow): void {
    scrollRef = self
    const adj = self.get_vadjustment()
    if (!adj) return
    adj.connect("value-changed", maybeGrow)  // el usuario baja
    adj.connect("changed", maybeGrow)        // cambia el contenido o el tamaño
  }

  // Cada apertura vuelve a empezar por el primer tramo: si no, reabrir el panel tras
  // haber bajado hasta el fondo reconstruiría las 200 de una vez, que es exactamente el
  // coste que esto viene a quitar. Cambiar de vista también reinicia (las unidades que
  // cuenta `limit` pasan a ser otras: items ↔ grupos).
  // El scroll vuelve ARRIBA con el tramo, y las dos mitades son necesarias. El
  // ScrolledWindow sobrevive a las aperturas (sólo se remonta su contenido), así que
  // conservaba el valor de la sesión anterior: reabrir un panel que dejaste bajado
  // restauraba value≈700 sobre una lista recién recortada a CHUNK, `nearBottom` salía
  // cierto de inmediato y volvía a montarlo casi todo — el reset quedaba deshecho
  // (medido: crecía a 80 de 81 en la segunda apertura). Y es además lo que uno espera de
  // un panel ordenado de más nueva a más vieja: al abrir, arriba.
  const resetLimit = () => {
    setLimit(CHUNK)
    scrollRef?.get_vadjustment()?.set_value(0)
  }
  rendered.subscribe(resetLimit)
  groupByApp.subscribe(resetLimit)

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
      $={watchScroll}
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
            ? <FlatList preserveScroll={preserveScrollPosition} limit={limit} />
            : v === "grouped"
              ? <GroupedList preserveScroll={preserveScrollPosition} limit={limit} />
              : null}
        </With>
      </box>
    </Gtk.ScrolledWindow>
  )
}

function FlatList({ preserveScroll, limit }: {
  preserveScroll: (update: () => void) => void
  limit: Accessor<number>
}) {
  // Este componente solo existe mientras el panel está abierto en modo lista (lo controla
  // <With>), así que basta con seguir a `notifications` para actualizarse en vivo. La
  // suscripción se cancela al desmontar via onCleanup para no fugarse entre reaperturas.
  const [list, setList] = createState<StoredNotification[]>(
    notifications.get().slice().reverse()
  )
  onCleanup(notifications.subscribe(() => {
    preserveScroll(() => setList(notifications.get().slice().reverse()))
  }))

  // `slice` conserva la IDENTIDAD de cada objeto notificación, que es por lo que <For>
  // indexa: recortar la cola no reconstruye las filas ya montadas.
  const mounted = createComputed([list, limit], (l, n) => l.slice(0, n))

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
      <For each={mounted}>
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

function GroupedList({ preserveScroll, limit }: {
  preserveScroll: (update: () => void) => void
  limit: Accessor<number>
}) {
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

  // Aquí `limit` cuenta GRUPOS, no items: es la unidad que se monta de golpe en esta
  // vista. Un grupo suelto puede seguir siendo grande, pero eso lo acota el <With> de
  // AppGroup en cuanto está plegado.
  const mounted = createComputed([groups, limit], (g, n) => g.slice(0, n))

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <For each={mounted}>
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

      {/* Plegado = DESTRUIDO, no meramente oculto. Con `visible` los items del grupo se
          construían igual y sólo se escondían, así que plegar no ahorraba nada: un grupo
          de 150 notificaciones pagaba su árbol entero para no enseñar ni una. El <With>
          va en su propio <box> porque al remontarse se inserta al FINAL de su contenedor,
          no en su hueco — sin la caja, expandir un grupo mandaría sus items por debajo del
          resto de grupos (mismo remedio que CpuRam/ScreencastIndicator en Bar.tsx).
          El caso plegado devuelve <box />, NO null: <With> no añade nada al fragment ante
          null y el ciclo de disposición cuelga de iterar sus hijos — sin hijo no correrían
          los onCleanup de los items que acabamos de tirar (ver ags/CLAUDE.md). */}
      <box>
        <With value={collapsed}>
          {(c: boolean) => c
            ? <box visible={false} />
            : (
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                {notifs.map(n => <NotificationItem notif={n} />)}
              </box>
            )}
        </With>
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
  const PANEL_ENTER_MS = 280
  // Techo de seguridad del arranque de la entrada. El reloj de frames sólo corre mientras
  // la superficie está mapeada, así que si no llegara ningún tick con allocación la
  // animación debe arrancar igual: quedarse en `np-preparing` es quedarse en opacity 0,
  // o sea un panel abierto e invisible. Fail-open, como la puerta del Wake up.
  const PANEL_PREPARE_CAP_MS = 120
  const [panelRendered, setPanelRendered] = createState(notifPanelVisible.get())
  // Igual que Quick Settings: mapear la superficie directamente con ON_DEMAND
  // deja el foco de puntero de Hyprland desactualizado hasta mover el ratón y se
  // pierde el clic inmediato sobre el botón del bar. Se pide teclado solo cuando
  // el usuario entra en el panel, manteniendo Escape sin romper el toggle.
  const [panelKeyboardActive, setPanelKeyboardActive] = createState(false)
  let panelRef: any = null
  let animationRef: any = null
  let windowRef: any = null
  let enterTickId: number | null = null
  let enterCapTimer: number | null = null
  let entrancePending = false
  let enterSettleTimer: number | null = null
  let exitTimer: number | null = null
  let hoverCloseTimer: number | null = null
  let alturaConservada = -1
  // Recorte de la región de entrada; se asigna tras construir la ventana. Debe re-ejecutarse al
  // terminar la animación de entrada (el transform de deslizamiento falsea la medida mientras corre).
  let reclipInput: (() => void) | null = null

  /**
   * Mantiene estable la geometría visible durante esta apertura. Las notificaciones
   * actualizan su lista de forma síncrona, pero GTK recalcula el layout después; por
   * eso este método, llamado desde la suscripción previa al repintado, todavía ve la
   * altura con la que el panel se estaba mostrando. `height-request` es un mínimo:
   * contenido nuevo puede hacerlo crecer, mientras que borrar contenido no encoge la
   * superficie justo antes de la animación de salida.
   */
  function conservarAlturaActual(): void {
    const alturaActual = panelRef?.get_height?.() ?? 0
    if (alturaActual <= 0) return
    alturaConservada = Math.max(alturaConservada, alturaActual)
    panelRef?.set_height_request?.(alturaConservada)
  }

  function liberarAlturaConservada(): void {
    alturaConservada = -1
    panelRef?.set_height_request?.(-1)
  }

  // Se registra antes de construir PanelHeader/NotificationList para capturar la
  // asignación anterior antes de que sus suscriptores reconstruyan u oculten filas.
  notifications.subscribe(() => {
    if (notifPanelVisible.get()) conservarAlturaActual()
  })

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

  /** Suelta el tick y el techo de la preparación, ganen o pierdan. */
  function cancelPrepare(): void {
    if (enterTickId !== null) {
      animationRef?.remove_tick_callback(enterTickId)
      enterTickId = null
    }
    if (enterCapTimer !== null) {
      GLib.source_remove(enterCapTimer)
      enterCapTimer = null
    }
  }

  /** Arranca el deslizamiento visible. Idempotente: la gana el tick o el techo, no ambos. */
  function startEntrance(): void {
    if (!entrancePending) return
    entrancePending = false
    cancelPrepare()
    animationRef?.remove_css_class("np-preparing")
    animationRef?.add_css_class("np-entering")
    // Al terminar el deslizamiento (transform en identidad) re-medir la región
    // de entrada, calculada desplazada mientras el panel entraba.
    enterSettleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_ENTER_MS, () => {
      reclipInput?.()
      enterSettleTimer = null
      return GLib.SOURCE_REMOVE
    })
  }

  function beginEntrance(): void {
    entrancePending = false
    cancelPrepare()
    if (enterSettleTimer !== null) { GLib.source_remove(enterSettleTimer); enterSettleTimer = null }
    animationRef?.remove_css_class("np-leaving")
    animationRef?.remove_css_class("np-entering")
    animationRef?.add_css_class("np-preparing")
    setPanelRendered(true)
    entrancePending = true

    // La animación arranca cuando GTK dice que ya ha medido y pintado, NO a un plazo
    // fijo. Antes eran 32 ms ("dos fotogramas aproximadamente") apostados a ciegas: en la
    // 1.ª apertura la ventana todavía no se había mapeado nunca, así que ahí caían de
    // golpe el realize de la superficie, la primera resolución del CSS global (~90 KB)
    // contra todo el subárbol `.np-*`, la rasterización de los glifos Nerd Font del
    // header y el primer render node. Cuando eso no cabía en 32 ms el deslizamiento
    // empezaba con el layout a medias — el microcorte de la primera vez. El reloj de
    // frames ya sabe cuándo ha terminado; se le pregunta en vez de adivinar.
    let framesSeen = 0
    enterTickId = animationRef?.add_tick_callback((widget: any) => {
      if (!entrancePending) return GLib.SOURCE_REMOVE
      // El tick corre en la fase de ACTUALIZACIÓN, antes de pintar, y los primeros pueden
      // llegar sin allocación. Se espera a tener altura real (ya medido) y a un frame más:
      // ese es el primero con el panel preparado ya pintado.
      if ((widget.get_height?.() ?? 0) <= 0) return GLib.SOURCE_CONTINUE
      if (++framesSeen < 2) return GLib.SOURCE_CONTINUE
      enterTickId = null   // ya nos vamos: que cancelPrepare no lo quite dos veces
      startEntrance()
      return GLib.SOURCE_REMOVE
    }) ?? null

    enterCapTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_PREPARE_CAP_MS, () => {
      enterCapTimer = null
      startEntrance()
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
      liberarAlturaConservada()
      beginEntrance()
      return
    }

    // Congelar antes de que closeNotifPanel quite el footer de selección o cualquier
    // otro hijo reactivo. La salida conserva así exactamente la altura que se veía.
    conservarAlturaActual()
    setPanelKeyboardActive(false)
    entrancePending = false
    cancelPrepare()
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
      liberarAlturaConservada()
      exitTimer = null
      return GLib.SOURCE_REMOVE
    })
  })

  const win = (
    <window
      name="notification-panel"
      namespace="notification-panel"
      visible={panelRendered}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={panelKeyboardActive((active) =>
        active ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
      anchor={TOP | RIGHT}
      application={app}
      widthRequest={PANEL_TOTAL_WIDTH}
      // La barra fija reserva 38px; mantener el mismo solape visual de 1px que
      // usamos al flotar evita que aparezca una costura entre ambas superficies.
      marginTop={barTopMargin(37, -1)}
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
