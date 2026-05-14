import AstalBluetooth from "gi://AstalBluetooth"
import { Gtk } from "ags/gtk4"
import { createBinding } from "ags"

export default function Bluetooth() {
  const bt      = AstalBluetooth.get_default()
  const devices = createBinding(bt, "devices")

  return (
    <box
      cssClasses={["bluetooth-ind"]}
      visible={devices((d) => d.some((dev) => dev.connected))}
      valign={Gtk.Align.CENTER}
    >
      <label cssClasses={["bluetooth-icon"]} label="󰂱" />
    </box>
  )
}
