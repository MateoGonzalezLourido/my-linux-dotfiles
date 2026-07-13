import AstalHyprland from "gi://AstalHyprland"
import Gdk from "gi://Gdk"
import GdkPixbuf from "gi://GdkPixbuf"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import Graphene from "gi://Graphene"
import { createState, For } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

import { barVisible, setIsWsDragging, setIsWsPreview, panelAutoClose, beginBarKeyboard, endBarKeyboard } from "../state.tsx"
import { wsPreviewEnabled } from "../settings/preferences"
import { wsPreviewSuspended } from "../power/powerState"
import { getIcon } from "./appIcons"
import { appIconName, appOriginalIcon, describeGame, genericIconName, GAME_GLYPH } from "./games/icon"
import { isGameClient } from "./games/evidence"
import { orderWorkspaceClients } from "./workspaceOrder"

// La preview de workspace se captura/muestra solo si el usuario la tiene activada
// Y no está suspendida por el modo ahorro de energía.
const wsPreviewActive = () => wsPreviewEnabled.get() && !wsPreviewSuspended.get()

// DEBUG-WSPREVIEW (temporal): traza a archivo para diagnosticar el fallo tras
// apagar/encender el toggle. Eliminar tras el diagnóstico.
const wsDebug = (msg: string) => {
  try {
    const line = `${new Date().toISOString()} ${msg}\n`
    const f = Gio.File.new_for_path("/tmp/ws-preview-debug.log")
    const os = f.append_to(Gio.FileCreateFlags.NONE, null)
    os.write_bytes(new GLib.Bytes(new TextEncoder().encode(line)), null)
    os.close(null)
  } catch (_) {}
}

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
    // Build full movement map for every ws involved in the cascade so focus
    // follows regardless of which workspace the user was on.
    const moved = new Map<number, number>()
    moved.set(idA, idB)
    if (fromIdx < toIdx) {
      for (let i = fromIdx; i < toIdx; i++) moved.set(orderedIds[i + 1], orderedIds[i])
    } else {
      for (let i = fromIdx; i > toIdx; i--) moved.set(orderedIds[i - 1], orderedIds[i])
    }
    const newFocus = moved.get(focusedWsId)
    if (newFocus !== undefined)
      await execAsync(["hyprctl", "dispatch", "workspace", String(newFocus)])
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
  gicon: Gio.Icon | null
  address: string
  appClass: string
  isGlyph: boolean
  tooltip: string
}

const cssSafeAppClass = (cls: string): string =>
  cls.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "app"

const formatAppName = (cls: string): string =>
  cls.split(/[-_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")

const buildTooltip = (c: any): string => {
  const cls = c.class ?? ""
  // El nombre real de la app (entrada .desktop) en vez de la clase: un juego de Steam
  // decía "Steam_app_730" en vez de "Counter-Strike 2".
  const appName = describeGame(c).name || formatAppName(cls)
  const winTitle = (c.title ?? "").trim()
  if (!winTitle || winTitle.toLowerCase() === cls.toLowerCase()) return appName
  return `${appName}\n${winTitle}`
}

const getClientIcons = (clients: any[]): ClientIcon[] => {
  return [...(clients || [])]
    .filter(c => c.class)
    .map(c => {
      const tooltip = buildTooltip(c)
      const common = { address: c.address, appClass: c.class, tooltip }

      // 1. Glifo definido a mano en ~/GiGiOS/ags/config/app_icons.json. Se prueban
      //    tanto la clase actual como la inicial antes de resolver un icono gráfico.
      const glyph = getIcon(c.class, c.initialClass ?? c.initial_class)
      if (glyph) return { ...common, icon: glyph, gicon: null, isGlyph: true }

      // 2. Icono original instalado por la app (hicolor / ruta del .desktop). Evita
      //    el círculo y padding que el tema activo añade y conserva una fuente SVG o
      //    PNG grande para que el reescalado a 19px tenga mejores bordes.
      const original = appOriginalIcon(c)
      if (original) {
        return {
          ...common,
          icon: original.to_string() ?? c.class,
          gicon: original,
          isGlyph: false,
        }
      }

      // 3. Icono real del tema. appIconName SOLO devuelve nombres que el tema tiene:
      //    antes se le pasaba la clase cruda a iconName y, cuando no existía tal icono
      //    (p. ej. "steam_app_730"), GTK pintaba el icono roto en vez de nada.
      const name = appIconName(c)
      if (name) return { ...common, icon: name, gicon: null, isGlyph: false }

      // 4. Sin icono resoluble: mando para los juegos, genérico para lo demás.
      if (isGameClient(c)) return { ...common, icon: GAME_GLYPH, gicon: null, isGlyph: true }
      return { ...common, icon: genericIconName(c), gicon: null, isGlyph: false }
    })
}

// Shared overlay reference — ghost widget lives here during drag so it floats
// above other buttons without disrupting the Box layout at all.
let _overlay: Gtk.Overlay | null = null

function WsButton({ ws, focusedId, focusedAddress, onSwap, onShift, onRenumber, getWsList }: {
  ws: any
  focusedId: any
  focusedAddress: any
  onSwap: (a: number, b: number) => void
  onShift: (a: number, b: number) => void
  onRenumber: (id: number, targetId: number) => void
  getWsList: () => any[]
}) {
  const [hovered, setHovered] = createState<boolean>(false)
  let ctrlAtPress = false
  let _preview: Gtk.Popover | null = null

  // Auto-cierre por hover: igual que el popover de CPU/RAM. Se mantiene mientras
  // el ratón esté sobre la preview o sobre el botón de número que la invoca, y
  // se cierra (con gracia) al salir de ambas zonas.
  const previewAutoClose = panelAutoClose(() => { if (_preview) _preview.popdown() }, 250)

  const showPreview = (anchor: Gtk.Widget) => {
    wsDebug(`showPreview ws=${ws.id} active=${wsPreviewActive()} enabled=${wsPreviewEnabled.get()} suspended=${wsPreviewSuspended.get()} _preview=${_preview !== null}`)
    if (!wsPreviewActive()) return
    if (_preview) { _preview.popdown(); return }

    const path = `/tmp/ags-ws-preview-${ws.id}.png`
    const PW = 280, PH = 158

    const outer = new Gtk.Box()
    outer.add_css_class("ws-preview-bg")
    outer.set_size_request(PW, PH)

    const previewMotion = new Gtk.EventControllerMotion()
    previewMotion.connect("enter", () => previewAutoClose.onEnter())
    previewMotion.connect("leave", () => previewAutoClose.onLeave())
    outer.add_controller(previewMotion)

    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
      try {
        // Pre-scale to exactly PW×PH so the Picture widget never learns the
        // original resolution — avoids the popover expanding to 1920×1080.
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, PW, PH, false)
        const texture = Gdk.Texture.new_for_pixbuf(pixbuf)
        const pic = new Gtk.Picture()
        pic.set_paintable(texture)
        pic.set_size_request(PW, PH)
        outer.append(pic)
      } catch (_) {
        const lbl = new Gtk.Label({ label: `Workspace ${ws.id}` })
        lbl.add_css_class("ws-preview-empty")
        lbl.set_halign(Gtk.Align.CENTER)
        lbl.set_valign(Gtk.Align.CENTER)
        lbl.set_hexpand(true)
        lbl.set_vexpand(true)
        outer.append(lbl)
      }
    } else {
      const lbl = new Gtk.Label({ label: `Workspace ${ws.id}` })
      lbl.add_css_class("ws-preview-empty")
      lbl.set_halign(Gtk.Align.CENTER)
      lbl.set_valign(Gtk.Align.CENTER)
      lbl.set_hexpand(true)
      lbl.set_vexpand(true)
      outer.append(lbl)
    }

    const popover = new Gtk.Popover()
    popover.add_css_class("ws-preview-popover")
    popover.set_has_arrow(false)
    popover.set_autohide(false)
    popover.set_position(Gtk.PositionType.TOP)
    popover.set_child(outer)
    popover.set_parent(anchor)
    setIsWsPreview(true)
    _preview = popover
    popover.connect("closed", () => {
      _preview = null
      setIsWsPreview(false)
      try { popover.unparent() } catch (_) {}
    })
    popover.popup()
  }

  const clientsB = focusedId((fId: number) => {
    const isHov = hovered()
    if (!ws.shouldDeduplicate) return ws.allClients as ClientIcon[]
    return (fId === ws.id || isHov) ? ws.allClients as ClientIcon[] : ws.uniqueClients as ClientIcon[]
  })

  const activeIdxB = focusedAddress((fAddr: string) => {
    const clients: ClientIcon[] = clientsB.get()
    return clients.findIndex(c => c.address === fAddr)
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
      cssClasses={clientsB((c: ClientIcon[]) => [
        "ws-icon-btn",
        c[i]?.isGlyph ? "ws-glyph-btn" : "ws-image-btn",
      ])}
      widthRequest={clientsB((c: ClientIcon[]) => c[i]?.isGlyph ? 16 : 24)}
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
      <box
        cssClasses={activeIdxB((activeIdx: number) => {
          const client = clientsB.get()[i]
          return [
            "ws-icon-wrap",
            client?.isGlyph ? "ws-glyph-wrap" : "ws-image-wrap",
            activeIdx === i ? "active-client" : "",
          ].filter(Boolean)
        })}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        hexpand={false}
        vexpand={false}
      >
        <label
          cssClasses={clientsB((c: ClientIcon[]) => [
            "ws-icons",
            "ws-glyph-icon",
            c[i]?.isGlyph ? `ws-glyph-${cssSafeAppClass(c[i].appClass)}` : "",
          ].filter(Boolean))}
          label={clientsB((c: ClientIcon[]) => c[i]?.isGlyph ? c[i].icon : "")}
          visible={clientsB((c: ClientIcon[]) => !!(c[i]?.isGlyph))}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
        <Gtk.Image
          cssClasses={["ws-app-icon", "ws-image-icon"]}
          gicon={clientsB((c: ClientIcon[]) => c[i]?.gicon ?? null)}
          pixelSize={19}
          visible={clientsB((c: ClientIcon[]) => !!(c[i] && !c[i].isGlyph && c[i].gicon))}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
        <Gtk.Image
          cssClasses={["ws-app-icon", "ws-image-icon"]}
          iconName={clientsB((c: ClientIcon[]) => c[i]?.isGlyph ? "" : (c[i]?.icon ?? ""))}
          pixelSize={19}
          visible={clientsB((c: ClientIcon[]) => !!(c[i] && !c[i].isGlyph && !c[i].gicon))}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      </box>
    </button>
  )

  return (
    <box
      focusable={true}
      cssClasses={focusedId((id: number) => id === ws.id ? ["ws-btn", "focused"] : ["ws-btn"])}
      valign={Gtk.Align.CENTER}
      $={(self) => {
        let pressStartTime = 0
        let readyTimer: ReturnType<typeof setTimeout> | null = null
        let dragActive = false
        let didDrag = false
        let pendingRenumber = false
        let renumberTimeout: ReturnType<typeof setTimeout> | null = null
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

        const cancelRenumber = () => {
          if (!pendingRenumber) return
          pendingRenumber = false
          self.remove_css_class("ws-renumber-pending")
          if (renumberTimeout !== null) { clearTimeout(renumberTimeout); renumberTimeout = null }
          endBarKeyboard()  // suelta el teclado del bar → keymode vuelve a NONE
        }

        const startRenumber = () => {
          if (pendingRenumber) return
          pendingRenumber = true
          self.add_css_class("ws-renumber-pending")
          beginBarKeyboard()  // eleva el keymode del bar a ON_DEMAND antes de tomar el foco
          self.grab_focus()
          renumberTimeout = setTimeout(cancelRenumber, 3000)
        }

        const pressGesture = new Gtk.GestureClick()
        pressGesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        pressGesture.set_button(1)
        pressGesture.connect("pressed", (g: any) => {
          pressStartTime = Date.now()
          didDrag = false
          const event = (g as any).get_last_event(null)
          const mods: number = event ? (event as any).get_modifier_state() : 0
          ctrlAtPress = !!(mods & Gdk.ModifierType.CONTROL_MASK)
          readyTimer = setTimeout(() => {
            readyTimer = null
            self.add_css_class("ws-hold-ready")
          }, 300)
        })
        pressGesture.connect("released", () => {
          clearReady()
          pressStartTime = 0
          if (didDrag) return
          if (ctrlAtPress) startRenumber()
          else ws.focus()
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
            didDrag = true
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

        const keyCtrl = new Gtk.EventControllerKey()
        keyCtrl.connect("key-pressed", (_c: any, keyval: number) => {
          if (!pendingRenumber) return false
          if (keyval === 65307) { cancelRenumber(); return true }  // Escape
          if (keyval >= 49 && keyval <= 57) {                      // '1'–'9'
            cancelRenumber()
            onRenumber(ws.id, keyval - 48)
            return true
          }
          return false
        })
        self.add_controller(keyCtrl)

        const focusCtrl = new Gtk.EventControllerFocus()
        focusCtrl.connect("leave", () => cancelRenumber())
        self.add_controller(focusCtrl)
      }}
    >
      <Gtk.EventControllerMotion
        onEnter={() => setHovered(true)}
        onLeave={() => setHovered(false)}
      />
      <button
        cssClasses={["ws-num-btn"]}
      >
        {/* Mantiene la preview abierta mientras el ratón esté sobre el número */}
        <Gtk.EventControllerMotion onEnter={previewAutoClose.onEnter} onLeave={previewAutoClose.onLeave} />
        <Gtk.GestureClick
          button={3}
          onPressed={(g: any) => showPreview((g as any).get_widget())}
        />
        <label cssClasses={["ws-id"]} label={`${ws.id}`} />
      </button>
      <revealer
        revealChild={clientsB((c: ClientIcon[]) => c.length > 0)}
        transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
        transitionDuration={250}
      >
        <box cssClasses={["ws-apps"]} spacing={0}>
          {iconBtn(0)}
          <box cssClasses={["ws-icon-separator"]} visible={clientsB((c: ClientIcon[]) => c.length > 1)} />
          {iconBtn(1)}
          <box cssClasses={["ws-icon-separator"]} visible={clientsB((c: ClientIcon[]) => c.length > 2)} />
          {iconBtn(2)}
          <box cssClasses={["ws-icon-separator"]} visible={clientsB((c: ClientIcon[]) => c.length > 3)} />
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
  const [focusedAddress, setFocusedAddress] = createState<string>(
    (hypr as any).focusedClient?.address ?? ""
  )

  const update = () => {
    if (_swapping) return
    const allWorkspaces = hypr.get_workspaces()
    const fId = hypr.focusedWorkspace.id
    setFocusedId(fId)
    setFocusedAddress((hypr as any).focusedClient?.address ?? "")

    const sorted = [...allWorkspaces].sort((a, b) => a.id - b.id)
    const globalIcons = new Set<string>()

    const workspacesData = sorted.map(ws => {
      const clients = ws.get_clients ? ws.get_clients() : (ws as any).clients
      const allClients = getClientIcons(orderWorkspaceClients(clients))

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
    setCacheLastTimeRendered(newWss)
  }

  const doVisualSwap = (idA: number, idB: number) => {
    const current = wss()
    const idxA = current.findIndex(w => w.id === idA)
    const idxB = current.findIndex(w => w.id === idB)
    if (idxA === -1 || idxB === -1) return
    const next = [...current]
    ;[next[idxA], next[idxB]] = [next[idxB], next[idxA]]
    setWss(next)
    setCacheLastTimeRendered(next)
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
    setCacheLastTimeRendered(next)
  }

  const doRenumber = (fromId: number, toId: number) => {
    if (fromId === toId) return
    if (wss().some(w => w.id === toId)) doSwap(fromId, toId)
    else swapWorkspaces(fromId, toId, update)
  }

  const doShift = (idA: number, idB: number) => {
    const orderedIds = wss().map(w => w.id)
    doVisualShift(idA, idB)
    shiftWorkspaces(idA, idB, orderedIds, update)
  }

  hypr.connect("notify::workspaces", update)
  hypr.connect("notify::focused-workspace", update)
  hypr.connect("notify::clients", update)
  hypr.connect("notify::focused-client", () => {
    setFocusedAddress((hypr as any).focusedClient?.address ?? "")
  })

  // Capture a screenshot whenever a workspace is focused so the preview
  // shows real content. 400ms delay lets Hyprland finish rendering the switch.
  const captureWorkspace = (id: number) => {
    if (!wsPreviewActive()) return
    if (id <= 0 || id >= 9000) return
    setTimeout(() => {
      execAsync(["grim", "-t", "png", "-l", "0", `/tmp/ags-ws-preview-${id}.png`]).catch(() => {})
    }, 400)
  }
  hypr.connect("notify::focused-workspace", () => {
    captureWorkspace(hypr.focusedWorkspace?.id ?? -1)
  })
  // Capture on startup
  setTimeout(() => captureWorkspace(hypr.focusedWorkspace?.id ?? -1), 800)
  // Al reactivar la preview (desde ajustes, o al salir del modo ahorro), captura el
  // workspace actual al momento para que la primera preview no salga en blanco.
  // captureWorkspace ya se auto-filtra con wsPreviewActive(), así que basta con
  // llamarla en cada cambio de cualquiera de los dos estados.
  const recaptureCurrent = () => captureWorkspace(hypr.focusedWorkspace?.id ?? -1)
  wsPreviewEnabled.subscribe(recaptureCurrent)
  wsPreviewSuspended.subscribe(recaptureCurrent)

  update()

  return (
    <Gtk.Overlay
      $={(self) => { _overlay = self }}
    >
      <box cssClasses={["Workspaces"]} spacing={2}>
        <For each={() => barVisible() ? wss() : cacheLastTimeRendered()}>
          {(ws) => <WsButton ws={ws} focusedId={focusedId} focusedAddress={focusedAddress} onSwap={doSwap} onShift={doShift} onRenumber={doRenumber} getWsList={() => wss()} />}
        </For>
      </box>
    </Gtk.Overlay>
  )
}
