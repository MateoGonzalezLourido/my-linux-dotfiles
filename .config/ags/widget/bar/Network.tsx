import AstalNetwork from "gi://AstalNetwork"
import { For, createBinding, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

const BARS = 4

function activeBars(strength: number) {
  if (strength >= 80) return 4
  if (strength >= 60) return 3
  if (strength >= 35) return 2
  if (strength >= 15) return 1
  return 0
}

function barClasses(strength: number, connected: boolean) {
  const active = connected ? activeBars(strength) : 0

  return Array.from({ length: BARS }, (_, i) => {
    const classes = ["network-bar", `bar-${i + 1}`]
    if (i < active) classes.push("active")
    return classes
  })
}


export default function Network() {
  const network = AstalNetwork.get_default()
  const wifi    = network.wifi
  if (!wifi) {
    return (
      <box cssClasses={["network", "network-off"]} valign={Gtk.Align.CENTER}>
        <box cssClasses={["network-bars"]} spacing={1} valign={Gtk.Align.CENTER}>
          <For each={barClasses(0, false)}>
            {(classes) => <box cssClasses={classes} valign={Gtk.Align.END} />}
          </For>
        </box>
      </box>
    )
  }

  const internet = createBinding(wifi, "internet")
  const ssid = createBinding(wifi, "ssid")
  const [bars, setBars] = createState(
    barClasses(wifi.strength ?? 0, wifi.internet === AstalNetwork.Internet.CONNECTED)
  )

  const updateBars = () => {
    setBars(barClasses(wifi.strength ?? 0, wifi.internet === AstalNetwork.Internet.CONNECTED))
  }

  wifi.connect("notify::strength", updateBars)
  wifi.connect("notify::internet", updateBars)

  return (
    <button
      cssClasses={["network"]}
      tooltipText={ssid((s) => s || "Disconnected")}
      onClicked={() => execAsync(["bash", "-c", `${SRC}/scripts/wifi-panel.sh`])}
    >
      <box
        cssClasses={internet((i) => i === AstalNetwork.Internet.CONNECTED ? ["network-bars"] : ["network-bars", "offline"])}
        spacing={1}
        valign={Gtk.Align.CENTER}
      >
        <For each={bars}>
          {(classes) => <box cssClasses={classes} valign={Gtk.Align.END} />}
        </For>
      </box>
    </button>
  )
}
