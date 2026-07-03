import AstalTray from "gi://AstalTray"
import { Gtk } from "ags/gtk4"
import { createBinding, For } from "ags"
import { openBarMenu, closeBarMenu, panelAutoClose } from "../state"

// Prefijos de action group que exponen los menús StatusNotifierItem (dbusmenu.* …).
const ACTION_GROUP_NAMES = ["dbusmenu", "tray", "indicator", "item", "app", "unity"]

// Un icono del tray = un Gtk.MenuButton cuyo popover se construye desde el
// menuModel del item. Clave: GTK lee y renderiza el GMenuModel remoto (D-Bus)
// **en C**, gestionando el ciclo de vida de los GVariant internamente. Antes se
// escrapeaba el modelo a mano desde JS (get_item_attribute_value + deep_unpack),
// lo que dejaba GVariants colgantes al reabrir el menú → use-after-free en
// g_variant_classify → SIGSEGV. Con el popover nativo ese fallo es imposible.
function TrayItemButton({ item }: { item: AstalTray.TrayItem }) {
  let opened = false
  let button: Gtk.MenuButton | null = null

  // Cierre por hover con gracia, igual que CpuRam y los paneles del bar: en vez
  // del autohide nativo de GTK (que en layer-shell no cierra bien), el menú se
  // cierra al salir el ratón del icono y del propio menú.
  const autoClose = panelAutoClose(() => button?.get_popover()?.popdown(), 250)

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
            pop.connect("closed", () => {
              if (opened) { opened = false; closeBarMenu() }
            })
          }
        }
        setupPopover()

        // Mantén el bar visible mientras el menú esté abierto y avisa a la app.
        self.connect("notify::active", () => {
          if (self.active) {
            applyGroup()
            setupPopover()
            try { item.about_to_show() } catch (_) {}
            if (!opened) { opened = true; openBarMenu() }
          } else if (opened) {
            opened = false
            closeBarMenu()
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

export default function SystemTray() {
  const tray = AstalTray.get_default()
  const items = createBinding(tray, "items")

  return (
    <box spacing={2}>
      <For each={items}>
        {(item) => <TrayItemButton item={item} />}
      </For>
    </box>
  )
}
