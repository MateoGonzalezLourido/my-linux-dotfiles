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


export default function Network() {
  const network = AstalNetwork.get_default()
  const wifi    = network.wifi
  if (!wifi) return <label cssClasses={["disconnected"]} label="󰤭" />

  const strength = createBinding(wifi, "strength")
  const internet = createBinding(wifi, "internet")

  return (
    <button
      cssClasses={["network"]}
      onClicked={() => execAsync(["bash", "-c", `${SRC}/scripts/wifi-panel.sh`])}
    >
      <label
        cssClasses={internet((i) => i === AstalNetwork.Internet.CONNECTED ? ["network-icon-on"] : ["network-icon-off"])}
        label={strength((s) => strengthIcon(s ?? 0))}
      />
    </button>
  )
}

