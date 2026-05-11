import AstalNetwork from "gi://AstalNetwork"
const network = AstalNetwork.get_default()
console.log("Network properties:", Object.keys(network).join(", "))
if (network.wifi) {
    console.log("Wifi properties:", Object.keys(network.wifi).join(", "))
}
console.log("Connectivity:", network.connectivity)
