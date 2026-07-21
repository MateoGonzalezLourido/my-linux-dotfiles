import AstalHyprland from "gi://AstalHyprland"
import Gio from "gi://Gio"
import { For, onCleanup } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

import { describirJuego, GLIFO_JUEGO } from "../../../servicios/juegos/iconos"
import { PANTALLA_COMPLETA_REAL } from "../../../servicios/juegos/deteccion"
import { clientesJuego, iniciarRegistroJuegos } from "../../../servicios/juegos/registro"
import { panelAutoClose } from "../../../estado/shell"
import { crearControlPopoverAnclado } from "../componentes/PopoverAnclado"
import type { ControlVisibilidadBarra } from "../visibilidad"

// Pastilla morada a la derecha de los workspaces: un mini-icono de mando fijo a la
// izquierda y, a su derecha, un icono POR JUEGO en ejecución — el icono real de la
// app (entrada .desktop / tema de iconos / steam_icon_<appid>), no un mando genérico.
// Clic izquierdo: ir al juego. Clic derecho: menú con sus acciones.
//
// El registro singleton de servicios/juegos concentra la detección para toda la sesión;
// esta vista solo deriva nombre, icono y acciones, sin polling propio.

interface GameEntry {
  address: string
  class: string
  name: string
  gicon: Gio.Icon | null
  iconName: string | null
}

function toEntry(c: any): GameEntry {
  const apariencia = describirJuego(c)
  return {
    address: c.address ?? "",
    class: c.class ?? "",
    name: apariencia.nombre,
    gicon: apariencia.icono,
    iconName: apariencia.nombreIcono,
  }
}

export default function GamesIndicator({ visibilidad }: { visibilidad: ControlVisibilidadBarra }) {
  const hypr = AstalHyprland.get_default()
  iniciarRegistroJuegos()
  const list = clientesJuego((clientes) => clientes.map(toEntry))

  // Ir al juego: enfocar su ventana (lo que te lleva a su workspace) y, si no está ya
  // en pantalla completa de verdad, ponerla (estado leído en vivo de la caché).
  const focusGame = (address: string, thenFullscreen: boolean) => {
    const addr = address.startsWith("0x") ? address : `0x${address}`
    execAsync(["hyprctl", "dispatch", "focuswindow", `address:${addr}`])
      .then(() => {
        if (!thenFullscreen) return
        const live = hypr.get_clients().find((c: any) => c.address === address)
        // `fullscreen` es un modo, no un bool: 1 es MAXIMIZADO. Solo saltamos a
        // fullscreen de verdad si no lo está ya.
        if (live && (live.fullscreen ?? 0) < PANTALLA_COMPLETA_REAL) {
          return execAsync(["hyprctl", "dispatch", "fullscreen", "0"])
        }
      })
      .catch(() => {})
  }

  const closeGame = (address: string) => {
    const addr = address.startsWith("0x") ? address : `0x${address}`
    execAsync(["hyprctl", "dispatch", "closewindow", `address:${addr}`]).catch(() => {})
  }

  // Un botón por juego: icono real de la app y, con el clic derecho, sus acciones.
  const GameButton = (entry: GameEntry) => {
    let btnRef: Gtk.Widget | null = null
    let activePopover: Gtk.Popover | null = null
    const controlMenu = crearControlPopoverAnclado(visibilidad)
    const autoClose = panelAutoClose(() => { if (activePopover) activePopover.popdown() }, 250)
    const tooltipName = entry.name.replace(/(?:\s*\([^()]*\))+\s*$/, "").trim() || entry.name

    const finalizarPopover = (popover: Gtk.Popover) => {
      if (activePopover === popover) {
        activePopover = null
        controlMenu.cerrar()
      }
      try { popover.unparent() } catch (_) {}
    }

    // Menú GTK nativo, como el menuModel de las apps en segundo plano. Así las
    // filas, estados de hover, tipografía y espaciado los pinta `.tray-popover`.
    const menuModel = new Gio.Menu()
    const actionGroup = new Gio.SimpleActionGroup()
    const addAction = (name: string, label: string, run: () => void) => {
      menuModel.append(label, `game.${name}`)
      const action = new Gio.SimpleAction({ name })
      action.connect("activate", () => {
        run()
        if (activePopover) activePopover.popdown()
      })
      actionGroup.add_action(action)
    }

    addAction("focus", "󰊴  Ir al juego", () => focusGame(entry.address, false))
    addAction("fullscreen", "󰊓  Pantalla completa", () => focusGame(entry.address, true))
    addAction("close", "󰅖  Cerrar juego", () => closeGame(entry.address))

    const openMenu = () => {
      if (activePopover) { activePopover.popdown(); return }
      if (!btnRef) return
      const pop = Gtk.PopoverMenu.new_from_model(menuModel)
      // Mismo patrón que los menús de las apps en segundo plano: sin autohide
      // nativo y con toda la superficie del popover dentro de la zona de hover.
      // Vigilar solo la tarjeta interior deja un hueco al salir del icono y el
      // temporizador la cierra antes de que el puntero pueda alcanzar las acciones.
      pop.add_css_class("tray-popover")
      pop.set_has_arrow(false)
      pop.set_autohide(false)
      pop.set_position(Gtk.PositionType.BOTTOM)
      // Un Gtk.Popover vive en una superficie GTK separada. Al crearlo y
      // parentarlo manualmente no siempre resuelve los grupos de acciones del
      // botón ancla, así que el grupo debe estar también en el propio popover.
      pop.insert_action_group("game", actionGroup)
      pop.set_parent(btnRef)

      const motion = new Gtk.EventControllerMotion()
      motion.connect("enter", () => autoClose.onEnter())
      motion.connect("leave", () => autoClose.onLeave())
      pop.add_controller(motion)

      activePopover = pop
      controlMenu.abrir()
      pop.connect("closed", () => finalizarPopover(pop))
      pop.popup()
    }

    onCleanup(() => {
      autoClose.dispose()
      const popover = activePopover
      if (popover) {
        try { popover.popdown() } catch (_) {}
        finalizarPopover(popover)
      }
      controlMenu.cerrar()
      btnRef = null
    })

    return (
      <button
        $={(self: Gtk.Widget) => { btnRef = self }}
        cssClasses={["game-tray-icon"]}
        valign={Gtk.Align.CENTER}
        onClicked={() => focusGame(entry.address, true)}
        tooltipText={tooltipName}
      >
        {/* Botón secundario: Gtk.Button solo se queda el clic primario, así que este
            gesto sí llega (mismo motivo que el comentario de UpdatesButton). */}
        <Gtk.GestureClick button={3} onPressed={openMenu} />
        <Gtk.EventControllerMotion onEnter={autoClose.onEnter} onLeave={autoClose.onLeave} />
        {entry.gicon ? (
          <image gicon={entry.gicon} pixelSize={18} cssClasses={["game-tray-img"]} />
        ) : entry.iconName ? (
          <image iconName={entry.iconName} pixelSize={18} cssClasses={["game-tray-img"]} />
        ) : (
          <label cssClasses={["game-tray-glyph"]} label={GLIFO_JUEGO} />
        )}
      </button>
    )
  }

  return (
    <box
      cssClasses={["game-tray"]}
      visible={list((g) => g.length > 0)}
      valign={Gtk.Align.CENTER}
      spacing={4}
    >
      <box cssClasses={["game-tray-items"]} valign={Gtk.Align.CENTER} spacing={2}>
        <For each={list}>{(entry: GameEntry) => GameButton(entry)}</For>
      </box>
    </box>
  )
}
