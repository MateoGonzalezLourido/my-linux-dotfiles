import AstalBluetooth from "gi://AstalBluetooth"
const bt = AstalBluetooth.get_default()

const devs = bt.get_devices()
console.log(`Found ${devs.length} devices`)
devs.forEach(d => {
    console.log(`- address: ${d.address}, name: ${d.name}, alias: ${d.alias}, connected: ${d.connected}, paired: ${d.paired}`)
})

