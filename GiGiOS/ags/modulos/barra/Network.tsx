import AstalNetwork from "gi://AstalNetwork"
import { For, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { barVisible, widgetsRefresh } from "../../estado/shell"

const BARS = 4
const ETHERNET_GLYPH = "󰈀"   // nf-md-ethernet

function activeBars(strength: number) {
  if (strength >= 80) return 4
  if (strength >= 60) return 3
  if (strength >= 35) return 2
  if (strength >= 15) return 1
  return 0
}

// Dos ejes derivados puramente de señales (sin polling):
//   kind    → qué medio está activo (cable / wifi / ninguno)
//   quality → calidad del enlace activo (internet real, portal, sin internet)
type NetKind    = "wired" | "wifi" | "none"
type NetQuality = "connected" | "portal" | "limited" | "offline"

// Las barras solo tienen sentido para wifi; con cable se muestra un glyph. Si no
// hay ningún enlace activo, el widget completo se oculta (no se representa una
// Wi-Fi inexistente mediante barras vacías).
function barClasses(strength: number, kind: NetKind) {
  const active = kind === "wifi" ? activeBars(strength) : 0

  return Array.from({ length: BARS }, (_, i) => {
    const classes = ["network-bar", `bar-${i + 1}`]
    if (i < active) classes.push("active")
    return classes
  })
}

export default function Network() {
  const network = AstalNetwork.get_default()

  const P  = AstalNetwork.Primary
  const C  = AstalNetwork.Connectivity
  const DS = AstalNetwork.DeviceState

  const wiredUp = () => {
    const w = network.wired
    return !!w && w.state === DS.ACTIVATED
  }
  const wifiUp = () => {
    const w = network.wifi
    return !!w && !!w.ssid
  }

  // Criterio principal: network.primary (lo que NM enruta). Si primary viene
  // UNKNOWN/inconsistente, se resuelve por disponibilidad, con cable preferente.
  const computeKind = (): NetKind => {
    if (network.primary === P.WIRED && wiredUp()) return "wired"
    if (network.primary === P.WIFI  && wifiUp())  return "wifi"
    if (wiredUp()) return "wired"
    if (wifiUp())  return "wifi"
    return "none"
  }

  // connectivity es global en NM: aplica al medio activo sea cable o wifi.
  const computeQuality = (kind: NetKind): NetQuality => {
    if (kind === "none") return "offline"
    switch (network.connectivity) {
      case C.PORTAL: return "portal"
      case C.LIMITED:
      case C.NONE:   return "limited"
      default:       return "connected"   // FULL / UNKNOWN
    }
  }

  const computeTip = (kind: NetKind, quality: NetQuality) => {
    const suffix = quality === "portal"  ? " · Inicia sesión (portal cautivo)"
                 : quality === "limited" ? " · Sin internet"
                 : ""
    if (kind === "wired") return `Ethernet${suffix}`
    if (kind === "wifi")  return `${network.wifi?.ssid || "Wi-Fi"}${suffix}`
    return "Sin conexión"
  }

  const snapshot = () => {
    const kind = computeKind()
    const quality = computeQuality(kind)
    return {
      kind,
      quality,
      bars: barClasses(network.wifi?.strength ?? 0, kind),
      tip: computeTip(kind, quality),
    }
  }

  const [snap, setSnap] = createState(snapshot())
  const sync = () => setSnap(snapshot())

  // Mientras el bar está oculto no re-renderizamos: el último valor queda
  // "cacheado" en el estado del widget. Al volver visible (widgetsRefresh) se
  // recomputa desde el estado real de NetworkManager. Mismo patrón que Battery.
  const update = () => { if (!barVisible.get()) return; sync() }

  const wifi = network.wifi
  if (wifi) {
    wifi.connect("notify::strength", update)
    wifi.connect("notify::ssid", update)
    wifi.connect("notify::internet", update)
  }
  // El objeto Wired persiste mientras exista el dispositivo (aunque el cable esté
  // fuera → state UNAVAILABLE); basta suscribirse una vez a su state/internet.
  const wired = network.wired
  if (wired) {
    wired.connect("notify::state", update)
    wired.connect("notify::internet", update)
  }
  network.connect("notify::connectivity", update)
  network.connect("notify::primary", update)
  network.connect("notify::wired", update)
  network.connect("notify::wifi", update)

  // gnim invoca el callback sin argumentos → leer .get() (con `(v)` no sincronizaba).
  widgetsRefresh.subscribe(() => { if (widgetsRefresh.get()) sync() })

  return (
    <box
      cssClasses={snap((s) => ["network", s.kind === "wired" ? "wired" : s.quality])}
      valign={Gtk.Align.CENTER}
      tooltipText={snap((s) => s.tip)}
      visible={snap((s) => s.kind !== "none")}
    >
      <box
        cssClasses={snap((s) => s.kind === "none" ? ["network-bars", "offline"] : ["network-bars"])}
        spacing={1}
        valign={Gtk.Align.CENTER}
        visible={snap((s) => s.kind !== "wired")}
      >
        <For each={snap((s) => s.bars)}>
          {(classes) => <box cssClasses={classes} valign={Gtk.Align.END} />}
        </For>
      </box>
      <label
        cssClasses={["network-wired-glyph"]}
        label={ETHERNET_GLYPH}
        visible={snap((s) => s.kind === "wired")}
      />
      <label
        cssClasses={["network-status-glyph"]}
        label="󰀦"
        visible={snap((s) => s.quality === "portal" || s.quality === "limited")}
      />
    </box>
  )
}
