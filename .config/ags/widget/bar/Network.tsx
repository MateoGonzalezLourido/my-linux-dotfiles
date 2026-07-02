import AstalNetwork from "gi://AstalNetwork"
import { For, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { barVisible, widgetsRefresh } from "../state"

const BARS = 4

function activeBars(strength: number) {
  if (strength >= 80) return 4
  if (strength >= 60) return 3
  if (strength >= 35) return 2
  if (strength >= 15) return 1
  return 0
}

// Estado de red que el bar necesita representar:
//   connected → asociado con internet real (FULL)
//   portal    → asociado pero requiere login (portal cautivo)
//   limited   → asociado pero sin internet real (LIMITED/NONE)
//   offline   → sin AP asociado
type NetState = "connected" | "portal" | "limited" | "offline"

function barClasses(strength: number, state: NetState) {
  const active = state === "offline" ? 0 : activeBars(strength)

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
          <For each={barClasses(0, "offline")}>
            {(classes) => <box cssClasses={classes} valign={Gtk.Align.END} />}
          </For>
        </box>
      </box>
    )
  }

  const C = AstalNetwork.Connectivity

  // Derivado puramente de señales: sin polling. El bar solo muestra; el clic cae
  // al botón del pill (Bar.tsx) que abre QuickSettings, donde está la gestión real.
  const computeState = (): NetState => {
    if (!wifi.ssid) return "offline"
    switch (network.connectivity) {
      case C.PORTAL: return "portal"
      case C.LIMITED:
      case C.NONE: return "limited"
      default: return "connected"   // FULL / UNKNOWN
    }
  }

  const computeTip = (s: NetState) => {
    const name = wifi.ssid || "Sin conexión"
    return s === "portal"  ? `${name} · Inicia sesión (portal cautivo)`
      : s === "limited" ? `${name} · Sin internet`
      : s === "offline" ? "Sin conexión"
      : name
  }

  const [state, setState] = createState<NetState>(computeState())
  const [bars, setBars] = createState(barClasses(wifi.strength ?? 0, computeState()))
  const [tip, setTip] = createState(computeTip(computeState()))

  const sync = () => {
    const s = computeState()
    setState(s)
    setBars(barClasses(wifi.strength ?? 0, s))
    setTip(computeTip(s))
  }

  // Mientras el bar está oculto no re-renderizamos: los últimos valores quedan
  // "cacheados" en el estado del widget. Al volver visible (widgetsRefresh) se
  // recomputa desde el estado real de NetworkManager. Mismo patrón que Battery/Volume.
  const update = () => { if (!barVisible.get()) return; sync() }

  wifi.connect("notify::strength", update)
  wifi.connect("notify::ssid", update)
  wifi.connect("notify::internet", update)
  network.connect("notify::connectivity", update)

  widgetsRefresh.subscribe((v) => { if (v) sync() })

  return (
    <box
      cssClasses={state((s) => ["network", s])}
      valign={Gtk.Align.CENTER}
      tooltipText={tip}
    >
      <box
        cssClasses={state((s) => s === "offline" ? ["network-bars", "offline"] : ["network-bars"])}
        spacing={1}
        valign={Gtk.Align.CENTER}
      >
        <For each={bars}>
          {(classes) => <box cssClasses={classes} valign={Gtk.Align.END} />}
        </For>
      </box>
      <label
        cssClasses={["network-status-glyph"]}
        label={state((s) => s === "portal" || s === "limited" ? "󰀦" : "")}
        visible={state((s) => s === "portal" || s === "limited")}
      />
    </box>
  )
}
