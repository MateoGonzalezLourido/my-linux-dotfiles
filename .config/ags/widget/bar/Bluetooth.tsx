import AstalBluetooth from "gi://AstalBluetooth"
import { createBinding } from "ags"

export default function Bluetooth() {
  const bt      = AstalBluetooth.get_default()
  const devices = createBinding(bt, "devices")

  return (
    <label
      cssName="bluetooth"
      label="󰂱"
      visible={devices((d) => d.some((dev) => dev.connected))}
    />
  )
}
