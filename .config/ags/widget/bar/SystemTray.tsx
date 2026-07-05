import AstalTray from "gi://AstalTray"
import { Gtk } from "ags/gtk4"
import { createBinding, For, With, type Accessor } from "ags"
import { openBarMenu, closeBarMenu, panelAutoClose } from "../state"

// Prefijos de action group que exponen los menús StatusNotifierItem (dbusmenu.* …).
const ACTION_GROUP_NAMES = ["dbusmenu", "tray", "indicator", "item", "app", "unity"]

// Nº máximo de iconos que se muestran sueltos en el bar. Con más que esto, todos
// se recogen en un menú desplegable (flecha) al estilo del overflow del system
// tray de Windows.
// TEMPORAL para pruebas: 3 (con >3 apps se recogen). El valor real es 4.
const MAX_INLINE = 3

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
      tooltipMarkup={createBinding(item, "tooltipMarkup")}
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

  // Cuántos submenús hijo hay abiertos y si el ratón está dentro de la zona del
  // overflow. Juntos evitan el problema de menús anidados: al mover el ratón del
  // popover overflow hacia el submenú de un icono, el "leave" del overflow no
  // debe cerrarlo mientras ese hijo siga abierto.
  let openChildren = 0
  let insideOverflow = false

  const rawAutoClose = panelAutoClose(() => {
    if (openChildren > 0) return
    mbutton?.get_popover()?.popdown()
  }, 250)

  const onEnter = () => {
    insideOverflow = true
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
      tooltipText="Aplicaciones en segundo plano"
      $={(self: Gtk.MenuButton) => {
        mbutton = self

        const pop = new Gtk.Popover()
        pop.add_css_class("tray-popover")
        pop.add_css_class("tray-overflow-popover")
        pop.set_has_arrow(false)
        pop.set_autohide(false)
        pop.set_child(grid)
        pop.connect("closed", () => {
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
      {/* Chevron-right (FontAwesome, U+F054) vía escape para que no se pierda al guardar. */}
      <label label={"\uf054"} />
    </menubutton>
  )
}

export default function SystemTray() {
  const tray = AstalTray.get_default()
  const items = createBinding(tray, "items")

  // Solo cambia de rama al cruzar el umbral (4↔5): dentro del modo overflow el
  // popover se reconstruye al abrirse, así que basta con no rebuildar el árbol.
  const overflow = items((a: AstalTray.TrayItem[]) => a.length > MAX_INLINE)

  return (
    <box spacing={2}>
      <With value={overflow}>
        {(isOverflow: boolean) =>
          isOverflow ? (
            <OverflowTray items={items} />
          ) : (
            <box spacing={2}>
              <For each={items}>{(item) => <TrayItemButton item={item} />}</For>
            </box>
          )
        }
      </With>
    </box>
  )
}
