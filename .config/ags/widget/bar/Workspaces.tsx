import AstalHyprland from "gi://AstalHyprland"
import Gdk from "gi://Gdk"
import Graphene from "gi://Graphene"
import { createState, For } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

import { barVisible, setIsWsDragging } from "../state.tsx"
import { getIcon } from "./appIcons"

// Blocks update() while hyprctl commands are in flight so intermediate
// states (clients in workspace 9999, etc.) never trigger a re-render.
let _swapping = false

// Cascades clients through every workspace between idA and idB.
// e.g. [1,3,4], drag 1→4: ws1←ws3, ws3←ws4, ws4←original ws1
const shiftWorkspaces = async (idA: number, idB: number, orderedIds: number[], afterSwap?: () => void) => {
  _swapping = true
  const TEMP = 9999
  const hypr = AstalHyprland.get_default()
  const focusedWsId = hypr.focusedWorkspace?.id ?? -1
  const fromIdx = orderedIds.indexOf(idA)
  const toIdx = orderedIds.indexOf(idB)
  try {
    const all: any[] = JSON.parse(await execAsync(["hyprctl", "clients", "-j"]))
    const inFrom = all.filter(c => c.workspace?.id === idA).map(c => c.address as string)
    for (const addr of inFrom)
      await execAsync(["hyprctl", "dispatch", "movetoworkspacesilent", `${TEMP},address:${addr}`])
    if (fromIdx < toIdx) {
      for (let i = fromIdx; i < toIdx; i++) {
        const clients = all.filter(c => c.workspace?.id === orderedIds[i + 1]).map(c => c.address as string)
        for (const addr of clients)
          await execAsync(["hyprctl", "dispatch", "movetoworkspacesilent", `${orderedIds[i]},address:${addr}`])
      }
    } else {
      for (let i = fromIdx; i > toIdx; i--) {
        const clients = all.filter(c => c.workspace?.id === orderedIds[i - 1]).map(c => c.address as string)
        for (const addr of clients)
          await execAsync(["hyprctl", "dispatch", "movetoworkspacesilent", `${orderedIds[i]},address:${addr}`])
      }
    }
    for (const addr of inFrom)
      await execAsync(["hyprctl", "dispatch", "movetoworkspacesilent", `${idB},address:${addr}`])
    if (focusedWsId === idA)
      await execAsync(["hyprctl", "dispatch", "workspace", String(idB)])
  } catch (_) {}
  await new Promise<void>(r => setTimeout(r, 120))
  _swapping = false
  afterSwap?.()
}

const swapWorkspaces = async (idA: number, idB: number, afterSwap?: () => void) => {
  _swapping = true
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
  // Small workspaces get destroyed by Hyprland when emptied during the swap,
  // then recreated — wait for AstalHyprland to reflect the final state.
  await new Promise<void>(r => setTimeout(r, 120))
  _swapping = false
  afterSwap?.()
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

// Shared overlay reference — ghost widget lives here during drag so it floats
// above other buttons without disrupting the Box layout at all.
let _overlay: Gtk.Overlay | null = null

function WsButton({ ws, focusedId, onSwap, onShift, getWsList }: {
  ws: any
  focusedId: any
  onSwap: (a: number, b: number) => void
  onShift: (a: number, b: number) => void
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
        let pressStartTime = 0
        let readyTimer: ReturnType<typeof setTimeout> | null = null
        let dragActive = false
        let ghost: Gtk.Box | null = null
        let baseX = 0
        let grabX = 0
        let pendingOffset = 0
        let tickId: number | null = null

        const clearReady = () => {
          if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null }
          self.remove_css_class("ws-hold-ready")
        }

        const startGhost = () => {
          if (!_overlay) return
          // Compute position of this button relative to the overlay
          const origin = new Graphene.Point({ x: 0, y: 0 })
          const [ok, pt] = self.compute_point(_overlay, origin)
          baseX = ok ? pt.x : self.get_allocation().x

          self.set_opacity(0)

          ghost = new Gtk.Box({
            css_classes: focusedId() === ws.id
              ? ["ws-btn", "focused", "ws-dragging", "ws-ghost"]
              : ["ws-btn", "ws-dragging", "ws-ghost"],
            halign: Gtk.Align.START,
            valign: Gtk.Align.CENTER,
            margin_start: baseX,
            can_target: false,
          })
          const lbl = new Gtk.Label({ label: `${ws.id}`, css_classes: ["ws-id"] })
          ghost.append(lbl)

          _overlay.add_overlay(ghost)

          let ghostHalfW = 0
          tickId = self.add_tick_callback((_w: any, _fc: any): boolean => {
            if (!dragActive) { tickId = null; return false }
            if (!ghost) return true
            if (ghostHalfW === 0) {
              const w = ghost.get_allocated_width()
              if (w > 0) ghostHalfW = w / 2
            }
            // Center ghost under the cursor regardless of where the button was grabbed
            ghost.set_margin_start(baseX + grabX + pendingOffset - ghostHalfW)
            return true
          })
        }

        const stopGhost = () => {
          dragActive = false
          if (tickId !== null) { self.remove_tick_callback(tickId); tickId = null }
          if (ghost) { ghost.unparent(); ghost = null }
          self.set_opacity(1)
        }

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

        const dragGesture = new Gtk.GestureDrag()
        dragGesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)

        dragGesture.connect("drag-begin", (_g: any, startX: number, _: number) => {
          grabX = startX
        })

        dragGesture.connect("drag-update", (_g: any, offsetX: number, _: number) => {
          if (!dragActive) {
            if (Date.now() - pressStartTime < 300) return
            dragActive = true
            clearReady()
            self.add_css_class("ws-dragging")
            setIsWsDragging(true)
            startGhost()
          }
          pendingOffset = Math.round(offsetX)
        })

        dragGesture.connect("drag-end", (g: any, totalOffsetX: number, _: number) => {
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
                const event = (g as any).get_last_event(null)
                const mods: number = event ? (event as any).get_modifier_state() : 0
                const ctrlHeld = !!(mods & Gdk.ModifierType.CONTROL_MASK)
                if (ctrlHeld) onSwap(ws.id, list[targetIdx].id)
                else onShift(ws.id, list[targetIdx].id)
              }
            }
            self.remove_css_class("ws-dragging")
            setIsWsDragging(false)
            stopGhost()
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
    if (_swapping) return
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

  // Combines visual swap (instant) + hyprland swap (suppressed events during flight)
  const doSwap = (idA: number, idB: number) => {
    doVisualSwap(idA, idB)
    swapWorkspaces(idA, idB, update)
  }

  const doVisualShift = (idA: number, idB: number) => {
    const current = wss()
    const fromIdx = current.findIndex(w => w.id === idA)
    const toIdx = current.findIndex(w => w.id === idB)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const next = [...current]
    const [item] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, item)
    setWss(next)
    if (barVisible()) setCacheLastTimeRendered(next)
  }

  const doShift = (idA: number, idB: number) => {
    const orderedIds = wss().map(w => w.id)
    doVisualShift(idA, idB)
    shiftWorkspaces(idA, idB, orderedIds, update)
  }

  hypr.connect("notify::workspaces", update)
  hypr.connect("notify::focused-workspace", update)
  hypr.connect("notify::clients", update)

  update()

  return (
    <Gtk.Overlay
      $={(self) => { _overlay = self }}
    >
      <box cssClasses={["Workspaces"]} spacing={2}>
        <For each={() => barVisible() ? wss() : cacheLastTimeRendered()}>
          {(ws) => <WsButton ws={ws} focusedId={focusedId} onSwap={doSwap} onShift={doShift} getWsList={() => wss()} />}
        </For>
      </box>
    </Gtk.Overlay>
  )
}
