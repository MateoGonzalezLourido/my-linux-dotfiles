import AstalBluetooth from "gi://AstalBluetooth"
const bt = AstalBluetooth.get_default()
console.log("adapter:", !!bt.adapter)
