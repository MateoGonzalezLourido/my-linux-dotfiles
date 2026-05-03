import AstalBattery from "gi://AstalBattery"
import { createBinding } from "ags"

function batIcon(pct: number, charging: boolean) {
  if (charging)  return "󰂄"
  if (pct > 90)  return "󰁹"
  if (pct > 70)  return "󰂀"
  if (pct > 40)  return "󰁾"
  if (pct > 20)  return "󰁼"
  return "󰁺"
}

const LABEL_CSS = "color: #e2e2e2; font-family: 'JetBrains Mono'; font-size: 12px; font-weight: 600;"
const ICON_CSS  = "color: #e2e2e2; font-family: 'JetBrainsMono Nerd Font'; font-size: 13px;"
const ICON_CRIT = "color: #f38ba8; font-family: 'JetBrainsMono Nerd Font'; font-size: 13px;"
const LABEL_CRIT = "color: #f38ba8; font-family: 'JetBrains Mono'; font-size: 12px; font-weight: 600;"

export default function Battery() {
  const bat = AstalBattery.get_default()
  const pct = createBinding(bat, "percentage")

  return (
    <box css="padding: 0 4px;" spacing={4}>
      <label
        css={pct((p) => p * 100 < 15 ? ICON_CRIT : ICON_CSS)}
        label={pct((p) => batIcon(Math.round(p * 100), bat.charging))}
      />
      <label
        css={pct((p) => p * 100 < 15 ? LABEL_CRIT : LABEL_CSS)}
        label={pct((p) => `${Math.round(p * 100)}%`)}
      />
    </box>
  )
}

