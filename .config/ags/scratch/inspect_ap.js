import AstalNetwork from "gi://AstalNetwork"
const network = AstalNetwork.get_default()
if (network.wifi && network.wifi.get_access_points().length > 0) {
    const ap = network.wifi.get_access_points()[0]
    console.log("AP properties:", Object.keys(ap).join(", "))
}
