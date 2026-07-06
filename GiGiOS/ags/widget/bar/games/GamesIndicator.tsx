import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import { createState, For } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

import { isGame } from "./detect"
import { getIcon } from "../appIcons"

// Purple container to the right of the workspaces that shows one icon per
// running videogame. Detection is automatic (see ./detect) and fully
// event-driven: no polling, and no timers stay alive while no game is running.

interface GameEntry {
  class: string
  title: string
  address: string
}

function toEntry(c: any): GameEntry {
  return {
    class: c.class ?? "",
    title: c.title ?? "",
    address: c.address ?? "",
  }
}

function formatGameName(cls: string, title: string): string {
  const clean = (title ?? "").trim()
  if (clean && !cls.toLowerCase().includes("steam_app_") && clean.length < 40) return clean
  if (clean && cls.toLowerCase().includes("steam_app_")) return clean
  if (cls.toLowerCase().includes("steam_app_")) return "Steam Game"
  return cls
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim() || "Juego"
}

export default function GamesIndicator() {
  const hypr = AstalHyprland.get_default()

  // Source of truth: address -> game. The rendered list is derived from it.
  const games = new Map<string, GameEntry>()
  const [list, setList] = createState<GameEntry[]>([])
  const sync = () => setList([...games.values()])

  // Adds a client if it's a game and isn't already tracked. Returns whether the
  // set changed. Never removes — a detected game lives until its window closes.
  const addIfGame = (c: any): boolean => {
    if (!c || !c.address || games.has(c.address)) return false
    if (!isGame(c)) return false
    games.set(c.address, toEntry(c))
    sync()
    return true
  }

  // One-time startup scan for games already running when the shell loads.
  for (const c of (hypr.get_clients?.() ?? [])) addIfGame(c)

  hypr.connect("client-added", (_s, client) => {
    if (addIfGame(client)) return
    // class / fullscreen may resolve a moment after mapping. Schedule ONE late
    // recheck, and only when the class is still unresolved — so opening ordinary
    // windows (a terminal, an editor) never starts a timer.
    if (!client || !client.class) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        addIfGame(client)
        return GLib.SOURCE_REMOVE
      })
    }
  })

  // client-removed passes the address string directly (not a Client object).
  hypr.connect("client-removed", (_s, address: string) => {
    if (games.delete(address)) sync()
  })

  // Native games often become detectable only once they go fullscreen. Hyprland
  // exposes no parsed fullscreen signal, so we filter the generic `event`
  // stream. The guard is an O(1) string compare, so it costs nothing measurable
  // while idle. This path only ever ADDS: a tracked game stays until its window
  // closes, so leaving fullscreen never makes the icon flicker.
  hypr.connect("event", (_s, name: string) => {
    if (name !== "fullscreen") return
    addIfGame(hypr.focusedClient)
  })

  // Jump to the game: focus its window (which brings us to its workspace), then
  // make it fullscreen if it currently isn't (state read live from the cache).
  const goToGame = (address: string) => {
    const addr = address.startsWith("0x") ? address : `0x${address}`
    execAsync(["hyprctl", "dispatch", "focuswindow", `address:${addr}`])
      .then(() => {
        const live = hypr.get_clients().find((c: any) => c.address === address)
        if (live && (live.fullscreen ?? 0) === 0) {
          return execAsync(["hyprctl", "dispatch", "fullscreen", "0"])
        }
      })
      .catch(() => {})
  }

  return (
    <box
      cssClasses={["game-tray"]}
      visible={list((g) => g.length > 0)}
      valign={Gtk.Align.CENTER}
      spacing={2}
    >
      <For each={list}>
        {(entry: GameEntry) => (
          <button
            cssClasses={["game-tray-icon"]}
            valign={Gtk.Align.CENTER}
            onClicked={() => goToGame(entry.address)}
            tooltipText={`${formatGameName(entry.class, entry.title)}\nClick para ir al juego (fullscreen)`}
          >
            <label label={getIcon(entry.class) || "󰊴"} />
          </button>
        )}
      </For>
    </box>
  )
}
