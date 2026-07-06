import AstalBluetooth from "gi://AstalBluetooth"
const bt = AstalBluetooth.get_default()
console.log("Devices count:", bt.get_devices().length)
bt.get_devices().forEach(d => {
    console.log(d.name, d.alias, d.address, d.connected)
})
