import AstalHyprland from "gi://AstalHyprland"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { createState, For, onCleanup } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

import { isGameClient } from "./evidence"
import { describeGame, GAME_GLYPH } from "./icon"
import { FULLSCREEN_REAL } from "./detect"
import { openBarMenu, closeBarMenu, panelAutoClose } from "../../state"

// Pastilla morada a la derecha de los workspaces: un mini-icono de mando fijo a la
// izquierda y, a su derecha, un icono POR JUEGO en ejecución — el icono real de la
// app (entrada .desktop / tema de iconos / steam_icon_<appid>), no un mando genérico.
// Clic izquierdo: ir al juego. Clic derecho: menú con sus acciones.
//
// La detección (./detect + ./evidence) es automática y todo esto es event-driven: sin
// polling, y sin temporizadores vivos mientras no haya juego.

interface GameEntry {
  address: string
  class: string
  name: string
  gicon: Gio.Icon | null
  iconName: string | null
}

function toEntry(c: any): GameEntry {
  const look = describeGame(c)
  return {
    address: c.address ?? "",
    class: c.class ?? "",
    name: look.name,
    gicon: look.gicon,
    iconName: look.iconName,
  }
}

export default function GamesIndicator() {
  const hypr = AstalHyprland.get_default()

  // Fuente de verdad: address -> juego. La lista pintada se deriva de ella.
  const games = new Map<string, GameEntry>()
  // Suscripciones al título de cada juego (el nombre real de un juego de Steam llega
  // a veces después del mapeo de la ventana): hay que soltarlas al cerrarse.
  const titleHooks = new Map<string, { client: any; id: number }>()

  const [list, setList] = createState<GameEntry[]>([])
  const sync = () => setList([...games.values()])

  const popovers: Gtk.Popover[] = []

  // Añade un cliente si es un juego y no está ya. Devuelve si cambió el conjunto.
  // Nunca quita: un juego detectado vive hasta que su ventana se cierra.
  const addIfGame = (c: any): boolean => {
    if (!c || !c.address || games.has(c.address)) return false
    if (!isGameClient(c)) return false

    games.set(c.address, toEntry(c))

    // El título puede llegar tarde (Steam mapea la ventana y luego la titula), y de él
    // sale el nombre del juego cuando no hay entrada .desktop.
    try {
      const id = c.connect("notify::title", () => {
        const cur = games.get(c.address)
        if (!cur) return
        const look = describeGame(c)
        if (look.name === cur.name && look.iconName === cur.iconName) return
        games.set(c.address, { ...cur, name: look.name, gicon: look.gicon, iconName: look.iconName })
        sync()
      })
      titleHooks.set(c.address, { client: c, id })
    } catch (_) {}

    sync()
    return true
  }

  const forget = (address: string) => {
    const hook = titleHooks.get(address)
    if (hook) {
      try { hook.client.disconnect(hook.id) } catch (_) {}
      titleHooks.delete(address)
    }
    if (games.delete(address)) sync()
  }

  // Barrido único al arrancar el shell, por si ya hay juegos abiertos.
  for (const c of (hypr.get_clients?.() ?? [])) addIfGame(c)

  hypr.connect("client-added", (_s, client) => {
    if (addIfGame(client)) return
    // class / fullscreen pueden resolverse un instante después del mapeo. UN solo
    // re-chequeo tardío, y solo si la clase aún no está — abrir ventanas normales (un
    // terminal, un editor) no arranca ningún temporizador.
    if (!client || !client.class) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        addIfGame(client)
        return GLib.SOURCE_REMOVE
      })
    }
  })

  // client-removed pasa la dirección (string), no un objeto Client.
  hypr.connect("client-removed", (_s, address: string) => forget(address))

  // Muchos juegos nativos solo se vuelven detectables al ir a pantalla completa.
  // Hyprland no expone una señal de fullscreen ya parseada, así que filtramos el
  // stream genérico `event`. La guarda es una comparación de strings O(1), así que en
  // reposo no cuesta nada. Este camino solo AÑADE: un juego ya detectado se queda
  // hasta que su ventana cierra, así que salir de fullscreen no hace parpadear nada.
  hypr.connect("event", (_s, name: string) => {
    if (name !== "fullscreen") return
    addIfGame(hypr.focusedClient)
  })

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
        if (live && (live.fullscreen ?? 0) < FULLSCREEN_REAL) {
          return execAsync(["hyprctl", "dispatch", "fullscreen", "0"])
        }
      })
      .catch(() => {})
  }

  const closeGame = (address: string) => {
    const addr = address.startsWith("0x") ? address : `0x${address}`
    execAsync(["hyprctl", "dispatch", "closewindow", `address:${addr}`]).catch(() => {})
  }

  onCleanup(() => {
    for (const address of [...titleHooks.keys()]) {
      const hook = titleHooks.get(address)
      if (hook) { try { hook.client.disconnect(hook.id) } catch (_) {} }
    }
    titleHooks.clear()
    for (const p of [...popovers]) { try { p.popdown() } catch (_) {} }
  })

  // Un botón por juego: icono real de la app y, con el clic derecho, sus acciones.
  const GameButton = (entry: GameEntry) => {
    let btnRef: Gtk.Widget | null = null
    let activePopover: Gtk.Popover | null = null
    const autoClose = panelAutoClose(() => { if (activePopover) activePopover.popdown() }, 250)
    const tooltipName = entry.name.replace(/(?:\s*\([^()]*\))+\s*$/, "").trim() || entry.name

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
      popovers.push(pop)
      openBarMenu()
      pop.connect("closed", () => {
        activePopover = null
        const i = popovers.indexOf(pop)
        if (i >= 0) popovers.splice(i, 1)
        try { pop.unparent() } catch (_) {}
        closeBarMenu()
      })
      pop.popup()
    }

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
          <label cssClasses={["game-tray-glyph"]} label={GAME_GLYPH} />
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
