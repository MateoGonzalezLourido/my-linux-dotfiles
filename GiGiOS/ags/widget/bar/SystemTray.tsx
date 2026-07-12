import AstalTray from "gi://AstalTray"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import { Gtk } from "ags/gtk4"
import { createBinding, createComputed, For, With, type Accessor } from "ags"
import { openBarMenu, closeBarMenu, panelAutoClose } from "../state"
import { hiddenTrayApps, trayOverflowAt } from "../settings/trayApps"

// Prefijos de action group que exponen los menús StatusNotifierItem (dbusmenu.* …).
const ACTION_GROUP_NAMES = ["dbusmenu", "tray", "indicator", "item", "app", "unity"]
const TRAY_MENU_MAX_WIDTH = 260
const TRAY_MENU_MAX_HEIGHT = 480
const TRAY_MENU_MAX_LABEL_CHARS = 24

function constrainMenuLabels(widget: Gtk.Widget) {
  if (widget instanceof Gtk.Label) {
    widget.set_max_width_chars(TRAY_MENU_MAX_LABEL_CHARS)
    widget.set_ellipsize(Pango.EllipsizeMode.END)
    widget.set_wrap(false)
  }

  for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
    constrainMenuLabels(child)
  }
}

// Gtk.PopoverMenu exige que su hijo directo siga siendo un Gtk.Stack. Limitamos
// cada página dentro del stack para no romper la navegación de sus submenús.
function constrainPopoverMenu(pop: Gtk.Popover) {
  const stack = pop.get_child()
  if (!(stack instanceof Gtk.Stack)) return
  if ((pop as any)._trayConstraintBusy) return

  // Los labels imponen su texto completo como ancho mínimo si no se limitan.
  // Esto debe repetirse porque algunas apps actualizan las opciones al abrir.
  constrainMenuLabels(stack)
  stack.queue_resize()

  const pages = stack.get_pages()
  if (!(pop as any)._trayPagesWatched) {
    ;(pop as any)._trayPagesWatched = true
    pages.connect("items-changed", () => {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        constrainPopoverMenu(pop)
        return GLib.SOURCE_REMOVE
      })
    })
  }

  const entries: Array<{ child: Gtk.Widget; name: string | null }> = []
  for (let i = 0; i < pages.get_n_items(); i++) {
    const page = pages.get_item(i) as Gtk.StackPage | null
    if (!page) continue
    const child = page.get_child()
    if (!child.has_css_class("tray-menu-scroll")) {
      entries.push({ child, name: page.get_name() })
    }
  }

  ;(pop as any)._trayConstraintBusy = true
  try {
    for (const { child, name } of entries) {
      const [, naturalWidth] = child.measure(Gtk.Orientation.HORIZONTAL, -1)
      const width = Math.min(naturalWidth, TRAY_MENU_MAX_WIDTH)
      const [, naturalHeight] = child.measure(Gtk.Orientation.VERTICAL, width)
      const height = Math.min(naturalHeight, TRAY_MENU_MAX_HEIGHT)

      stack.remove(child)
      const scroll = new Gtk.ScrolledWindow({
        cssClasses: ["tray-menu-scroll"],
        hscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
        vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
        propagateNaturalWidth: true,
        propagateNaturalHeight: true,
        maxContentWidth: TRAY_MENU_MAX_WIDTH,
        maxContentHeight: TRAY_MENU_MAX_HEIGHT,
        widthRequest: width,
        heightRequest: height,
      })
      scroll.set_child(child)
      if (name) stack.add_named(scroll, name)
      else stack.add_child(scroll)
    }
  } finally {
    ;(pop as any)._trayConstraintBusy = false
  }
}

// El umbral de agrupación (nº de apps a partir del cual todos los iconos se
// recogen en el menú desplegable de la flecha, al estilo del overflow del system
// tray de Windows) es configurable en Ajustes › Apps → `trayOverflowAt`.

// Un icono del tray = un Gtk.MenuButton cuyo popover se construye desde el
// menuModel del item. Clave: GTK lee y renderiza el GMenuModel remoto (D-Bus)
// **en C**, gestionando el ciclo de vida de los GVariant internamente. Antes se
// escrapeaba el modelo a mano desde JS (get_item_attribute_value + deep_unpack),
// lo que dejaba GVariants colgantes al reabrir el menú → use-after-free en
// g_variant_classify → SIGSEGV. Con el popover nativo ese fallo es imposible.
//
// `onMenuToggle` (opcional) avisa cuando el menú de este item se abre/cierra. Lo
// usa el overflow para saber que tiene un submenú hijo abierto y no autocerrarse.
function TrayItemButton({
  item,
  onMenuToggle,
}: {
  item: AstalTray.TrayItem
  onMenuToggle?: (open: boolean) => void
}) {
  let opened = false
  let button: Gtk.MenuButton | null = null

  // Cierre por hover con gracia, igual que CpuRam y los paneles del bar: en vez
  // del autohide nativo de GTK (que en layer-shell no cierra bien), el menú se
  // cierra al salir el ratón del icono y del propio menú.
  const autoClose = panelAutoClose(() => button?.get_popover()?.popdown(), 250)

  // Único punto donde bascula `opened`: mantiene sincronizados el bar visible
  // (openBarMenu/closeBarMenu, refcount) y el aviso al overflow.
  const setOpened = (v: boolean) => {
    if (v === opened) return
    opened = v
    if (v) openBarMenu()
    else closeBarMenu()
    onMenuToggle?.(v)
  }

  return (
    <menubutton
      cssClasses={["icon-bare", "tray-item"]}
      focusable={false}
      menuModel={createBinding(item, "menuModel")}
      $={(self: Gtk.MenuButton) => {
        button = self

        // Inserta el/los action group del item para que sus acciones resuelvan.
        // Se refresca en cada apertura por si la app cambia el grupo.
        const applyGroup = () => {
          const g = item.actionGroup ?? null
          for (const name of ACTION_GROUP_NAMES) self.insert_action_group(name, g)
        }
        applyGroup()

        // El popover se autocrea desde menuModel: lo estilamos (.tray-popover),
        // le quitamos la flecha, desactivamos el autohide nativo y enganchamos el
        // cierre por hover para que desaparezca como el resto de paneles.
        const setupPopover = () => {
          const pop = self.get_popover()
          if (!pop) return
          pop.add_css_class("tray-popover")
          pop.set_has_arrow(false)
          pop.set_autohide(false)
          constrainPopoverMenu(pop)
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            constrainPopoverMenu(pop)
            return GLib.SOURCE_REMOVE
          })
          if (!(pop as any)._traySetup) {
            ;(pop as any)._traySetup = true
            const motion = new Gtk.EventControllerMotion()
            motion.connect("enter", () => autoClose.onEnter())
            motion.connect("leave", () => autoClose.onLeave())
            pop.add_controller(motion)
            pop.connect("closed", () => setOpened(false))
          }
        }
        setupPopover()

        // Mantén el bar visible mientras el menú esté abierto y avisa a la app.
        self.connect("notify::active", () => {
          if (self.active) {
            applyGroup()
            setupPopover()
            try { item.about_to_show() } catch (_) {}
            setOpened(true)
          } else {
            setOpened(false)
          }
        })
      }}
    >
      {/* El icono y el propio botón forman parte de la zona de hover: pasar del
          icono al menú (o al revés) no lo cierra; salir de ambos sí. */}
      <Gtk.EventControllerMotion onEnter={autoClose.onEnter} onLeave={autoClose.onLeave} />
      <image gicon={createBinding(item, "gicon")} pixelSize={17} />
    </menubutton>
  )
}

// Reparte una lista plana en filas de `size` para pintar la rejilla.
function chunk<T>(list: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size))
  return rows
}

// Botón de flecha que recoge TODOS los iconos del tray en un popover en rejilla
// (4 por fila), al estilo del overflow de Windows. Cada icono sigue siendo un
// TrayItemButton normal, así que su menú contextual funciona igual que en el bar.
function OverflowTray({ items }: { items: Accessor<AstalTray.TrayItem[]> }) {
  let mbutton: Gtk.MenuButton | null = null
  let opened = false
  let closeAnimationSource = 0

  // Cuántos submenús hijo hay abiertos y si el ratón está dentro de la zona del
  // overflow. Juntos evitan el problema de menús anidados: al mover el ratón del
  // popover overflow hacia el submenú de un icono, el "leave" del overflow no
  // debe cerrarlo mientras ese hijo siga abierto.
  let openChildren = 0
  let insideOverflow = false

  const cancelAnimatedClose = () => {
    if (closeAnimationSource) {
      GLib.source_remove(closeAnimationSource)
      closeAnimationSource = 0
    }
    mbutton?.get_popover()?.remove_css_class("closing")
  }

  const closeAnimated = () => {
    if (openChildren > 0) return
    const pop = mbutton?.get_popover()
    if (!pop || !pop.get_visible() || closeAnimationSource) return
    pop.add_css_class("closing")
    closeAnimationSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
      closeAnimationSource = 0
      pop.remove_css_class("closing")
      pop.popdown()
      return GLib.SOURCE_REMOVE
    })
  }

  const rawAutoClose = panelAutoClose(closeAnimated, 250)

  const onEnter = () => {
    insideOverflow = true
    cancelAnimatedClose()
    rawAutoClose.onEnter()
  }
  const onLeave = () => {
    insideOverflow = false
    rawAutoClose.onLeave()
  }

  // Cuando un icono abre/cierra su menú. Al cerrarse el último hijo, si el ratón
  // ya no está sobre el overflow, se rearma el cierre por hover.
  const onMenuToggle = (open: boolean) => {
    openChildren = Math.max(0, openChildren + (open ? 1 : -1))
    if (!open && openChildren === 0 && !insideOverflow) rawAutoClose.onLeave()
  }

  // Rejilla reactiva vía <For>: gnim gestiona el ciclo de vida de cada
  // TrayItemButton (y de sus bindings) al añadirse/quitarse apps del tray, igual
  // que la ruta inline. Filas de 4 iconos; se construye una vez.
  const rows = items((a: AstalTray.TrayItem[]) => chunk(a, 4))
  const grid = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={2} cssClasses={["tray-overflow-grid"]}>
      <Gtk.EventControllerMotion onEnter={onEnter} onLeave={onLeave} />
      <For each={rows}>
        {(rowItems: AstalTray.TrayItem[]) => (
          <box spacing={2}>
            {rowItems.map((item) => (
              <TrayItemButton item={item} onMenuToggle={onMenuToggle} />
            ))}
          </box>
        )}
      </For>
    </box>
  )

  return (
    <menubutton
      cssClasses={["icon-bare", "tray-item", "tray-overflow"]}
      focusable={false}
      $={(self: Gtk.MenuButton) => {
        mbutton = self

        const pop = new Gtk.Popover()
        pop.add_css_class("tray-popover")
        pop.add_css_class("tray-overflow-popover")
        pop.set_has_arrow(false)
        pop.set_autohide(false)
        pop.set_child(grid)
        pop.connect("closed", () => {
          cancelAnimatedClose()
          if (opened) {
            opened = false
            closeBarMenu()
          }
        })
        self.set_popover(pop)

        self.connect("notify::active", () => {
          if (self.active) {
            if (!opened) {
              opened = true
              openBarMenu()
            }
          } else if (opened) {
            opened = false
            closeBarMenu()
          }
        })
      }}
    >
      <Gtk.EventControllerMotion onEnter={onEnter} onLeave={onLeave} />
      <Gtk.GestureClick
        $={(gesture: Gtk.GestureClick) => gesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)}
        onPressed={(gesture: Gtk.GestureClick) => {
          if (opened && openChildren === 0) {
            closeAnimated()
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
          } else {
            gesture.set_state(Gtk.EventSequenceState.DENIED)
          }
        }}
      />
      {/* Chevron-right (FontAwesome, U+F054) vía escape para que no se pierda al guardar. */}
      <label cssClasses={["tray-overflow-chevron"]} label={"\uf054"} />
    </menubutton>
  )
}

export default function SystemTray() {
  const tray = AstalTray.get_default()
  const rawItems = createBinding(tray, "items")

  // Oculta las apps que el usuario marcó en Ajustes › Apps. Reactivo sobre AMBAS
  // fuentes (tray + lista de ocultas), así ocultar/mostrar se refleja al instante.
  // El umbral de overflow opera sobre la lista YA filtrada, de modo que las apps
  // ocultas no cuentan y desaparecen del todo (incluida la flecha).
  const items = createComputed(() =>
    rawItems().filter((i: AstalTray.TrayItem) => !hiddenTrayApps().includes(i.id))
  )

  // Reactivo sobre items + umbral: con `trayOverflowAt` apps o más, se agrupan.
  // Dentro del modo overflow el popover se reconstruye al abrirse, así que basta
  // con conmutar la rama sin rebuildar el árbol inline.
  const overflow = createComputed(() => items().length >= trayOverflowAt())

  return (
    <box spacing={2}>
      <With value={overflow}>
        {(isOverflow: boolean) =>
          isOverflow ? (
            <OverflowTray items={items} />
          ) : (
            <box spacing={0}>
              <For each={items}>{(item) => <TrayItemButton item={item} />}</For>
            </box>
          )
        }
      </With>
    </box>
  )
}
