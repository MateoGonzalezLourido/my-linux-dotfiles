import AstalTray from "gi://AstalTray"
import { createBinding } from "ags"
import { Gtk } from "ags/gtk4"

import { crearCicloVida } from "../../../utilidades/cicloVida"
import { panelAutoClose } from "../../../estado/shell"
import { crearControlPopoverAnclado } from "../componentes/PopoverAnclado"
import { limitarMenuTray } from "./LimitesMenu"
import type { ControlVisibilidadBarra } from "../visibilidad"

const NOMBRES_GRUPO_ACCIONES = ["dbusmenu", "tray", "indicator", "item", "app", "unity"]

export interface PropiedadesBotonItemTray {
  item: AstalTray.TrayItem
  visibilidad: ControlVisibilidadBarra
  alCambiarMenu?: (abierto: boolean) => void
}

/** Un icono StatusNotifierItem y su menú GTK nativo. El modelo D-Bus se entrega
 * directamente a GTK para que los GVariant no pasen por memoria administrada JS. */
export default function BotonItemTray({ item, visibilidad, alCambiarMenu }: PropiedadesBotonItemTray) {
  const cicloVida = crearCicloVida()
  const controlMenu = crearControlPopoverAnclado(visibilidad, alCambiarMenu)
  let boton: Gtk.MenuButton | null = null
  let popoverConfigurado: Gtk.Popover | null = null
  let limpiarLimites: (() => void) | null = null

  const autoCierre = panelAutoClose(() => boton?.get_popover()?.popdown(), 250)

  const aplicarGrupoAcciones = (destino: Gtk.MenuButton) => {
    const grupo = item.actionGroup ?? null
    for (const nombre of NOMBRES_GRUPO_ACCIONES) destino.insert_action_group(nombre, grupo)
  }

  const configurarPopover = (destino: Gtk.MenuButton) => {
    const popover = destino.get_popover()
    if (!popover) return
    popover.add_css_class("tray-popover")
    popover.set_has_arrow(false)
    popover.set_autohide(false)

    if (popoverConfigurado === popover) return
    if (popoverConfigurado) controlMenu.cerrar()
    limpiarLimites?.()
    limpiarLimites = limitarMenuTray(popover)
    popoverConfigurado = popover
    const movimiento = new Gtk.EventControllerMotion()
    movimiento.connect("enter", autoCierre.onEnter)
    movimiento.connect("leave", autoCierre.onLeave)
    popover.add_controller(movimiento)
    popover.connect("closed", () => {
      // Un cambio de menuModel puede sustituir el popover antes de que el viejo
      // termine de cerrar. Ese evento tardío no pertenece al menú actual.
      if (boton?.get_popover() === popover) controlMenu.cerrar()
    })
  }

  cicloVida.registrar(() => {
    autoCierre.dispose()
    if (boton?.get_popover()) {
      try { boton.get_popover()?.popdown() } catch (_) {}
    }
    controlMenu.cerrar()
    limpiarLimites?.()
    limpiarLimites = null
    popoverConfigurado = null
    boton = null
  })

  return (
    <menubutton
      cssClasses={["icon-bare", "tray-item"]}
      focusable={false}
      menuModel={createBinding(item, "menuModel")}
      $={(self: Gtk.MenuButton) => {
        boton = self
        aplicarGrupoAcciones(self)
        configurarPopover(self)
        cicloVida.conectarSenales(self, ["notify::active"], () => {
          if (!self.active) {
            controlMenu.cerrar()
            return
          }
          aplicarGrupoAcciones(self)
          configurarPopover(self)
          try { item.about_to_show() } catch (_) {}
          controlMenu.abrir()
        })
      }}
    >
      <Gtk.EventControllerMotion onEnter={autoCierre.onEnter} onLeave={autoCierre.onLeave} />
      <image gicon={createBinding(item, "gicon")} pixelSize={17} />
    </menubutton>
  )
}
