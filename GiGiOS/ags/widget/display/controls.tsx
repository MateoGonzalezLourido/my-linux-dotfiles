// Select integrado compartido por QuickSettings y Ajustes. La lista vive en un
// Gtk.Overlay del propio control: flota sin alterar el layout y, a diferencia de
// Gtk.DropDown/Gtk.Popover, no crea otra superficie que robe el foco del panel.
import { Gtk } from "ags/gtk4"
import { createState, For } from "ags"
import Graphene from "gi://Graphene"
import GLib from "gi://GLib"

let closeActiveSelect: (() => void) | null = null

export function DisplaySelect({ current, options, onSelect, compact = true }: {
  current: any, options: any, onSelect: (value: string) => void, compact?: boolean,
}) {
  const [open, setOpen] = createState(false)

  let list: Gtk.Widget
  let host: Gtk.Overlay | null = null
  let outsideClick: Gtk.GestureClick | null = null

  const belongsTo = (widget: Gtk.Widget | null, ancestor: Gtk.Widget) => {
    let current = widget
    while (current) {
      if (current === ancestor) return true
      current = current.get_parent()
    }
    return false
  }

  const close = () => {
    setOpen(false)
    if (host && outsideClick) host.remove_controller(outsideClick)
    outsideClick = null
    if (host && list.get_parent() === host) host.remove_overlay(list)
    host = null
    if (closeActiveSelect === close) closeActiveSelect = null
  }

  const findHost = (widget: Gtk.Widget): Gtk.Overlay | null => {
    let parent = widget.get_parent()
    while (parent) {
      if (parent instanceof Gtk.Overlay && parent.has_css_class("display-select-host")) return parent
      parent = parent.get_parent()
    }
    return null
  }

  const trigger = (
    <button
      hexpand
      heightRequest={compact ? 26 : -1}
      cssClasses={open((value) => value
        ? ["qs-display-select", ...(compact ? ["compact"] : []), "open"]
        : ["qs-display-select", ...(compact ? ["compact"] : [])])}
      $={(self: Gtk.Button) => self.connect("destroy", close)}
      onClicked={(self: Gtk.Button) => {
        if (open.get()) return close()
        closeActiveSelect?.()
        host = findHost(self)
        if (!host) return
        const [, point] = self.compute_point(host, new Graphene.Point({ x: 0, y: 0 }))
        list.set_halign(Gtk.Align.START)
        list.set_valign(Gtk.Align.START)
        list.set_margin_start(Math.round(point.x))
        list.set_margin_top(Math.round(point.y + self.get_height() + 3))
        list.set_size_request(self.get_width(), -1)
        list.set_vexpand(false)
        host.add_overlay(list)
        host.set_clip_overlay(list, false)
        host.set_measure_overlay(list, false)
        outsideClick = new Gtk.GestureClick()
        outsideClick.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        outsideClick.connect("pressed", (gesture, _press, x, y) => {
          // Este controlador solo observa el clic. Al denegar su propia
          // secuencia, el widget pulsado puede procesar la misma pulsación.
          gesture.set_state(Gtk.EventSequenceState.DENIED)
          if (!host) return
          const picked = host.pick(x, y, Gtk.PickFlags.DEFAULT)
          if (!belongsTo(picked, self) && !belongsTo(picked, list)) {
            // No retires el controlador durante la fase de captura: hacerlo
            // cancela la secuencia antes de que alcance al botón pulsado.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
              close()
              return GLib.SOURCE_REMOVE
            })
          }
        })
        host.add_controller(outsideClick)
        closeActiveSelect = close
        setOpen(true)
      }}
    >
      <box spacing={6} hexpand valign={Gtk.Align.CENTER}>
        <label
          label={current}
          hexpand
          halign={Gtk.Align.START}
          ellipsize={3}
          maxWidthChars={24}
          cssClasses={["qs-display-select-value"]}
        />
        <label label={open((value) => value ? "󰅃" : "󰅀")} cssClasses={["qs-display-select-chevron"]} />
      </box>
    </button>
  ) as unknown as Gtk.Widget

  list = (
    <Gtk.ScrolledWindow
      visible={open}
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      propagateNaturalHeight
      maxContentHeight={272}
      vexpand={false}
      cssClasses={["qs-display-select-list"]}
      $={(self: Gtk.ScrolledWindow) => self.set_overflow(Gtk.Overflow.HIDDEN)}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={1} cssClasses={["qs-display-select-options"]}
        $={(self: Gtk.Box) => self.set_overflow(Gtk.Overflow.HIDDEN)}>
        <For each={options}>
          {(opt: any) => (
            <button
              cssClasses={opt.active
                ? ["qs-display-select-opt", "active"]
                : ["qs-display-select-opt"]}
              onClicked={() => {
                onSelect(opt.value)
                close()
              }}
            >
              <label label={opt.label} halign={Gtk.Align.START} hexpand ellipsize={3} maxWidthChars={24} />
            </button>
          )}
        </For>
      </box>
    </Gtk.ScrolledWindow>
  ) as unknown as Gtk.Widget

  return <box cssClasses={compact ? ["qs-display-select-wrap", "compact"] : ["qs-display-select-wrap"]}>{trigger}</box>
}
