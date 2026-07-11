// Pure predicate for the automatic "Do Not Disturb" watcher. No GTK/GLib
// imports — unit-tested with node:test.
//
// DND should be silenced when either:
//   1. a running client is a game (reuses the games heuristic in
//      widget/bar/games/detect.ts), or
//   2. a running client is fullscreen AND its class matches one of the
//      user-configured "fullscreen apps" (e.g. mpv, a browser watching a movie).
//
// The configured-apps path deliberately bypasses the game heuristic's
// fullscreen blocklist: adding "mpv" here means a fullscreen movie silences
// notifications even though mpv is not a game.
//
// Workspace awareness: in Hyprland a game can sit fullscreen on workspace 1
// while you're browsing on workspace 2. DND must only kick in for the game you
// are actually looking at, so shouldSilence() filters clients to the focused
// workspace (see the `activeWorkspaceId` argument).

import { isGame, type GameClientLike } from "../../bar/games/detect.ts"

export interface WorkspaceRef {
  id?: number | null
}

export type DndClientLike = GameClientLike & {
  workspace?: WorkspaceRef | null
}

/**
 * True if `c` lives on the currently focused workspace. When we don't know the
 * active workspace (`activeWorkspaceId` null/undefined) we don't filter — the
 * caller opted out of workspace awareness. A client whose workspace is unknown
 * is also kept, to avoid silently regressing to "never silence".
 */
function onActiveWorkspace(
  c: DndClientLike | null | undefined,
  activeWorkspaceId: number | null | undefined,
): boolean {
  if (activeWorkspaceId == null) return true
  const wsId = c?.workspace?.id
  if (wsId == null) return true
  return wsId === activeWorkspaceId
}

/** True if `c` is fullscreen and its class matches any entry in `apps`. */
export function matchesFullscreenApp(
  c: DndClientLike | null | undefined,
  apps: readonly string[],
): boolean {
  if (!c) return false
  const isFullscreen = !!(c.fullscreen && c.fullscreen !== 0)
  if (!isFullscreen) return false

  const cls = (c.class ?? "").toLowerCase()
  const initCls = (c.initialClass ?? c.initial_class ?? "").toLowerCase()
  if (!cls && !initCls) return false

  return apps.some((a) => {
    const needle = a.trim().toLowerCase()
    return needle.length > 0 && (cls.includes(needle) || initCls.includes(needle))
  })
}

/**
 * True if any client on the focused workspace warrants auto-DND (a game, or a
 * configured fullscreen app). Pass `activeWorkspaceId` to restrict evaluation to
 * that workspace; omit it (or pass null) to consider every client.
 */
export function shouldSilence(
  clients: readonly (DndClientLike | null | undefined)[] | null | undefined,
  apps: readonly string[],
  activeWorkspaceId?: number | null,
): boolean {
  if (!clients) return false
  for (const c of clients) {
    if (!onActiveWorkspace(c, activeWorkspaceId)) continue
    if (isGame(c)) return true
    if (matchesFullscreenApp(c, apps)) return true
  }
  return false
}
