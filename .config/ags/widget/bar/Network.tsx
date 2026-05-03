import AstalNetwork from "gi://AstalNetwork"
import { createBinding } from "ags"
import { execAsync } from "ags/process"

function strengthIcon(s: number) {
  if (s >= 80) return "󰤨"
  if (s >= 60) return "󰤥"
  if (s >= 40) return "󰤢"
  if (s >= 20) return "󰤟"
  return "󰤯"
}

const BTN = "border: none; padding: 0 6px; margin: 0 1px;"
const ICON_ON  = "font-family: 'JetBrainsMono Nerd Font'; font-size: 14px; color: #89b4fa;"
const ICON_OFF = "font-family: 'JetBrainsMono Nerd Font'; font-size: 14px; color: rgba(226,226,226,0.45);"

export default function Network() {
  const network = AstalNetwork.get_default()
  const wifi    = network.wifi
  if (!wifi) return <label css={`${BTN} ${ICON_OFF}`} label="󰤭" />

  const strength = createBinding(wifi, "strength")
  const internet = createBinding(wifi, "internet")

  return (
    <button
      css={BTN}
      onClicked={() => execAsync(["bash", "-c", `${SRC}/scripts/wifi-panel.sh`])}
    >
      <label
        css={internet((i) => i === AstalNetwork.Internet.CONNECTED ? ICON_ON : ICON_OFF)}
        label={strength((s) => strengthIcon(s ?? 0))}
      />
    </button>
  )
}

