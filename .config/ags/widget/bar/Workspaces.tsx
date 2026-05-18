import AstalHyprland from "gi://AstalHyprland"
import { createState, For } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

import { barVisible, setIsWsDragging } from "../state.tsx"
import { getIcon } from "./appIcons"

const swapWorkspaces = async (idA: number, idB: number) => {
  const TEMP = 9999
  const hypr = AstalHyprland.get_default()
  const focusedWsId = hypr.focusedWorkspace?.id ?? -1
  try {
    const all: any[] = JSON.parse(await execAsync(["hyprctl", "clients", "-j"]))
    const inA = all.filter(c => c.workspace?.id === idA).map(c => c.address as string)
    const inB = all.filter(c => c.workspace?.id === idB).map(c => c.address as string)
    for (const addr of inA)
      await execAsync(["hyprctl", "dispatch", "movetoworkspacesilent", `${TEMP},address:${addr}`])
    for (const addr of inB)
      await execAsync(["hyprctl", "dispatch", "movetoworkspacesilent", `${idA},address:${addr}`])
    for (const addr of inA)
      await execAsync(["hyprctl", "dispatch", "movetoworkspacesilent", `${idB},address:${addr}`])
    if (focusedWsId === idA)
      await execAsync(["hyprctl", "dispatch", "workspace", String(idB)])
    else if (focusedWsId === idB)
      await execAsync(["hyprctl", "dispatch", "workspace", String(idA)])
  } catch (_) {}
}

interface ClientIcon {
  icon: string
  address: string
  isGlyph: boolean
  tooltip: string
}

const formatAppName = (cls: string): string =>
  cls.split(/[-_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")

const buildTooltip = (cls: string, title: string): string => {
  const appName = formatAppName(cls)
  const winTitle = (title ?? "").trim()
  if (!winTitle || winTitle.toLowerCase() === cls.toLowerCase()) return appName
  return `${appName}\n${winTitle}`
}

const getClientIcons = (clients: any[]): ClientIcon[] => {
  return [...(clients || [])]
    .filter(c => c.class)
    .map(c => {
      const glyph = getIcon(c.class)
      const tooltip = buildTooltip(c.class, c.title)
      if (glyph) return { icon: glyph, address: c.address, isGlyph: true, tooltip }
      return { icon: c.class, address: c.address, isGlyph: false, tooltip }
    })
}

// Pre-generate one CSS class per pixel offset and load them once.
// During drag we only call add/remove_css_class (O(1), invalidates one widget)
// instead of load_from_string (invalidates every widget in the display).
const DRAG_MAX = 600
let _offsetProvider: Gtk.CssProvider | null = null

const initOffsetProvider = (display: any) => {
  if (_offsetProvider) return
  _offsetProvider = new Gtk.CssProvider()
  let css = ""
  for (let i = -DRAG_MAX; i <= DRAG_MAX; i++)
    css += `.wsd${i < 0 ? "n" + (-i) : i}{transform:translateX(${i}px) scale(1.07);}`
  _offsetProvider.load_from_string(css)
  Gtk.StyleContext.add_provider_for_display(
    display,
    _offsetProvider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1,
  )
}

const dragOffsetClass = (px: number) => {
  const c = Math.max(-DRAG_MAX, Math.min(DRAG_MAX, Math.round(px)))
  return `wsd${c < 0 ? "n" + (-c) : c}`
}

function WsButton({ ws, focusedId, onSwap, getWsList }: {
  ws: any
  focusedId: any
  onSwap: (a: number, b: number) => void
  getWsList: () => any[]
}) {
  const [hovered, setHovered] = createState<boolean>(false)

  const clientsB = focusedId((fId: number) => {
    const isHov = hovered()
    if (!ws.shouldDeduplicate) return ws.allClients as ClientIcon[]
    return (fId === ws.id || isHov) ? ws.allClients as ClientIcon[] : ws.uniqueClients as ClientIcon[]
  })

  const fullscreen = (address: string) => {
    const addr = address.startsWith("0x") ? address : `0x${address}`
    execAsync(["hyprctl", "dispatch", "workspace", String(ws.id)])
      .then(() => execAsync(["hyprctl", "dispatch", "focuswindow", `address:${addr}`]))
      .then(() => execAsync(["hyprctl", "dispatch", "fullscreen", "0"]))
      .catch(() => {})
  }

  const iconBtn = (i: number) => (
    <button
      cssClasses={["ws-icon-btn"]}
      onClicked={() => ws.focus()}
      visible={clientsB((c: ClientIcon[]) => i < c.length)}
      tooltipText={clientsB((c: ClientIcon[]) => c[i]?.tooltip ?? "")}
    >
      <Gtk.GestureClick
        button={3}
        onPressed={() => {
          const fId = focusedId()
          const isHov = hovered()
          const clients = (!ws.shouldDeduplicate || fId === ws.id || isHov)
            ? ws.allClients : ws.uniqueClients
          if (clients[i]) fullscreen(clients[i].address)
        }}
      />
      <box>
        <label
          cssClasses={["ws-icons"]}
          label={clientsB((c: ClientIcon[]) => c[i]?.isGlyph ? c[i].icon : "")}
          visible={clientsB((c: ClientIcon[]) => !!(c[i]?.isGlyph))}
        />
        <Gtk.Image
          cssClasses={["ws-app-icon"]}
          iconName={clientsB((c: ClientIcon[]) => c[i]?.isGlyph ? "" : (c[i]?.icon ?? ""))}
          pixelSize={13}
          visible={clientsB((c: ClientIcon[]) => !!(c[i] && !c[i].isGlyph))}
          valign={Gtk.Align.CENTER}
        />
      </box>
    </button>
  )

  return (
    <box
      cssClasses={focusedId((id: number) => id === ws.id ? ["ws-btn", "focused"] : ["ws-btn"])}
      valign={Gtk.Align.CENTER}
      $={(self) => {
        initOffsetProvider(self.get_display())

        let pressStartTime = 0
        let readyTimer: ReturnType<typeof setTimeout> | null = null
        let dragActive = false
        let currentDragClass: string | null = null

        const clearReady = () => {
          if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null }
          self.remove_css_class("ws-hold-ready")
        }

        // GestureClick records when the button was pressed so we can enforce
        // the 300ms hold before drag activates.
        const pressGesture = new Gtk.GestureClick()
        pressGesture.connect("pressed", () => {
          pressStartTime = Date.now()
          readyTimer = setTimeout(() => {
            readyTimer = null
            self.add_css_class("ws-hold-ready")
          }, 300)
        })
        pressGesture.connect("released", () => {
          clearReady()
          pressStartTime = 0
        })
        self.add_controller(pressGesture)

        // CAPTURE phase so motion is captured even when the pointer moves over
        // child buttons. Drag only activates after the 300ms hold threshold.
        const dragGesture = new Gtk.GestureDrag()
        dragGesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)

        dragGesture.connect("drag-update", (_g: any, offsetX: number, _: number) => {
          if (!dragActive) {
            if (Date.now() - pressStartTime < 300) return
            dragActive = true
            clearReady()
            self.add_css_class("ws-dragging")
            setIsWsDragging(true)
          }
          const cls = dragOffsetClass(offsetX)
          if (cls !== currentDragClass) {
            if (currentDragClass) self.remove_css_class(currentDragClass)
            self.add_css_class(cls)
            currentDragClass = cls
          }
        })

        dragGesture.connect("drag-end", (_g: any, totalOffsetX: number, _: number) => {
          clearReady()
          pressStartTime = 0

          if (dragActive) {
            const step = self.get_allocated_width() + 2
            const positions = Math.round(totalOffsetX / step)
            if (positions !== 0) {
              const list = getWsList()
              const currentIdx = list.findIndex((w: any) => w.id === ws.id)
              const targetIdx = Math.max(0, Math.min(list.length - 1, currentIdx + positions))
              if (targetIdx !== currentIdx) {
                const targetWs = list[targetIdx]
                onSwap(ws.id, targetWs.id)
                swapWorkspaces(ws.id, targetWs.id)
              }
            }
            if (currentDragClass) { self.remove_css_class(currentDragClass); currentDragClass = null }
            self.remove_css_class("ws-dragging")
            setIsWsDragging(false)
            dragActive = false
          }
        })

        self.add_controller(dragGesture)
      }}
    >
      <Gtk.EventControllerMotion
        onEnter={() => setHovered(true)}
        onLeave={() => setHovered(false)}
      />
      <button
        cssClasses={["ws-num-btn"]}
        onClicked={() => ws.focus()}
      >
        <label cssClasses={["ws-id"]} label={`${ws.id}`} />
      </button>
      <revealer
        revealChild={clientsB((c: ClientIcon[]) => c.length > 0)}
        transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
        transitionDuration={250}
      >
        <box spacing={0}>
          {iconBtn(0)}
          {iconBtn(1)}
          {iconBtn(2)}
          {iconBtn(3)}
        </box>
      </revealer>
    </box>
  )
}

const [cacheLastTimeRendered, setCacheLastTimeRendered] = createState<any[]>([])
export default function Workspaces() {
  const hypr = AstalHyprland.get_default()

  const [wss, setWss] = createState<any[]>([])
  const [focusedId, setFocusedId] = createState<number>(hypr.focusedWorkspace.id)

  const update = () => {
    const allWorkspaces = hypr.get_workspaces()
    const fId = hypr.focusedWorkspace.id
    setFocusedId(fId)

    const sorted = [...allWorkspaces].sort((a, b) => a.id - b.id)
    const globalIcons = new Set<string>()

    const workspacesData = sorted.map(ws => {
      const clients = ws.get_clients ? ws.get_clients() : (ws as any).clients
      const allClients = getClientIcons(clients)

      const seenInWs = new Set<string>()
      const uniqueClients = allClients.filter(c => {
        const key = c.isGlyph ? c.icon : `cls:${c.icon}`
        if (seenInWs.has(key) || globalIcons.has(key)) return false
        seenInWs.add(key)
        return true
      })
      uniqueClients.forEach(c => globalIcons.add(c.isGlyph ? c.icon : `cls:${c.icon}`))

      return {
        id: ws.id,
        focus: () => ws.focus(),
        hasClients: clients.length > 0,
        allClients: allClients.slice(0, 4),
        uniqueClients: uniqueClients.slice(0, 4),
      }
    })

    const visibleWss = workspacesData.filter(ws => ws.hasClients || ws.id === fId)
    const shouldDeduplicate = visibleWss.length > 5
    const newWss = visibleWss.map(ws => ({ ...ws, shouldDeduplicate }))
    setWss(newWss)
    if (barVisible()) setCacheLastTimeRendered(newWss)
  }

  const doVisualSwap = (idA: number, idB: number) => {
    const current = wss()
    const idxA = current.findIndex(w => w.id === idA)
    const idxB = current.findIndex(w => w.id === idB)
    if (idxA === -1 || idxB === -1) return
    const next = [...current]
    ;[next[idxA], next[idxB]] = [next[idxB], next[idxA]]
    setWss(next)
    if (barVisible()) setCacheLastTimeRendered(next)
  }

  hypr.connect("notify::workspaces", update)
  hypr.connect("notify::focused-workspace", update)
  hypr.connect("notify::clients", update)

  update()

  return (
    <box cssClasses={["Workspaces"]} spacing={2}>
      <For each={() => barVisible() ? wss() : cacheLastTimeRendered()}>
        {(ws) => <WsButton ws={ws} focusedId={focusedId} onSwap={doVisualSwap} getWsList={() => wss()} />}
      </For>
    </box>
  )
}
