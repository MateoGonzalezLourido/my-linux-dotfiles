export type BluetoothDeviceInfo = {
  connected?: boolean
  alias?: string | null
  name?: string | null
  address?: string | null
  icon_name?: string | null
}

export function getBluetoothTileInfo(supported: boolean, powered: boolean, devices: BluetoothDeviceInfo[]) {
  if (!supported) return { label: "Incompatible", icon: "󰂲" }
  if (!powered) return { label: "Desactivado", icon: "󰂲" }

  const connected = devices.find((device) => device.connected)
  if (!connected) return { label: "Desconectado", icon: "󰂯" }

  let icon = "󰂱"
  const name = (connected.name || connected.alias || "").toLowerCase()
  if (name.includes("head") || name.includes("auric") || connected.icon_name?.includes("head")) icon = "󰋋"
  else if (name.includes("speak") || name.includes("altav") || connected.icon_name?.includes("speak")) icon = "󰓃"
  else if (name.includes("phone") || name.includes("móvil") || connected.icon_name?.includes("phone")) icon = "󰏲"

  return {
    label: connected.alias || connected.name || connected.address || "Conectado",
    icon,
  }
}
