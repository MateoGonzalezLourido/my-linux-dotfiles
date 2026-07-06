import AstalBluetooth from "gi://AstalBluetooth"
import { Gtk } from "ags/gtk4"
import { createBinding, createState } from "ags"

export default function Bluetooth() {
  const bt = AstalBluetooth.get_default()

  // Se muestra siempre que el adaptador esté encendido; si el BT está apagado se
  // oculta. El color lo decide `connected` (gris / morado) vía cssClasses.
  const powered = createBinding(bt, "isPowered")

  // isConnected trae su propia señal notify::is-connected. Antes la visibilidad
  // se derivaba de `devices`, que solo se emite al añadir/quitar dispositivos y
  // NO al conectar/desconectar uno ya emparejado: el estado quedaba pegado.
  const connected = createBinding(bt, "isConnected")

  // Nombre del dispositivo conectado, para el tooltip ("saber qué tengo puesto").
  const [name, setName] = createState("")
  const recompute = () => {
    const dev = bt.get_devices().find((d) => d.connected)
    setName(dev ? (dev.alias || dev.name || dev.address || "Bluetooth") : "Sin conectar")
  }

  // Enganchamos notify::connected/alias de cada dispositivo para reaccionar al
  // (des)conectar uno ya conocido. notify::devices no cubre ese caso.
  const hooked = new WeakSet<any>()
  const hookDevices = () => {
    for (const dev of bt.get_devices()) {
      if (hooked.has(dev)) continue
      hooked.add(dev)
      dev.connect("notify::connected", recompute)
      dev.connect("notify::alias", recompute)
    }
  }
  hookDevices()
  recompute()

  bt.connect("notify::devices", () => { hookDevices(); recompute() })
  bt.connect("device-added", () => { hookDevices(); recompute() })
  bt.connect("notify::is-connected", recompute)

  return (
    <box
      cssClasses={connected((c) => c ? ["bluetooth-ind", "connected"] : ["bluetooth-ind"])}
      visible={powered}
      valign={Gtk.Align.CENTER}
      tooltipText={name}
    >
      <label cssClasses={["bluetooth-icon"]} label="󰂱" />
    </box>
  )
}
