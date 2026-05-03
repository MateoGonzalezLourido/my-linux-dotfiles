import AstalHyprland from "gi://AstalHyprland"
import { createBinding } from "ags"

const APP_ICONS: Record<string, string> = {
  "firefox":            "󰈹",
  "kitty":              "",
  "code":               "󰨞",
  "code-oss":           "󰨞",
  "thunar":             "󰉋",
  "steam":              "󰓓",
  "discord":            "󰙯",
  "spotify":            "󰓇",
  "telegram-desktop":   "",
  "obsidian":           "󰂺",
  "gimp":               "",
  "vlc":                "󰕼",
  "nautilus":           "󰉋",
}

export default function FocusedClient() {
  const hypr   = AstalHyprland.get_default()
  const client = createBinding(hypr, "focusedClient")

  return (
    <label
      cssName="focused-client"
      label={client((c) => {
        const cls = (c?.initialClass ?? "").toLowerCase()
        return APP_ICONS[cls] ?? ""
      })}
      visible={client((c) => {
        const cls = (c?.initialClass ?? "").toLowerCase()
        return cls in APP_ICONS
      })}
    />
  )
}
