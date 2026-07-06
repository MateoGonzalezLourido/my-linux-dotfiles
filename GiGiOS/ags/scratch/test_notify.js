import AstalBluetooth from "gi://AstalBluetooth"
const bt = AstalBluetooth.get_default()
bt.connect("notify::devices", () => console.log("notify::devices emitted!"))
bt.connect("device-added", () => console.log("device-added emitted!"))
bt.adapter?.start_discovery()
console.log("Started discovery")
