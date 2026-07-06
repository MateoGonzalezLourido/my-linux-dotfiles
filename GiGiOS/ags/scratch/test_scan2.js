import AstalBluetooth from "gi://AstalBluetooth"
import GLib from "gi://GLib"

const bt = AstalBluetooth.get_default()

function printDevices() {
    const devs = bt.get_devices()
    console.log(`[${new Date().toISOString()}] Devices count: ${devs.length}`)
    devs.forEach(d => console.log(`  - ${d.address} ${d.name || d.alias}`))
}

printDevices()

if (bt.adapter) {
    console.log("Starting discovery via adapter...")
    bt.adapter.start_discovery()
} else {
    console.log("No adapter found!")
}

let count = 0
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    printDevices()
    count++
    if (count > 5) {
        if (bt.adapter) bt.adapter.stop_discovery()
        return GLib.SOURCE_REMOVE
    }
    return GLib.SOURCE_CONTINUE
})
