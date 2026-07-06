import AstalBluetooth from "gi://AstalBluetooth"

const bt = AstalBluetooth.get_default()
console.log("--- Bluetooth Adapter Info ---")
console.log("Is Powered:", bt.isPowered)
console.log("Devices Count:", bt.devices.length)

console.log("--- Devices List ---")
bt.devices.forEach(d => {
    console.log(`- ${d.alias || d.name} [${d.address}] (Connected: ${d.connected}, Paired: ${d.paired})`)
})

console.log("--- End ---")
process.exit(0)
