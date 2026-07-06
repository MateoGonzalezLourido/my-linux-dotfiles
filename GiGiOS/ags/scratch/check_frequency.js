import AstalNetwork from "gi://AstalNetwork"
const network = AstalNetwork.get_default()
if (network.wifi && network.wifi.get_access_points().length > 0) {
    const ap = network.wifi.get_access_points()[0]
    console.log(`SSID: ${ap.ssid}, Frequency: ${ap.frequency}MHz`)
}
