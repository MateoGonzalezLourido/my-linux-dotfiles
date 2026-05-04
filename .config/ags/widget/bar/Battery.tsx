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

export default function Battery() {
  const bat = AstalBattery.get_default()
  const pct = createBinding(bat, "percentage")

  return (
    <box cssClasses={["battery"]} spacing={4}>
      <label
        cssClasses={pct((p) => p * 100 < 15 ? ["icon-critical"] : ["icon-normal"])}
        label={pct((p) => batIcon(Math.round(p * 100), bat.charging))}
      />
      <label
        cssClasses={pct((p) => p * 100 < 15 ? ["label-critical","level-battery"] : ["label-normal","level-battery"])}
        label={pct((p) => `${Math.round(p * 100)}%`)}
      />
    </box>
  )
}

