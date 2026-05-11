import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, For } from "ags"
import { createBinding } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import AstalWp from "gi://AstalWp"
import AstalNetwork from "gi://AstalNetwork"
import AstalBluetooth from "gi://AstalBluetooth"
import AstalNotifd from "gi://AstalNotifd"
import AstalMpris from "gi://AstalMpris"
import {
  quickSettingsVisible,
  closeAllPanels,
  nightLightActive,
  setNightLightActive,
  nightLightTemp,
  setNightLightTemp,
  qsView,
  setQsView,
  infoSsid,
  setInfoSsid
} from "./state"

// ── Persistence Utilities ──────────────────────────────────────────────────────
const PRESETS_PATH = `${GLib.get_user_config_dir()}/ags/config/audioPresets.json`

function loadAudioPresets(): Record<string, number> {
  try {
    const [ok, content] = GLib.file_get_contents(PRESETS_PATH)
    if (ok) return JSON.parse(new TextDecoder().decode(content))
  } catch (e) { }
  return {}
}

let saveTimeout: number | null = null

function saveAudioPresets(p: Record<string, number>) {
  if (saveTimeout !== null) {
    GLib.source_remove(saveTimeout)
  }
  saveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    try {
      const dir = GLib.path_get_dirname(PRESETS_PATH)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) {
        execAsync(["mkdir", "-p", dir]).catch(() => { })
      }
      GLib.file_set_contents(PRESETS_PATH, JSON.stringify(p))
    } catch (e) { }
    saveTimeout = null
    return GLib.SOURCE_REMOVE
  })
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function getTime() { return GLib.DateTime.new_now_local().format("%H:%M") ?? "" }
function getDate() { return GLib.DateTime.new_now_local().format("%A, %-d %B") ?? "" }
function clamp(v: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)) }
function toDb(v: number) {
  if (v <= 0.0001) return "-∞"
  // PulseAudio/Pipewire use a cubic curve for perceived volume
  // dB = 20 * log10(v^3) = 60 * log10(v)
  return (60 * Math.log10(v)).toFixed(0)
}

const getBand = (freq: number) => {
  if (freq >= 5900) return "6GHz"
  if (freq >= 4900) return "5GHz"
  if (freq > 0) return "2.4GHz"
  return "—"
}

/** Create a Gtk.Scale (0..1) that stays in sync with a reactive value. */
function makeScale(
  classes: string[],
  getValue: () => number,
  setValue: (v: number) => void,
  subscribe?: (cb: () => void) => void,
): Gtk.Scale {
  const adj = new Gtk.Adjustment({ lower: 0, upper: 1, stepIncrement: 0.01 })
  adj.value = clamp(getValue())
  if (subscribe) {
    subscribe(() => { adj.value = clamp(getValue()) })
  }
  const scale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: adj,
    drawValue: false,
    hexpand: true,
  })
  scale.cssClasses = classes

  scale.connect("change-value", (_self, _scroll, val) => {
    setValue(clamp(val))
    return false
  })
  return scale
}

// ── Section 1: Header ─────────────────────────────────────────────────────────

function QsHeader() {
  const notifd = AstalNotifd.get_default()
  const [time, setTime] = createState(getTime())
  const [date, setDate] = createState(getDate())
  const notifs = createBinding(notifd, "notifications")
  const dnd = createBinding(notifd, "dontDisturb")

  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    setTime(getTime())
    setDate(getDate())
    return GLib.SOURCE_CONTINUE
  })

  return (
    <box cssClasses={["qs-header"]} spacing={0}>
      <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} hexpand>
        <label cssClasses={["qs-clock"]} label={time} halign={Gtk.Align.START} />
        <label cssClasses={["qs-date"]} label={date} halign={Gtk.Align.START} />
      </box>
      <box spacing={6} valign={Gtk.Align.CENTER} halign={Gtk.Align.END}>
        <button
          cssClasses={dnd((d) => d ? ["qs-dnd-btn", "active"] : ["qs-dnd-btn"])}
          onClicked={() => { notifd.dontDisturb = !notifd.dontDisturb }}
          tooltipText="No molestar"
        >
          <label cssClasses={["qs-dnd-icon"]} label="󰪑" />
        </button>
        <button
          cssClasses={notifs((n) => n.length > 0 ? ["qs-notif-btn", "has-notifs"] : ["qs-notif-btn"])}
          tooltipText="Notificaciones"
        >
          <label cssClasses={["qs-notif-icon"]} label="󰂚" />
        </button>
      </box>
    </box>
  )
}

// ── Section 2: Tiles ──────────────────────────────────────────────────────────

// ── Section 2: Tiles ──────────────────────────────────────────────────────────

// ── Network Speed Logic (Global) ──────────────────────────────────────────────
const [netSpeed, setNetSpeed] = createState({ up: "0B", down: "0B" })
let lastBytes = { up: 0, down: 0, time: 0 }

const formatSpeed = (bytes: number) => {
  if (bytes < 1024) return `${Math.round(bytes)}B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
  if (!quickSettingsVisible.get()) return GLib.SOURCE_CONTINUE

  execAsync(["bash", "-c", "cat /proc/net/dev"]).then(out => {
    const lines = out.trim().split("\n")
    let totalDown = 0, totalUp = 0
    lines.forEach(line => {
      if (!line.includes(":")) return
      const [iface, data] = line.split(":")
      if (iface.includes("lo")) return

      const parts = data.trim().split(/\s+/)
      const down = parseInt(parts[0])
      const up = parseInt(parts[8])
      if (!isNaN(down)) totalDown += down
      if (!isNaN(up)) totalUp += up
    })

    const now = Date.now()
    if (lastBytes.time > 0) {
      const delta = (now - lastBytes.time) / 1000
      setNetSpeed({
        down: formatSpeed((totalDown - lastBytes.down) / delta),
        up: formatSpeed((totalUp - lastBytes.up) / delta)
      })
    }
    lastBytes = { down: totalDown, up: totalUp, time: now }
  }).catch(() => { })
  return GLib.SOURCE_CONTINUE
})

function QsTile({ icon, label, subtitle, active, onToggle, onSecondaryClick, onRightClick }: {
  icon: any, label: any, subtitle: any, active: any, onToggle: () => void, onSecondaryClick?: () => void, onRightClick?: () => void
}) {
  const classes = typeof active === "function"
    ? active((a: boolean) => a ? ["qs-tile", "active"] : ["qs-tile"])
    : (active ? ["qs-tile", "active"] : ["qs-tile"])
  return (
    <button cssClasses={classes} onClicked={onToggle}>
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onPressed={onRightClick}
      />
      <box spacing={6} valign={Gtk.Align.CENTER}>
        <label cssClasses={["qs-tile-icon"]} label={icon} />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={0} hexpand>
          <label cssClasses={["qs-tile-label"]} label={label} halign={Gtk.Align.START} />
          <label
            cssClasses={["qs-tile-sub"]}
            label={subtitle}
            halign={Gtk.Align.START}
            ellipsize={3}
          />
        </box>
        {onSecondaryClick && (
          <button cssClasses={["qs-tile-arrow"]} onClicked={(self) => {
            onSecondaryClick()
            // Stop propagation to prevent toggle
          }} halign={Gtk.Align.END}>
            <label label="󰅂" />
          </button>
        )}
      </box>
    </button>
  )
}

function QsTiles({ onWifiClick, onBluetoothClick, onDisplayClick, onAudioClick, onMicClick }: {
  onWifiClick: () => void,
  onBluetoothClick: () => void,
  onDisplayClick: () => void,
  onAudioClick: () => void,
  onMicClick: () => void
}) {
  const network = AstalNetwork.get_default()
  const wifi = network.wifi
  const bt = AstalBluetooth.get_default()
  const [dpmsOn, setDpmsOn] = createState(true)
  const [monitor, setMonitor] = createState("Monitor")

  // Bluetooth Icon logic
  const getBtInfo = (powered: boolean, devs: any[]) => {
    if (!powered) return { label: "Desactivado", icon: "󰂲" }
    const conn = devs.find(d => d.connected)
    if (!conn) return { label: "Desconectado", icon: "󰂯" }
    let icon = "󰂱" // default connected
    const name = (conn.name || conn.alias || "").toLowerCase()
    if (name.includes("head") || name.includes("auric") || conn.icon_name?.includes("head")) icon = "󰋋"
    else if (name.includes("speak") || name.includes("altav") || conn.icon_name?.includes("speak")) icon = "󰓃"
    else if (name.includes("phone") || name.includes("móvil") || conn.icon_name?.includes("phone")) icon = "󰏲"
    return { label: conn.alias || conn.name, icon }
  }

  const wifiEnabled = wifi ? createBinding(wifi, "enabled") : null
  const wifiConnected = wifi ? createBinding(wifi, "internet") : null
  const btPowered = createBinding(bt, "isPowered")
  const btDevices = createBinding(bt, "devices")

  // Bluetooth Info Unified State
  const [btInfoState, setBtInfoState] = createState(getBtInfo(bt.isPowered, bt.get_devices()))
  bt.connect("notify::is-powered", () => setBtInfoState(getBtInfo(bt.isPowered, bt.get_devices())))
  bt.connect("notify::devices", () => setBtInfoState(getBtInfo(bt.isPowered, bt.get_devices())))

  // Update monitor info
  const updateMonitor = () => {
    execAsync(["bash", "-c", "hyprctl activeworkspace -j | jq -r .monitor"]).then(m => setMonitor(m)).catch(() => { })
  }
  updateMonitor()
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => { updateMonitor(); return GLib.SOURCE_CONTINUE })

  const wp = AstalWp.get_default()
  const speaker = wp?.audio?.defaultSpeaker
  const mic = wp?.audio?.defaultMicrophone

  const speakerVol = speaker ? createBinding(speaker, "volume") : null
  const speakerMute = speaker ? createBinding(speaker, "mute") : null
  const micVol = mic ? createBinding(mic, "volume") : null
  const micMute = mic ? createBinding(mic, "mute") : null

  function volIcon(v: number, m: boolean) {
    if (m || v === 0) return "󰝟"
    if (v < 0.33) return "󰕿"
    if (v < 0.66) return "󰖀"
    return "󰕾"
  }

  return (
    <box cssClasses={["qs-tiles"]} spacing={6}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand>
        <QsTile
          icon="󰤨"
          label={wifi ? createBinding(wifi, "ssid")((s) => s || "Wi-Fi") : "Wi-Fi"}
          subtitle={netSpeed((s) => `󰇚${s.down} 󰕒${s.up}`)}
          active={wifiEnabled ? wifiEnabled : false}
          onToggle={onWifiClick}
          onSecondaryClick={onWifiClick}
          onRightClick={() => wifi && execAsync(["bash", "-c", wifi.enabled ? "nmcli radio wifi off" : "nmcli radio wifi on"])}
        />
        <QsTile
          icon={speakerVol && speakerMute ? speakerVol((v) => volIcon(v, speakerMute())) : "󰕾"}
          label="Volumen"
          subtitle={speakerVol ? speakerVol((v) => `${Math.round(v * 100)}`) : "—"}
          active={speakerMute ? speakerMute((m) => !m) : true}
          onToggle={onAudioClick}
          onSecondaryClick={onAudioClick}
          onRightClick={() => { if (speaker) speaker.mute = !speaker.mute }}
        />
        <QsTile
          icon="󰍹"
          label="Pantalla"
          subtitle={monitor}
          active={nightLightActive}
          onToggle={onDisplayClick}
          onSecondaryClick={onDisplayClick}
          onRightClick={() => {
            const next = !nightLightActive.get()
            setNightLightActive(next)
            if (next) execAsync(["bash", "-c", `pkill wlsunset; wlsunset -t ${nightLightTemp.get()} &`]).catch(() => { })
            else execAsync(["bash", "-c", "pkill wlsunset"]).catch(() => { })
          }}
        />
      </box>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand>
        <QsTile
          icon={btInfoState((i) => i.icon)}
          label="Bluetooth"
          subtitle={btInfoState((i) => i.label)}
          active={btPowered}
          onToggle={onBluetoothClick}
          onSecondaryClick={onBluetoothClick}
          onRightClick={() => execAsync(["bash", "-c", bt.isPowered ? "bluetoothctl power off" : "bluetoothctl power on"])}
        />
        <QsTile
          icon={micMute ? micMute((m) => m ? "󰍭" : "󰍬") : "󰍬"}
          label="Micrófono"
          subtitle={micVol ? micVol((v) => `${Math.round(v * 100)}`) : "—"}
          active={micMute ? micMute((m) => !m) : true}
          onToggle={onMicClick}
          onSecondaryClick={onMicClick}
          onRightClick={() => { if (mic) mic.mute = !mic.mute }}
        />
      </box>
    </box>
  )
}


// ── Section 3: Spotify Player ─────────────────────────────────────────────────

function QsSpotify() {
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />

  const [title, setTitle] = createState("Sin reproducción")
  const [artist, setArtist] = createState("")
  const [isPlaying, setIsPlaying] = createState(false)
  const [prog, setProg] = createState(0)
  const [hasPlayer, setHasPlayer] = createState(false)

  const update = () => {
    const p = mpris.players.find(p => p.bus_name.includes("spotify") || p.identity.toLowerCase().includes("spotify"))
    if (!p) {
      setHasPlayer(false)
      return
    }
    setHasPlayer(true)
    setTitle(p.title || "Sin título")
    setArtist(p.artist || "Artista desconocido")
    setIsPlaying(p.playback_status === AstalMpris.PlaybackStatus.PLAYING)
    if (p.length > 0) setProg(p.position / p.length)
  }

  // Initial update and interval
  update()
  const interval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    update()
    return GLib.SOURCE_CONTINUE
  })

  return (
    <box
      cssClasses={["qs-spotify"]}
      visible={hasPlayer}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
    >
      <box spacing={10}>
        <label cssClasses={["qs-spotify-art"]} label="󰎈" />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label cssClasses={["qs-spotify-title"]} label={title} halign={Gtk.Align.START} ellipsize={3} />
          <label cssClasses={["qs-spotify-artist"]} label={artist} halign={Gtk.Align.START} ellipsize={3} />
        </box>
        <box spacing={2} valign={Gtk.Align.CENTER}>
          <button cssClasses={["qs-spotify-btn"]} tooltipText="Añadir a la biblioteca">
            <label label="⊕" />
          </button>
          <button cssClasses={["qs-spotify-btn"]} onClicked={() => execAsync("playerctl previous")}>
            <label label="󰒮" />
          </button>
          <button cssClasses={["qs-spotify-btn"]} onClicked={() => execAsync("playerctl play-pause")}>
            <label label={isPlaying((v) => v ? "󰏤" : "󰐊")} />
          </button>
          <button cssClasses={["qs-spotify-btn"]} onClicked={() => execAsync("playerctl next")}>
            <label label="󰒭" />
          </button>
        </box>
      </box>
      <Gtk.ProgressBar
        cssClasses={["qs-spotify-progress"]}
        fraction={prog}
        hexpand
      />
    </box>
  )
}

// ── Section 4: Volume ─────────────────────────────────────────────────────────

function QsAudioMenu({ onBack }: { onBack: () => void }) {
  const wp = AstalWp.get_default()
  const [audioMode, setAudioMode] = createState<"devices" | "apps">("devices")
  const [streams, setStreams] = createState<any[]>([])
  const [lastInteraction, setLastInteraction] = createState(0)
  const [presets, setPresets] = createState<Record<string, number>>(loadAudioPresets())
  const handledStreams = new Set<number>()

  function volIcon(v: number, m: boolean) {
    if (m || v === 0) return "󰝟"
    if (v < 0.33) return "󰕿"
    if (v < 0.66) return "󰖀"
    return "󰕾"
  }

  function loadStreams() {
    if (Date.now() - lastInteraction.get() < 2500) return

    Promise.all([
      execAsync(["bash", "-c", "pactl -f json list sink-inputs 2>/dev/null"]).catch(() => "[]"),
      execAsync(["bash", "-c", "pactl -f json list clients 2>/dev/null"]).catch(() => "[]")
    ]).then(([inputsStr, clientsStr]) => {
      try {
        const inputs = JSON.parse(inputsStr)
        const clients = JSON.parse(clientsStr)
        const inputsArr = Array.isArray(inputs) ? inputs : (inputs ? [inputs] : [])
        const clientsArr = Array.isArray(clients) ? clients : (clients ? [clients] : [])

        const clientMap = new Map()
        clientsArr.forEach(c => clientMap.set(String(c.index), c))

        const activeAppNames = new Set<string>()
        const exclude = ["pactl", "gjs", "astal", "pipewire", "wireplumber", "xdg-desktop-portal", "hyprland", "gsd-color", "gjs-console", "pavucontrol"]

        const enhanced = inputsArr.map(si => {
          const client = clientMap.get(String(si.client))
          if (client) {
            si.properties = { ...client.properties, ...si.properties }
          }
          const name = si.properties?.["application.name"] || si.properties?.["node.name"] || "App"
          activeAppNames.add(name.toLowerCase())

          // Apply preset if new
          if (!handledStreams.has(si.index)) {
            const p = presets.get()[name.toLowerCase()]
            if (p !== undefined) {
              execAsync(["pactl", "set-sink-input-volume", `${si.index}`, `${Math.round(p * 100)}%`]).catch(() => { })
            }
            handledStreams.add(si.index)
          }
          return si
        })

        // Add silent apps
        const silentApps: any[] = []
        clientsArr.forEach(c => {
          const name = c.properties?.["application.name"]
          if (!name) return
          const lowerName = name.toLowerCase()
          if (activeAppNames.has(lowerName) || exclude.some(e => lowerName.includes(e))) return
          
          activeAppNames.add(lowerName) // Avoid duplicates
          silentApps.push({
            index: -1, // No active stream
            client: c.index,
            properties: c.properties,
            volume: null,
            isSilent: true
          })
        })

        setStreams([...enhanced, ...silentApps])
      } catch (e) {
        console.error("Parse error in loadStreams:", e)
        setStreams([])
      }
    }).catch((err) => {
      console.error("loadStreams error:", err)
      setStreams([])
    })
  }

  const speakers = createBinding(wp.audio, "speakers")
  const defaultSpeaker = createBinding(wp.audio, "defaultSpeaker")

  if (!wp.audio) return <box />

  return (
    <box cssClasses={["qs-audio-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box spacing={6} cssClasses={["qs-wifi-header"]} valign={Gtk.Align.CENTER}>
        <button cssClasses={["qs-icon-btn"]} onClicked={onBack}><label label="󰅁" /></button>
        <label cssClasses={["qs-section-label"]} label="Volumen" hexpand halign={Gtk.Align.START} />
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => {
            const next = audioMode.get() === "devices" ? "apps" : "devices"
            setAudioMode(next)
            if (next === "apps") {
              loadStreams()
              // Start periodic refresh
              const id = setInterval(loadStreams, 2000)
              const sub = audioMode.subscribe((v) => {
                if (v !== "apps") {
                  clearInterval(id)
                  sub()
                }
              })
            }
          }}
          tooltipText={audioMode((m) => m === "devices" ? "Mezcla de aplicaciones" : "Dispositivos de salida")}
        ><label label={audioMode((m) => m === "devices" ? "󰓃" : "󰋎")} /></button>
      </box>

      <Gtk.ScrolledWindow
        cssClasses={["qs-wifi-list-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vexpand
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={audioMode((m) => m === "devices")}>
            <label cssClasses={["qs-dropdown-header"]} label="DISPOSITIVOS DE SALIDA" halign={Gtk.Align.START} />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
              <For each={speakers}>
                {(s: AstalWp.Endpoint) => {
                  const vol = createBinding(s, "volume")
                  const mute = createBinding(s, "mute")
                  const scale = makeScale(
                    ["qs-slider", "speaker"],
                    () => s.volume,
                    (v) => { s.volume = v },
                    (cb) => { s.connect("notify::volume", cb) },
                  )

                  const isDefault = defaultSpeaker((d) => d?.id === s.id)
                  const activate = () => {
                    // Try multiple reliable methods to ensure it switches
                    execAsync(["wpctl", "set-default", String(s.id)]).catch(() => { })
                    if (s.name) execAsync(["pactl", "set-default-sink", s.name]).catch(() => { })
                    try { s.is_default = true } catch (e) { }
                  }

                  return (
                    <box orientation={Gtk.Orientation.VERTICAL} spacing={2} cssClasses={isDefault((d) => d ? ["qs-audio-item", "active"] : ["qs-audio-item"])}>
                      <button onClicked={activate} cssClasses={["qs-audio-card-btn"]}>
                        <box spacing={8} valign={Gtk.Align.CENTER}>
                          <label cssClasses={["qs-audio-icon"]} label={vol((v) => volIcon(v, s.mute))} />
                          <box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
                            <label cssClasses={["qs-audio-name"]} label={s.description || s.name || "Desconocido"} ellipsize={3} halign={Gtk.Align.START} />
                            <label cssClasses={["qs-audio-vol-text"]} label={vol((v) => `${Math.round(v * 100)} (${toDb(v)}dB)`)} halign={Gtk.Align.START} />
                          </box>
                          <box cssClasses={isDefault((d) => d ? ["qs-audio-radio", "active"] : ["qs-audio-radio"])} valign={Gtk.Align.CENTER}>
                            <box cssClasses={["qs-audio-radio-dot"]} visible={isDefault} />
                          </box>
                        </box>
                      </button>
                      {scale}
                    </box>
                  )
                }}
              </For>
            </box>
          </box>

          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={audioMode((m) => m === "apps")}>
            <label cssClasses={["qs-dropdown-header"]} label="MEZCLA DE APLICACIONES" halign={Gtk.Align.START} />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
              <For each={() => streams()}>
                {(si: any) => {
                  const props = si.properties || {}
                  const name = props["application.name"]
                    || props["node.name"]
                    || props["media.name"]
                    || props["application.process.binary"]
                    || "App"

                  const volObj = si.volume || {}
                  const channels = Object.keys(volObj)
                  const presetVal = presets.get()[name.toLowerCase()]
                  const initialVol = channels.length > 0
                    ? parseFloat((volObj[channels[0]].value_percent || "100%").replace("%", "")) / 100
                    : (presetVal !== undefined ? presetVal : 1.0)

                  const [currentVol, setCurrentVol] = createState(initialVol)

                  const isSpotify = name.toLowerCase().includes("spotify")
                  const streamScale = makeScale(
                    isSpotify ? ["qs-slider", "spotify"] : ["qs-slider", "app"],
                    () => currentVol.get(),
                    (v) => {
                      setCurrentVol(v)
                      setLastInteraction(Date.now())
                      // Update preset
                      const p = { ...presets.get() }
                      p[name.toLowerCase()] = v
                      setPresets(p)
                      saveAudioPresets(p)
                      // Apply to stream if active
                      if (si.index !== -1) {
                        execAsync(["pactl", "set-sink-input-volume", `${si.index}`, `${Math.round(v * 100)}%`]).catch(() => { })
                      }
                    },
                  )
                  const icon = props["application.icon_name"]
                    || props["window.icon_name"]
                    || name.toLowerCase()
                    || "audio-x-generic-symbolic"

                  return (
                    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-wifi-item"]} css="padding: 8px;">
                      <box spacing={8} valign={Gtk.Align.CENTER}>
                        <Gtk.Image iconName={icon} cssClasses={["qs-audio-icon"]} css="font-size: 1.2em; min-width: 24px;" />
                        <box orientation={Gtk.Orientation.VERTICAL} hexpand halign={Gtk.Align.START}>
                          <label cssClasses={["qs-section-label"]} label={name} halign={Gtk.Align.START} ellipsize={3} />
                        </box>
                        <label
                          cssClasses={["qs-section-pct"]}
                          label={currentVol((v) => `${Math.round(v * 100)}`)}
                          css={si.isSilent ? "opacity: 0.5;" : ""}
                        />
                      </box>
                      <box spacing={8}>
                        {streamScale}
                        {si.isSilent && <label label="󰝟" css="opacity: 0.3; font-size: 0.8em;" tooltipText="Aplicación en silencio/espera" />}
                      </box>
                    </box>
                  )
                }}
              </For>
            </box>
          </box>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}

function QsMicMenu({ onBack }: { onBack: () => void }) {
  const wp = AstalWp.get_default()
  const [audioMode, setAudioMode] = createState<"devices" | "apps">("devices")
  const [streams, setStreams] = createState<any[]>([])
  const [lastInteraction, setLastInteraction] = createState(0)
  const [presets, setPresets] = createState<Record<string, number>>(loadAudioPresets())
  const handledStreams = new Set<number>()

  if (!wp.audio) return <box />

  function loadMicStreams() {
    if (Date.now() - lastInteraction.get() < 2500) return

    Promise.all([
      execAsync(["bash", "-c", "pactl -f json list source-outputs 2>/dev/null"]).catch(() => "[]"),
      execAsync(["bash", "-c", "pactl -f json list clients 2>/dev/null"]).catch(() => "[]")
    ]).then(([inputsStr, clientsStr]) => {
      try {
        const inputs = JSON.parse(inputsStr)
        const clients = JSON.parse(clientsStr)
        const inputsArr = Array.isArray(inputs) ? inputs : (inputs ? [inputs] : [])
        const clientsArr = Array.isArray(clients) ? clients : (clients ? [clients] : [])

        const clientMap = new Map()
        clientsArr.forEach(c => clientMap.set(String(c.index), c))

        const activeAppNames = new Set<string>()
        const exclude = ["pactl", "gjs", "astal", "pipewire", "wireplumber", "xdg-desktop-portal", "hyprland", "gsd-color", "gjs-console", "pavucontrol"]

        const enhanced = inputsArr.map(si => {
          const client = clientMap.get(String(si.client))
          if (client) {
            si.properties = { ...client.properties, ...si.properties }
          }
          const name = si.properties?.["application.name"] || si.properties?.["node.name"] || "App"
          const key = `mic:${name.toLowerCase()}`
          activeAppNames.add(name.toLowerCase())

          // Apply preset if new
          if (!handledStreams.has(si.index)) {
            const p = presets.get()[key]
            if (p !== undefined) {
              execAsync(["pactl", "set-source-output-volume", `${si.index}`, `${Math.round(p * 100)}%`]).catch(() => { })
            }
            handledStreams.add(si.index)
          }
          return si
        })

        // Add silent apps
        const silentApps: any[] = []
        clientsArr.forEach(c => {
          const name = c.properties?.["application.name"]
          if (!name) return
          const lowerName = name.toLowerCase()
          if (activeAppNames.has(lowerName) || exclude.some(e => lowerName.includes(e))) return
          
          activeAppNames.add(lowerName)
          silentApps.push({
            index: -1,
            client: c.index,
            properties: c.properties,
            volume: null,
            isSilent: true
          })
        })

        setStreams([...enhanced, ...silentApps])
      } catch (e) {
        setStreams([])
      }
    }).catch(() => setStreams([]))
  }

  const microphones = createBinding(wp.audio, "microphones")
  const defaultMic = createBinding(wp.audio, "defaultMicrophone")

  return (
    <box cssClasses={["qs-mic-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box spacing={6} cssClasses={["qs-wifi-header"]} valign={Gtk.Align.CENTER}>
        <button cssClasses={["qs-icon-btn"]} onClicked={onBack}><label label="󰅁" /></button>
        <label cssClasses={["qs-section-label"]} label="Micrófono" hexpand halign={Gtk.Align.START} />
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => {
            const next = audioMode.get() === "devices" ? "apps" : "devices"
            setAudioMode(next)
            if (next === "apps") {
              loadMicStreams()
              const id = setInterval(loadMicStreams, 2000)
              const sub = audioMode.subscribe((v) => {
                if (v !== "apps") {
                  clearInterval(id)
                  sub()
                }
              })
            }
          }}
          tooltipText={audioMode((m) => m === "devices" ? "Mezcla de aplicaciones" : "Dispositivos de entrada")}
        ><label label={audioMode((m) => m === "devices" ? "󰓃" : "󰋎")} /></button>
      </box>

      <Gtk.ScrolledWindow
        cssClasses={["qs-wifi-list-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vexpand
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={audioMode((m) => m === "devices")}>
            <label cssClasses={["qs-dropdown-header"]} label="DISPOSITIVOS DE ENTRADA" halign={Gtk.Align.START} />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
              <For each={microphones}>
                {(m: AstalWp.Endpoint) => {
                  const vol = createBinding(m, "volume")
                  const mute = createBinding(m, "mute")
                  const scale = makeScale(
                    ["qs-slider", "mic"],
                    () => m.volume,
                    (v) => { m.volume = v },
                    (cb) => { m.connect("notify::volume", cb) },
                  )

                  const isDefault = defaultMic((d) => d?.id === m.id)
                  const activate = () => {
                    // Try multiple reliable methods to ensure it switches
                    execAsync(["wpctl", "set-default", String(m.id)]).catch(() => { })
                    if (m.name) execAsync(["pactl", "set-default-source", m.name]).catch(() => { })
                    try { m.is_default = true } catch (e) { }
                  }

                  return (
                    <box orientation={Gtk.Orientation.VERTICAL} spacing={2} cssClasses={isDefault((d) => d ? ["qs-audio-item", "active"] : ["qs-audio-item"])}>
                      <button onClicked={activate} cssClasses={["qs-audio-card-btn"]}>
                        <box spacing={8} valign={Gtk.Align.CENTER}>
                          <label cssClasses={["qs-audio-icon"]} label={mute((v) => v ? "󰍭" : "󰍬")} />
                          <box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
                            <label cssClasses={["qs-audio-name"]} label={m.description || m.name || "Desconocido"} ellipsize={3} halign={Gtk.Align.START} />
                            <label cssClasses={["qs-audio-vol-text"]} label={vol((v) => `${Math.round(v * 100)} (${toDb(v)}dB)`)} halign={Gtk.Align.START} />
                          </box>
                          <box cssClasses={isDefault((d) => d ? ["qs-audio-radio", "active"] : ["qs-audio-radio"])} valign={Gtk.Align.CENTER}>
                            <box cssClasses={["qs-audio-radio-dot"]} visible={isDefault} />
                          </box>
                        </box>
                      </button>
                      {scale}
                    </box>
                  )
                }}
              </For>
            </box>
          </box>

          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={audioMode((m) => m === "apps")}>
            <label cssClasses={["qs-dropdown-header"]} label="MEZCLA DE ENTRADAS" halign={Gtk.Align.START} />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
              <For each={() => streams()}>
                {(si: any) => {
                  const props = si.properties || {}
                  const name = props["application.name"]
                    || props["node.name"]
                    || props["media.name"]
                    || props["application.process.binary"]
                    || "App"
                  const key = `mic:${name.toLowerCase()}`

                  const volObj = si.volume || {}
                  const channels = Object.keys(volObj)
                  const presetVal = presets.get()[key]
                  const initialVol = channels.length > 0
                    ? parseFloat((volObj[channels[0]].value_percent || "100%").replace("%", "")) / 100
                    : (presetVal !== undefined ? presetVal : 1.0)

                  const [currentVol, setCurrentVol] = createState(initialVol)

                  const streamScale = makeScale(
                    ["qs-slider", "mic"],
                    () => currentVol.get(),
                    (v) => {
                      setCurrentVol(v)
                      setLastInteraction(Date.now())
                      const p = { ...presets.get() }
                      p[key] = v
                      setPresets(p)
                      saveAudioPresets(p)
                      if (si.index !== -1) {
                        execAsync(["pactl", "set-source-output-volume", `${si.index}`, `${Math.round(v * 100)}%`]).catch(() => { })
                      }
                    },
                  )
                  const icon = props["application.icon_name"]
                    || props["window.icon_name"]
                    || name.toLowerCase()
                    || "audio-input-microphone-symbolic"

                  return (
                    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-wifi-item"]} css="padding: 8px;">
                      <box spacing={8} valign={Gtk.Align.CENTER}>
                        <Gtk.Image iconName={icon} cssClasses={["qs-audio-icon"]} css="font-size: 1.2em; min-width: 24px;" />
                        <box orientation={Gtk.Orientation.VERTICAL} hexpand halign={Gtk.Align.START}>
                          <label cssClasses={["qs-section-label"]} label={name} halign={Gtk.Align.START} ellipsize={3} />
                        </box>
                        <label
                          cssClasses={["qs-section-pct"]}
                          label={currentVol((v) => `${Math.round(v * 100)}`)}
                          css={si.isSilent ? "opacity: 0.5;" : ""}
                        />
                      </box>
                      <box spacing={8}>
                        {streamScale}
                        {si.isSilent && <label label="󰍭" css="opacity: 0.3; font-size: 0.8em;" tooltipText="Aplicación en silencio/espera" />}
                      </box>
                    </box>
                  )
                }}
              </For>
            </box>
          </box>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}

// ── Section 5: Brightness ─────────────────────────────────────────────────────

function QsDisplayMenu({ onBack }: { onBack: () => void }) {
  const [monitors, setMonitors] = createState<any[]>([])
  const [brightness, setBrightness] = createState(0.5)

  const updateMonitors = () => {
    execAsync(["hyprctl", "monitors", "-j"]).then(out => {
      try { setMonitors(JSON.parse(out)) } catch { }
    }).catch(() => { })
  }

  updateMonitors()

  execAsync(["bash", "-c", "echo $(brightnessctl g) $(brightnessctl m)"]).then((out) => {
    const [cur, max] = out.trim().split(" ").map(Number)
    if (max > 0) setBrightness(cur / max)
  }).catch(() => { })

  const brightScale = makeScale(
    ["qs-slider", "brightness"],
    () => brightness.get(),
    (v) => {
      setBrightness(v)
      execAsync(["bash", "-c", `brightnessctl s ${Math.round(v * 100)}%`]).catch(() => { })
    },
    (cb) => brightness.subscribe(cb),
  )

  const tempScale = makeScale(
    ["qs-slider", "temperature"],
    () => (nightLightTemp.get() - 1500) / 4500,
    (v) => {
      const t = Math.round(v * 4500 + 1500)
      setNightLightTemp(t)
      if (nightLightActive.get()) {
        execAsync(["bash", "-c", `pkill wlsunset; wlsunset -t ${t} &`]).catch(() => { })
      }
    },
    (cb) => nightLightTemp.subscribe(cb),
  )

  nightLightTemp.subscribe(() => { tempScale.adjustment.value = (nightLightTemp.get() - 1500) / 4500 })

  return (
    <box cssClasses={["qs-display-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box spacing={6} cssClasses={["qs-wifi-header"]} valign={Gtk.Align.CENTER}>
        <button cssClasses={["qs-icon-btn"]} onClicked={onBack}><label label="󰅁" /></button>
        <label cssClasses={["qs-section-label"]} label="Pantalla y Brillo" hexpand halign={Gtk.Align.START} />
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => execAsync("hyprctl dispatch dpms toggle")}
          tooltipText="Apagar/Encender DPMS"
        ><label label="󰐥" /></button>
      </box>

      <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
        <label cssClasses={["qs-dropdown-header"]} label="MONITORES CONECTADOS" halign={Gtk.Align.START} />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <For each={() => monitors()}>
            {(m: any) => (
              <box cssClasses={["qs-sink-item"]} spacing={8}>
                <label cssClasses={["qs-sink-dot"]} label="●" visible={m.focused} />
                <box orientation={Gtk.Orientation.VERTICAL} hexpand>
                  <label cssClasses={["qs-sink-name"]} label={m.model || m.name} halign={Gtk.Align.START} />
                  <label label={`${m.width}x${m.height} @ ${m.refreshRate.toFixed(0)}Hz`} css="font-size: 0.8em; opacity: 0.5;" halign={Gtk.Align.START} />
                </box>
              </box>
            )}
          </For>
        </box>
      </box>

      <box cssClasses={["qs-section"]} orientation={Gtk.Orientation.VERTICAL} spacing={10} css="padding: 10px; margin-top: 4px;">
        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
          <box spacing={6}>
            <label cssClasses={["qs-section-icon", "bright"]} label="󰃟" />
            <label cssClasses={["qs-section-label"]} label="Brillo" hexpand halign={Gtk.Align.START} />
            <label cssClasses={["qs-section-pct"]} label={brightness((v) => `${Math.round(v * 100)}%`)} />
          </box>
          {brightScale}
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={4} css="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
          <box spacing={6}>
            <label cssClasses={["qs-section-icon", "night"]} label="󰌾" />
            <label cssClasses={["qs-section-label"]} label="Luz nocturna" hexpand halign={Gtk.Align.START} />
            <button
              cssClasses={nightLightActive((n) => n ? ["qs-toggle", "on"] : ["qs-toggle"])}
              onClicked={() => {
                const next = !nightLightActive.get()
                setNightLightActive(next)
                if (next) execAsync(["bash", "-c", `pkill wlsunset; wlsunset -t ${nightLightTemp.get()} &`]).catch(() => { })
                else execAsync(["bash", "-c", "pkill wlsunset"]).catch(() => { })
              }}
            >
              <box cssClasses={["qs-toggle-track"]}>
                <box cssClasses={nightLightActive((n) => n ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
              </box>
            </button>
          </box>
          {tempScale}
        </box>
      </box>
    </box>
  )
}

// ── Section 6: Footer ─────────────────────────────────────────────────────────

function QsFooter() {
  const user = GLib.get_user_name() ?? "user"
  const host = GLib.get_host_name() ?? "host"
  const initials = user.slice(0, 2).toUpperCase()

  const getAvatarPath = () => {
    const configDir = GLib.get_user_config_dir()
    const path = `${configDir}/ags/config/fotoPerfil.txt`
    try {
      const [ok, content] = GLib.file_get_contents(path)
      if (ok) {
        const str = new TextDecoder().decode(content).trim()
        if (str && GLib.file_test(str, GLib.FileTest.EXISTS)) {
          return str
        }
      }
    } catch (e) { }
    return null
  }

  const avatarPath = getAvatarPath()

  return (
    <box cssClasses={["qs-footer"]} spacing={10}>
      {avatarPath ? (
        <box
          cssClasses={["qs-avatar-img"]}
          css={`background-image: url("file://${avatarPath}");`}
          valign={Gtk.Align.CENTER}
          halign={Gtk.Align.CENTER}
        />
      ) : (
        <label cssClasses={["qs-avatar"]} label={initials} />
      )}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={1} hexpand>
        <label cssClasses={["qs-username"]} label={user} halign={Gtk.Align.START} />
        <label cssClasses={["qs-hostname"]} label={`@${host}`} halign={Gtk.Align.START} />
      </box>
      <button cssClasses={["qs-footer-btn"]} tooltipText="Configuración (próximamente)">
        <label label="󰒓" />
      </button>
      <button
        cssClasses={["qs-footer-btn"]}
        tooltipText="Cerrar sesión"
        onClicked={() => execAsync(["bash", "-c", `loginctl terminate-user ${user}`]).catch(() => { })}
      >
        <label label="󰍃" />
      </button>
    </box>
  )
}


// ── Bluetooth Menu ────────────────────────────────────────────────────────────
function QsBluetoothMenu({ onBack }: { onBack: () => void }) {
  const bt = AstalBluetooth.get_default()
  const btPowered = createBinding(bt, "isPowered")
  const [devices, setDevices] = createState<any[]>(bt.get_devices())
  const [scanning, setScanning] = createState(false)

  const update = () => setDevices(bt.get_devices())
  bt.connect("notify::devices", update)
  bt.connect("notify::is-powered", update)

  const scan = () => {
    if (scanning.get()) return
    setScanning(true)
    const interval = setInterval(update, 2000)
    execAsync(["bash", "-c", "timeout 15 bluetoothctl scan on"]).finally(() => {
      clearInterval(interval)
      setScanning(false)
      update()
    })
  }

  const getDeviceIcon = (dev: any) => {
    const name = (dev.name || dev.alias || "").toLowerCase()
    if (name.includes("head") || name.includes("auric") || dev.icon_name?.includes("head")) return "󰋋"
    if (name.includes("speak") || name.includes("altav") || dev.icon_name?.includes("speak")) return "󰓃"
    if (name.includes("phone") || name.includes("móvil") || dev.icon_name?.includes("phone")) return "󰏲"
    if (name.includes("mouse") || name.includes("ratón") || dev.icon_name?.includes("mouse")) return "󰍽"
    if (name.includes("keyboard") || name.includes("teclado") || dev.icon_name?.includes("keyboard")) return "󰌌"
    return "󰂯"
  }

  return (
    <box cssClasses={["qs-bluetooth-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box spacing={6} cssClasses={["qs-wifi-header"]} valign={Gtk.Align.CENTER}>
        <button cssClasses={["qs-icon-btn"]} onClicked={onBack}><label label="󰅁" /></button>
        <label cssClasses={["qs-section-label"]} label="Bluetooth" hexpand halign={Gtk.Align.START} />
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => execAsync("blueman-manager")}
          tooltipText="Ajustes avanzados"
        ><label label="󰒓" /></button>
        <button
          cssClasses={scanning((s) => s ? ["qs-icon-btn", "scanning"] : ["qs-icon-btn"])}
          onClicked={scan}
          tooltipText="Buscar dispositivos"
        ><label label="󰑐" /></button>
        <button
          cssClasses={btPowered((p) => p ? ["qs-toggle", "on"] : ["qs-toggle"])}
          onClicked={() => execAsync(["bash", "-c", bt.isPowered ? "bluetoothctl power off" : "bluetoothctl power on"])}
        >
          <box cssClasses={["qs-toggle-track"]}>
            <box cssClasses={btPowered((p) => p ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
          </box>
        </button>
      </box>

      <Gtk.ScrolledWindow
        cssClasses={["qs-wifi-list-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vexpand
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <For each={() => devices()}>
            {(dev: any) => (
              <button
                cssClasses={createBinding(dev, "connected")((c) => c ? ["qs-wifi-item", "active"] : ["qs-wifi-item"])}
                onClicked={() => {
                  if (dev.connected) {
                    dev.disconnect()
                  } else {
                    dev.connect()
                  }
                }}
              >
                <box spacing={8}>
                  <label cssClasses={["qs-wifi-icon"]} label={getDeviceIcon(dev)} />
                  <box orientation={Gtk.Orientation.VERTICAL} hexpand>
                    <label label={dev.alias || dev.name || "Unknown"} halign={Gtk.Align.START} ellipsize={3} cssClasses={["qs-wifi-name"]} />
                    <label
                      label={createBinding(dev, "connected")((c) => c ? "Conectado" : dev.paired ? "Vinculado" : "Disponible")}
                      halign={Gtk.Align.START}
                      cssClasses={["qs-wifi-sec"]}
                    />
                  </box>
                  {createBinding(dev, "connected")((c) => c && (
                    <label label="󰄬" cssClasses={["qs-wifi-lock"]} halign={Gtk.Align.END} />
                  ))}
                </box>
              </button>
            )}
          </For>
          <label
            label="No se encontraron dispositivos"
            css="opacity: 0.5; margin-top: 20px;"
            visible={devices((ds) => ds.length === 0)}
          />
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}

// ── WiFi Menu ─────────────────────────────────────────────────────────────────

function QsWifiMenu({ onBack }: { onBack: () => void }) {
  const network = AstalNetwork.get_default()
  const wifi = network.wifi
  const [scanning, setScanning] = createState(false)

  if (!wifi) return (
    <box cssClasses={["qs-wifi-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box spacing={6} cssClasses={["qs-wifi-header"]}>
        <button cssClasses={["qs-icon-btn"]} onClicked={onBack}><label label="󰅁" /></button>
        <label cssClasses={["qs-section-label"]} label="Wi-Fi" hexpand halign={Gtk.Align.START} />
      </box>
      <label label="No Wi-Fi device found" halign={Gtk.Align.CENTER} />
    </box>
  )

  const [apsVar, setApsVar] = createState<any[]>(wifi.get_access_points())
  wifi.connect("notify::access-points", () => setApsVar(wifi.get_access_points()))

  const [passwordTarget, setPasswordTarget] = createState<string | null>(null)
  const [passwordStr, setPasswordStr] = createState("")
  const [wifiState, setWifiState] = createState({ ssid: wifi.ssid || "", connecting: null as string | null })
  const [savedSsids, setSavedSsids] = createState<string[]>([])

  const getBand = (freq: number) => {
    if (freq >= 5900) return "6GHz"
    if (freq >= 4900) return "5GHz"
    if (freq > 0) return "2.4GHz"
    return "—"
  }

  const updateSaved = () => {
    execAsync(["bash", "-c", "nmcli -t -f NAME,TYPE connection show | grep 802-11-wireless | cut -d: -f1"])
      .then((out) => setSavedSsids(out.split("\n").filter(Boolean)))
      .catch(() => { })
  }
  updateSaved()
  savedSsids.subscribe(() => setWifiState({ ...wifiState() }))

  wifi.connect("notify::active-access-point", () => {
    setApsVar(wifi.get_access_points())
    setWifiState({ ...wifiState(), ssid: wifi.ssid || "" })
  })
  network.connect("notify::connectivity", () => {
    setWifiState({ ...wifiState() })
    updateSaved()
  })
  wifi.connect("notify::ssid", () => {
    setWifiState({ ...wifiState(), ssid: wifi.ssid || "" })
  })

  // Force cache population on startup
  execAsync(["nmcli", "device", "wifi", "list"]).then(() => {
    setApsVar(wifi.get_access_points())
  }).catch(e => console.error(e))

  const rescan = () => {
    if (scanning.get()) return
    setScanning(true)
    execAsync(["nmcli", "device", "wifi", "rescan"]).finally(() => {
      setTimeout(() => setScanning(false), 2000)
      updateSaved()
    })
  }

  const wifiEnabled = createBinding(wifi, "enabled")

  return (
    <box cssClasses={["qs-wifi-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box spacing={6} cssClasses={["qs-wifi-header"]} valign={Gtk.Align.CENTER}>
        <button cssClasses={["qs-icon-btn"]} onClicked={onBack}><label label="󰅁" /></button>
        <label cssClasses={["qs-section-label"]} label="Wi-Fi" hexpand halign={Gtk.Align.START} />
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => execAsync("nm-connection-editor")}
          tooltipText="Ajustes avanzados"
        ><label label="󰒓" /></button>
        <button
          cssClasses={scanning((s) => s ? ["qs-icon-btn", "scanning"] : ["qs-icon-btn"])}
          onClicked={rescan}
          tooltipText="Buscar redes"
        ><label label="󰑐" /></button>
        <button
          cssClasses={wifiEnabled((e) => e ? ["qs-toggle", "on"] : ["qs-toggle"])}
          onClicked={() => execAsync(["bash", "-c", wifi.enabled ? "nmcli radio wifi off" : "nmcli radio wifi on"])}
        >
          <box cssClasses={["qs-toggle-track"]}>
            <box cssClasses={wifiEnabled((e) => e ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
          </box>
        </button>
      </box>

      <Gtk.ScrolledWindow
        cssClasses={["qs-wifi-list-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vexpand
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <Gtk.GestureClick onPressed={() => setInfoSsid(null)} />
          <For each={() => {
            const seen = new Set()
            const unique = apsVar()
              .filter(ap => ap.ssid)
              .sort((a, b) => {
                const connected = wifiState.get().ssid
                if (a.ssid === connected) return -1
                if (b.ssid === connected) return 1
                return b.strength - a.strength
              })
              .filter(ap => {
                if (seen.has(ap.ssid)) return false
                seen.add(ap.ssid)
                return true
              })
            return unique
          }}>
            {(ap: any) => {
              const icon = ap.iconName || "network-wireless-signal-good-symbolic"
              const isSecure = ap.flags > 0 || ap.wpaFlags > 0 || ap.rsnFlags > 0

              let secType = "Abierta · Portal Cautivo"
              if (ap.rsnFlags > 0 && ap.wpaFlags > 0) secType = "WPA/WPA2"
              else if (ap.rsnFlags > 0) secType = "WPA2"
              else if (ap.wpaFlags > 0) secType = "WPA"
              else if (ap.flags > 0) secType = "WEP"

              if (passwordTarget() === ap.ssid) {
                const connectWithPassword = () => {
                  setWifiState({ ...wifiState(), connecting: ap.ssid })
                  setPasswordTarget(null)
                  execAsync(["bash", "-c", `timeout 10 nmcli device wifi connect "${ap.ssid}" password "${passwordStr()}"`])
                    .then(() => setWifiState({ ...wifiState(), connecting: null }))
                    .catch(e => {
                      console.error(e)
                      setWifiState({ ...wifiState(), connecting: null })
                      setPasswordTarget(ap.ssid) // prompt again
                    })
                }

                return (
                  <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["qs-wifi-item", "password-prompt"]} spacing={6} css="padding: 10px;">
                    <label label={`Contraseña para ${ap.ssid}`} halign={Gtk.Align.START} css="font-size: 0.9em;" />
                    <box spacing={6}>
                      <Gtk.Entry
                        placeholderText="Escribe y presiona Enter"
                        visibility={false}
                        hexpand
                        text={passwordStr()}
                        onChanged={(self) => setPasswordStr(self.text)}
                        onActivate={connectWithPassword}
                      />
                      <button cssClasses={["qs-icon-btn"]} onClicked={connectWithPassword} tooltipText="Conectar">
                        <label label="󰄬" />
                      </button>
                      <button cssClasses={["qs-icon-btn"]} onClicked={() => setPasswordTarget(null)} tooltipText="Cancelar">
                        <label label="󰅖" />
                      </button>
                    </box>
                  </box>
                )
              }
              return (
                <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
                  <button
                    cssClasses={wifiState((s) => {
                    const active = s.ssid === ap.ssid
                    const isPortal = active && network.connectivity === AstalNetwork.Connectivity.PORTAL
                    const isKnown = !active && savedSsids.get().includes(ap.ssid) && isSecure
                    return ["qs-wifi-item", active ? "active" : "", isPortal ? "portal" : "", isKnown ? "known" : ""].filter(Boolean)
                  })}
                  onClicked={() => {
                    if (wifiState().ssid === ap.ssid) {
                      if (network.connectivity === AstalNetwork.Connectivity.PORTAL) {
                        execAsync("xdg-open http://nmcheck.gnome.org/check_network_status.txt")
                      }
                      return
                    }
                    setWifiState({ ...wifiState(), connecting: ap.ssid })
                    // Intentar reactivar conexion guardada primero, si falla, intentar crear nueva conexion (max 10s wait)
                    execAsync(["bash", "-c", `timeout 5 nmcli connection up "${ap.ssid}" || timeout 10 nmcli device wifi connect "${ap.ssid}"`])
                      .then(() => setWifiState({ ...wifiState(), connecting: null }))
                      .catch(e => {
                        console.error("WiFi Connect Error:", e)
                        setWifiState({ ...wifiState(), connecting: null })
                        if (isSecure) {
                          setPasswordTarget(ap.ssid)
                          setPasswordStr("")
                        }
                      })
                  }}
                >
                  <Gtk.GestureClick
                    button={Gdk.BUTTON_SECONDARY}
                    onPressed={() => setInfoSsid(infoSsid() === ap.ssid ? null : ap.ssid)}
                  />
                  <box spacing={8}>
                    <Gtk.Image iconName={icon} cssClasses={["qs-wifi-icon"]} />
                    <box orientation={Gtk.Orientation.VERTICAL} hexpand>
                      <label label={ap.ssid} halign={Gtk.Align.START} ellipsize={3} cssClasses={["qs-wifi-name"]} />
                      <label label={netSpeed((ns) => {
                        const s = wifiState.get()
                        if (s.connecting === ap.ssid) return "Conectando..."
                        if (s.ssid === ap.ssid) {
                          if (network.connectivity === AstalNetwork.Connectivity.PORTAL) {
                            return "󰀦 Autenticación necesaria"
                          }
                          return `󰇚${ns.down} 󰕒${ns.up}`
                        }
                        return secType
                      })} halign={Gtk.Align.START} cssClasses={["qs-wifi-sec"]} />
                    </box>
                    <label
                      halign={Gtk.Align.END}
                      label={wifiState((s) => {
                        const active = s.ssid === ap.ssid
                        if (active && network.connectivity === AstalNetwork.Connectivity.PORTAL) return "󰅍"
                        if (isSecure && !active) return "󰌾"
                        return ""
                      })}
                      cssClasses={wifiState((s) => {
                        const active = s.ssid === ap.ssid
                        if (active && network.connectivity === AstalNetwork.Connectivity.PORTAL) return ["qs-wifi-portal-icon"]
                        if (isSecure && !active) return ["qs-wifi-lock"]
                        return []
                      })}
                      tooltipText={wifiState((s) => {
                        const active = s.ssid === ap.ssid
                        if (active && network.connectivity === AstalNetwork.Connectivity.PORTAL) return "Abrir portal cautivo"
                        return ""
                      })}
                      visible={wifiState((s) => {
                        const active = s.ssid === ap.ssid
                        return (active && network.connectivity === AstalNetwork.Connectivity.PORTAL) || (isSecure && !active)
                      })}
                    />
                  </box>
                </button>
                <revealer
                  revealChild={infoSsid((s) => s === ap.ssid)}
                  transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
                  transitionDuration={200}
                >
                  <box cssClasses={["qs-wifi-info-section"]} orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                    <box spacing={8}>
                      <label cssClasses={["qs-wifi-info-label"]} label="Banda:" />
                      <label cssClasses={["qs-wifi-info-value"]} label={getBand(ap.frequency)} />
                      <label cssClasses={["qs-wifi-info-sep"]} label="•" />
                      <label cssClasses={["qs-wifi-info-label"]} label="Frecuencia:" />
                      <label cssClasses={["qs-wifi-info-value"]} label={`${ap.frequency} MHz`} />
                    </box>
                    <box spacing={8}>
                      <label cssClasses={["qs-wifi-info-label"]} label="Señal:" />
                      <label cssClasses={["qs-wifi-info-value"]} label={`${ap.strength}%`} />
                      <label cssClasses={["qs-wifi-info-sep"]} label="•" />
                      <label cssClasses={["qs-wifi-info-label"]} label="Seguridad:" />
                      <label cssClasses={["qs-wifi-info-value"]} label={secType} />
                    </box>
                  </box>
                </revealer>
              </box>
            )
            }}
          </For>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}

// ── Main Window ───────────────────────────────────────────────────────────────

export default function QuickSettings(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor
  let hoverTimeout: number | null = null

  const clearTimer = () => {
    if (hoverTimeout !== null) {
      GLib.source_remove(hoverTimeout)
      hoverTimeout = null
    }
  }

  const startTimer = () => {
    clearTimer()
    hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
      closeAllPanels()
      hoverTimeout = null
      setQsView("main") // Reset view when closing
      return GLib.SOURCE_REMOVE
    })
  }



  return (
    <window
      name="quick-settings"
      visible={quickSettingsVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={TOP | RIGHT}
      application={app}
      marginTop={48}
      marginRight={8}
      cssClasses={["qs-window"]}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            if (qsView.get() !== "main") {
              setQsView("main")
            } else {
              closeAllPanels()
            }
            return true
          }
          return false
        }}
      />
      <box
        cssClasses={["qs-panel"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={3}
        overflow={Gtk.Overflow.HIDDEN}
      >
        <Gtk.EventControllerMotion
          onEnter={clearTimer}
          onLeave={startTimer}
        />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={3} visible={qsView((v) => v === "main")}>
          <QsHeader />
          <QsTiles
            onWifiClick={() => {
              setQsView("wifi")
              execAsync(["nmcli", "device", "wifi", "rescan"]).catch(() => { })
            }}
            onBluetoothClick={() => setQsView("bluetooth")}
            onDisplayClick={() => setQsView("display")}
            onAudioClick={() => setQsView("audio")}
            onMicClick={() => setQsView("mic")}
          />
          <QsSpotify />
          <QsFooter />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} visible={qsView((v) => v === "wifi")}>
          <QsWifiMenu onBack={() => setQsView("main")} />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} visible={qsView((v) => v === "display")}>
          <QsDisplayMenu onBack={() => setQsView("main")} />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} visible={qsView((v) => v === "bluetooth")}>
          <QsBluetoothMenu onBack={() => setQsView("main")} />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} visible={qsView((v) => v === "audio")}>
          <QsAudioMenu onBack={() => setQsView("main")} />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} visible={qsView((v) => v === "mic")}>
          <QsMicMenu onBack={() => setQsView("main")} />
        </box>
      </box>
    </window>
  )
}

