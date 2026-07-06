// Pure game-detection heuristic. No GTK/GLib imports — unit-tested with node:test.
//
// Automatic detection (no gamemode / Steam available as a source of truth):
//   - strong signals in the window class (steam_app_, gamescope, wine, ...)
//   - a fullscreen window whose class is not a known non-game app

export interface GameClientLike {
  class?: string | null
  initialClass?: string | null
  initial_class?: string | null
  title?: string | null
  fullscreen?: number | null
}

// Substrings that, when present in the class, mark a window as a game.
// ".exe" is handled separately (suffix) since wine windows use the binary name.
const CLASS_SIGNALS = [
  "steam_app_",
  "gamescope",
  "wine",
  "proton",
  "lutris",
  "heroic",
]

// Classes that are commonly fullscreen but are NOT games. Matched as substrings
// so "brave-browser", "google-chrome", etc. are covered.
const FULLSCREEN_BLOCKLIST = [
  // browsers
  "firefox", "chrome", "chromium", "brave", "zen", "librewolf", "vivaldi",
  "opera", "epiphany",
  // media players / viewers
  "mpv", "vlc", "imv", "feh", "eog", "loupe", "gwenview", "mpvpaper",
  // terminals
  "kitty", "foot", "alacritty", "wezterm", "konsole", "ghostty", "st",
  // other obvious non-game fullscreen apps
  "obs", "code", "code-oss", "zoom", "spotify",
]

function classSignal(cls: string): boolean {
  if (cls.endsWith(".exe")) return true
  return CLASS_SIGNALS.some((sig) => cls.includes(sig))
}

export function isGame(c: GameClientLike | null | undefined): boolean {
  if (!c) return false

  const cls = (c.class ?? "").toLowerCase()
  const initCls = (c.initialClass ?? c.initial_class ?? "").toLowerCase()

  // 1. Strong class signals (steam_app_, gamescope, wine, .exe, ...)
  if (classSignal(cls) || classSignal(initCls)) return true

  // 2. Weak fullscreen signal: a fullscreen window that isn't a known non-game.
  const isFullscreen = !!(c.fullscreen && c.fullscreen !== 0)
  if (isFullscreen) {
    const inBlocklist = FULLSCREEN_BLOCKLIST.some(
      (app) => cls.includes(app) || initCls.includes(app),
    )
    if (!inBlocklist && (cls || initCls)) return true
  }

  return false
}
