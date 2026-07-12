import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, For, With, createComputed } from "ags"
import { createBinding } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { AVATAR_PATH, avatarRevision } from "./settings/avatar"
import { barTopMargin } from "./settings/preferences"
import AstalWp from "gi://AstalWp"
import AstalNetwork from "gi://AstalNetwork"
import AstalBluetooth from "gi://AstalBluetooth"
import AstalNotifd from "gi://AstalNotifd"
import AstalMpris from "gi://AstalMpris"
import GdkPixbuf from "gi://GdkPixbuf"
import cairo from "gi://cairo"
import {
  quickSettingsVisible,
  closeAllPanels,
  nightLightTemp,
  qsView,
  setQsView,
  infoSsid,
  setInfoSsid,
  openSettingsPanel,

  brightness,
  setBrightness
} from "./state"
import { openNotifPanel } from "./notifications/store"
import { clipWindowInputToContent } from "./inputRegion"
import * as Spotify from "./services/spotify/SpotifyService"
import {
  matchScalePreset,
  resolutionOptions,
  refreshOptions,
  SCALE_PRESETS,
} from "./display/modes"
import {
  monitors, saveDisplayConfig,
  applyPatch, acquirePoll, releasePoll,
  initDisplayService, setManualTemp, nightOn, toggleNightNow,
} from "./display/service"
import { DisplaySelect } from "./display/controls"
import { InlineEditableValue } from "./InlineEditableValue"

const WIFI_SIGNAL_BARS = 4

function activeWifiBars(strength: number) {
  if (strength >= 80) return 4
  if (strength >= 60) return 3
  if (strength >= 35) return 2
  if (strength >= 15) return 1
  return 0
}

function wifiSignalBarClasses(strength: number) {
  const active = activeWifiBars(strength)

  return Array.from({ length: WIFI_SIGNAL_BARS }, (_, i) => {
    const classes = ["qs-wifi-signal-bar", `bar-${i + 1}`]
    if (i < active) classes.push("active")
    return classes
  })
}

function focusSearchAndType(entry: Gtk.Entry, char: string) {
  entry.text = entry.text + char
  entry.set_position(-1)
  entry.grab_focus()
}

function isTextInputWidget(widget: Gtk.Widget | null) {
  if (!widget) return false
  const editable = widget as any
  return widget instanceof Gtk.Entry
    || (typeof editable.get_text === "function" && typeof editable.set_text === "function")
}

function handleSearchSectionKey(controller: Gtk.EventControllerKey, entry: Gtk.Entry, keyval: number, state: Gdk.ModifierType) {
  const widget = controller.get_widget()
  const root = widget?.get_root() as any
  const focus = root?.get_focus?.() as Gtk.Widget | null
  if (isTextInputWidget(focus)) return false

  const s = state as unknown as number
  const CTRL = 4, ALT = 8, SUPER = 0x4000000
  if ((s & CTRL) || (s & ALT) || (s & SUPER)) return false

  if (keyval === Gdk.KEY_BackSpace) {
    entry.text = entry.text.slice(0, -1)
    entry.set_position(-1)
    entry.grab_focus()
    return true
  }

  const cp = Gdk.keyval_to_unicode(keyval)
  if (cp < 0x20) return false

  focusSearchAndType(entry, String.fromCodePoint(cp))
  return true
}

// ── Auto-Switch Audio (Switch-on-Connect) ───────────────────────────────────
try {
  const wp = AstalWp.get_default()
  if (wp?.audio) {
    wp.audio.connect("speaker-added", (_, speaker) => {
      setTimeout(async () => {
        const id = String(speaker.id)
        const nodeName = await execAsync(["bash", "-c",
          `pactl list sinks | awk '/^Sink/{n=""} /\tName:/{n=$2} /object\\.id = "${id}"/{print n; exit}'`
        ]).catch(() => "")
        const name = nodeName.trim()
        if (name) execAsync(["pw-metadata", "-n", "default", "0", "default.audio.sink", `{"name":"${name}"}`]).catch(() => {})
        else execAsync(["wpctl", "set-default", id]).catch(() => {})
      }, 500)
    })
    wp.audio.connect("microphone-added", (_, mic) => {
      setTimeout(async () => {
        const id = String(mic.id)
        const nodeName = await execAsync(["bash", "-c",
          `pactl list sources | awk '/^Source/{n=""} /\tName:/{n=$2} /object\\.id = "${id}"/{print n; exit}'`
        ]).catch(() => "")
        const name = nodeName.trim()
        if (name) execAsync(["pw-metadata", "-n", "default", "0", "default.audio.source", `{"name":"${name}"}`]).catch(() => {})
        else execAsync(["wpctl", "set-default", id]).catch(() => {})
      }, 500)
    })
  }
} catch (e) {
  console.error("Failed to init audio switch-on-connect", e)
}

// ── Persistence Utilities ──────────────────────────────────────────────────────
const PRESETS_PATH = `${GLib.get_user_config_dir()}/gigios/audioPresets.json`

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

// ── Shared audio-apps polling ───────────────────────────────────────────────────
// Presets y sondeo de "mezcla de aplicaciones" viven a nivel de módulo, no por
// instancia. Antes cada QsAudioMenu/QsMicMenu (uno por monitor) tenía su propio
// intervalo y su propio setStreams: con 2+ monitores se lanzaban N sondeos pactl y
// se aplicaban los presets N veces (doble set-*-volume). Ahora un único poller con
// refcount alimenta a todas las instancias, y una guardia por firma evita reconstruir
// la lista cuando nada cambió (antes <For> recreaba TODAS las filas cada 2 s porque
// pactl devuelve objetos nuevos y la clave por defecto es identidad por referencia).
const EXCLUDE_CLIENTS = ["pactl", "gjs", "astal", "pipewire", "wireplumber", "xdg-desktop-portal", "hyprland", "gsd-color", "gjs-console", "pavucontrol"]

// Estado de presets compartido (una sola fuente; antes dos states podían divergir).
const [audioPresets, setAudioPresets] = createState<Record<string, number>>(loadAudioPresets())

// Firma estable: nombre|índice|volumen por stream. Si no cambia, no tocamos el state
// y <For> no reconstruye nada.
function streamsSignature(arr: any[]): string {
  return arr.map(si => {
    const p = si.properties || {}
    const name = p["application.name"] || p["node.name"] || p["media.name"] || "App"
    const volObj = si.volume || {}
    const ch = Object.keys(volObj)
    const vp = ch.length ? volObj[ch[0]].value_percent : (si.isSilent ? "silent" : "-")
    return `${name}|${si.index}|${vp}`
  }).join(";")
}

// ── Speaker apps poller ──
const [spkAppStreams, setSpkAppStreams] = createState<any[]>([])
let spkLastInteraction = 0
const spkHandledStreams = new Set<number>()
let spkSig = ""
let spkPollId: number | null = null
let spkRefs = 0

function loadSpkStreams() {
  if (Date.now() - spkLastInteraction < 2500) return
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
      const presetsNow = audioPresets.get()

      const enhanced = inputsArr.map(si => {
        const client = clientMap.get(String(si.client))
        if (client) si.properties = { ...client.properties, ...si.properties }
        const name = si.properties?.["application.name"] || si.properties?.["node.name"] || "App"
        const key = `app:spk:${name.toLowerCase()}`
        activeAppNames.add(name.toLowerCase())
        if (!spkHandledStreams.has(si.index)) {
          const p = presetsNow[key]
          if (p !== undefined) execAsync(["pactl", "set-sink-input-volume", `${si.index}`, `${Math.round(p * 100)}%`]).catch(() => { })
          spkHandledStreams.add(si.index)
        }
        return si
      })

      const silentApps: any[] = []
      clientsArr.forEach(c => {
        const name = c.properties?.["application.name"]
        if (!name) return
        const lowerName = name.toLowerCase()
        if (activeAppNames.has(lowerName) || EXCLUDE_CLIENTS.some(e => lowerName.includes(e))) return
        activeAppNames.add(lowerName)
        silentApps.push({ index: -1, client: c.index, properties: c.properties, volume: null, isSilent: true })
      })

      const next = [...enhanced, ...silentApps]
      const sig = streamsSignature(next)
      if (sig !== spkSig) { spkSig = sig; setSpkAppStreams(next) }
    } catch (e) {
      if (spkSig !== "") { spkSig = ""; setSpkAppStreams([]) }
    }
  }).catch(() => { if (spkSig !== "") { spkSig = ""; setSpkAppStreams([]) } })
}

function startSpkPoll() {
  spkRefs++
  if (spkPollId !== null) return
  loadSpkStreams()
  spkPollId = setInterval(loadSpkStreams, 2000)
}
function stopSpkPoll() {
  spkRefs = Math.max(0, spkRefs - 1)
  if (spkRefs === 0 && spkPollId !== null) { clearInterval(spkPollId); spkPollId = null }
}

// ── Microphone apps poller ──
// Solo apps que REALMENTE capturan (source-outputs activos). Un "client" de Pulse no
// implica captura, así que aquí no añadimos apps "silenciosas" (antes metía Spotify,
// navegadores, etc. como si grabaran).
const [micAppStreams, setMicAppStreams] = createState<any[]>([])
let micLastInteraction = 0
const micHandledStreams = new Set<number>()
let micSig = ""
let micPollId: number | null = null
let micRefs = 0

function loadMicStreams() {
  if (Date.now() - micLastInteraction < 2500) return
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
      const presetsNow = audioPresets.get()

      const enhanced = inputsArr.map(si => {
        const client = clientMap.get(String(si.client))
        if (client) si.properties = { ...client.properties, ...si.properties }
        const name = si.properties?.["application.name"] || si.properties?.["node.name"] || "App"
        const key = `app:mic:${name.toLowerCase()}`
        if (!micHandledStreams.has(si.index)) {
          const p = presetsNow[key]
          if (p !== undefined) execAsync(["pactl", "set-source-output-volume", `${si.index}`, `${Math.round(p * 100)}%`]).catch(() => { })
          micHandledStreams.add(si.index)
        }
        return si
      })

      const sig = streamsSignature(enhanced)
      if (sig !== micSig) { micSig = sig; setMicAppStreams(enhanced) }
    } catch (e) {
      if (micSig !== "") { micSig = ""; setMicAppStreams([]) }
    }
  }).catch(() => { if (micSig !== "") { micSig = ""; setMicAppStreams([]) } })
}

function startMicPoll() {
  micRefs++
  if (micPollId !== null) return
  loadMicStreams()
  micPollId = setInterval(loadMicStreams, 2000)
}
function stopMicPoll() {
  micRefs = Math.max(0, micRefs - 1)
  if (micRefs === 0 && micPollId !== null) { clearInterval(micPollId); micPollId = null }
}

// Throttle de escritura durante el arrastre: change-value se dispara en cada píxel, así
// que en vez de un pactl por tick coalescemos a ~60 ms con "trailing" (último valor gana).
function makeVolThrottle(apply: (v: number) => void) {
  let lastVol = 0
  let lastTs = 0
  let timer: number | null = null
  return (v: number) => {
    lastVol = v
    if (timer !== null) return
    const wait = Math.max(0, 60 - (Date.now() - lastTs))
    timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
      timer = null
      lastTs = Date.now()
      apply(lastVol)
      return GLib.SOURCE_REMOVE
    })
  }
}

// ── Display config & startup apply ────────────────────────────────────────────
// Toda la lógica de pantalla (config load/save, prefs por monitor, poller,
// applyPatch, re-aplicación al arranque, globales y scheduler de luz nocturna)
// vive en display/service.ts — fuente única compartida con la sección Pantalla
// de Ajustes. saveDisplayConfig se importa de ahí y sigue sirviendo al brillo y
// la luz nocturna de este panel.
initDisplayService()

// ── System State Persistence (Wifi, BT, Vol) ──────────────────────────────────
const SYSTEM_STATE_PATH = `${GLib.get_user_config_dir()}/gigios/system_state.json`

let systemSaveTimeout: number | null = null
function saveSystemState() {
  if (systemSaveTimeout !== null) GLib.source_remove(systemSaveTimeout)
  systemSaveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    try {
      const dir = GLib.path_get_dirname(SYSTEM_STATE_PATH)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) execAsync(["mkdir", "-p", dir]).catch(() => { })
      
      const wp = AstalWp.get_default()
      const speaker = wp?.audio?.defaultSpeaker
      const network = AstalNetwork.get_default()
      const bt = AstalBluetooth.get_default()
      
      const config = {
        wifi: network?.wifi?.enabled ?? true,
        bluetooth: bt?.isPowered ?? true,
        volume: speaker?.volume ?? 0.5,
        mute: speaker?.mute ?? false
      }
      GLib.file_set_contents(SYSTEM_STATE_PATH, JSON.stringify(config))
    } catch (e) { }
    systemSaveTimeout = null
    return GLib.SOURCE_REMOVE
  })
}

try {
  const wp = AstalWp.get_default()
  const network = AstalNetwork.get_default()
  const bt = AstalBluetooth.get_default()
  
  if (network?.wifi) network.wifi.connect("notify::enabled", saveSystemState)
  if (bt) bt.connect("notify::is-powered", saveSystemState)
  if (wp?.audio) {
    wp.audio.connect("notify::default-speaker", () => {
      const spk = wp.audio?.defaultSpeaker
      if (spk) {
        spk.connect("notify::volume", saveSystemState)
        spk.connect("notify::mute", saveSystemState)
      }
      saveSystemState()
    })
    if (wp.audio.defaultSpeaker) {
      wp.audio.defaultSpeaker.connect("notify::volume", saveSystemState)
      wp.audio.defaultSpeaker.connect("notify::mute", saveSystemState)
    }
  }
} catch(e) {}

// Restore state from cache on startup. Uses idle_add (next event-loop tick, no
// fixed delay) so D-Bus proxies have reported their real state before we compare.
// Only acts when current state differs from cache — external changes are respected.
GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
  try {
    const [ok, content] = GLib.file_get_contents(SYSTEM_STATE_PATH)
    if (ok) {
      const saved = JSON.parse(new TextDecoder().decode(content))
      const bt      = AstalBluetooth.get_default()
      const network = AstalNetwork.get_default()
      if (bt) {
        if (saved.bluetooth === false && bt.isPowered)
          execAsync(["bluetoothctl", "power", "off"]).catch(() => {})
        else if (saved.bluetooth === true && !bt.isPowered)
          execAsync(["bluetoothctl", "power", "on"]).catch(() => {})
      }
      if (network?.wifi) {
        if (saved.wifi === false && network.wifi.enabled)
          execAsync(["nmcli", "radio", "wifi", "off"]).catch(() => {})
        else if (saved.wifi === true && !network.wifi.enabled)
          execAsync(["nmcli", "radio", "wifi", "on"]).catch(() => {})
      }
    }
  } catch(e) {}
  return GLib.SOURCE_REMOVE
})

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

/** Etiqueta legible y DISTINGUIBLE para un endpoint de audio.
 * Varios sinks/sources de la misma tarjeta comparten el mismo prefijo largo en
 * `description` (p.ej. "…HD Audio Speaker", "…HD Audio HDMI / DisplayPort 1
 * Output"); con ellipsize al final se recorta justo la parte única y las filas
 * se ven idénticas. Preferimos la descripción de perfil / nick del nodo, que es
 * corta y única ("Speaker", "HDMI / DisplayPort 1 Output", "HDMI 1"). */
function endpointLabel(e: AstalWp.Endpoint): string {
  const profile = e.get_pw_property("device.profile.description")
  if (profile) return profile
  const nick = e.get_pw_property("node.nick")
  if (nick) return nick
  return e.description || e.name || "Desconocido"
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
  layout: { hexpand?: boolean; heightRequest?: number; widthRequest?: number } = {},
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
    hexpand: layout.hexpand ?? true,
    valign: Gtk.Align.CENTER,
  })
  if (layout.heightRequest !== undefined) scale.heightRequest = layout.heightRequest
  if (layout.widthRequest !== undefined) scale.widthRequest = layout.widthRequest
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

  // El reloj solo corre con el panel abierto: al cerrar se remueve el timer en
  // vez de dejarlo despertando cada segundo para nada (patrón de netSpeedTimer).
  let clockTimer: number | null = null
  quickSettingsVisible.subscribe(() => {
    if (quickSettingsVisible.get()) {
      setTime(getTime())
      setDate(getDate())
      if (clockTimer === null) {
        clockTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
          setTime(getTime())
          setDate(getDate())
          return GLib.SOURCE_CONTINUE
        })
      }
    } else if (clockTimer !== null) {
      GLib.source_remove(clockTimer)
      clockTimer = null
    }
  })

  return (
    <box cssClasses={["qs-header"]} spacing={0}>
      <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} hexpand>
        <label cssClasses={["qs-clock"]} label={time} halign={Gtk.Align.START} />
        <label cssClasses={["qs-date"]} label={date} halign={Gtk.Align.START} />
      </box>
      <box spacing={6} valign={Gtk.Align.CENTER} halign={Gtk.Align.END} cssClasses={["qs-header-actions"]}>
        <button
          cssClasses={notifs((n) => n.length > 0 ? ["qs-notif-btn", "has-notifs"] : ["qs-notif-btn"])}
          onClicked={() => {
            closeAllPanels()
            openNotifPanel()
          }}
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

const sampleNetSpeed = () => {
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
}

// El muestreo de velocidad solo corre mientras QS está abierto (se abre poco):
// arranca al abrir y se detiene al cerrar, en vez de un timer eterno gateado que
// despertaba la CPU 1×/s siempre. Al abrir se resiembra lastBytes para que el
// primer tick no calcule un pico sobre todo el tiempo que estuvo cerrado.
let netSpeedTimer: number | null = null
// OJO: el callback de subscribe en gnim se invoca SIN argumentos, hay que leer
// .get() dentro (no `subscribe((v) => …)`, que daría v === undefined siempre).
quickSettingsVisible.subscribe(() => {
  if (quickSettingsVisible.get()) {
    if (netSpeedTimer !== null) return
    lastBytes = { up: 0, down: 0, time: 0 }
    sampleNetSpeed()
    netSpeedTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      sampleNetSpeed()
      return GLib.SOURCE_CONTINUE
    })
  } else if (netSpeedTimer !== null) {
    GLib.source_remove(netSpeedTimer)
    netSpeedTimer = null
    setNetSpeed({ up: "0B", down: "0B" })
  }
})

function QsTile({ icon, iconWidget, label, subtitle, active, onToggle, onSecondaryClick, onRightClick, subtitleWidthRequest }: {
  icon: any, iconWidget?: any, label: any, subtitle: any, active: any, onToggle: () => void, onSecondaryClick?: () => void, onRightClick?: () => void, subtitleWidthRequest?: number
}) {
  const classes = typeof active === "function"
    ? active((a: boolean) => a ? ["qs-tile", "active"] : ["qs-tile"])
    : (active ? ["qs-tile", "active"] : ["qs-tile"])
  return (
    <button cssClasses={classes} onClicked={onToggle} hexpand>
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onPressed={onRightClick}
      />
      <box spacing={6} valign={Gtk.Align.CENTER} hexpand>
        {iconWidget || <label cssClasses={["qs-tile-icon"]} label={icon} />}
        <box orientation={Gtk.Orientation.VERTICAL} spacing={0} hexpand>
          <label cssClasses={["qs-tile-label"]} label={label} halign={Gtk.Align.START} />
          <label
            cssClasses={["qs-tile-sub"]}
            label={subtitle}
            halign={Gtk.Align.START}
            xalign={0}
            widthRequest={subtitleWidthRequest}
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

// Header "← título [acciones]" compartido por los submenús (Volumen, Micrófono,
// Pantalla, Bluetooth, Wi-Fi). `children` es el slot de acciones a la derecha
// (buscador, botón de ajustes, scan, toggle...), que cada submenú compone a
// mano porque varía bastante entre ellos.
function QsMenuHeader({ title, onBack, titleHexpand = true, children }: {
  title: any, onBack: () => void, titleHexpand?: boolean, children?: any
}) {
  return (
    <box spacing={6} cssClasses={["qs-wifi-header"]} valign={Gtk.Align.CENTER}>
      <button cssClasses={["qs-icon-btn"]} onClicked={onBack}><label label="󰅁" /></button>
      <label cssClasses={["qs-section-label"]} label={title} hexpand={titleHexpand} halign={Gtk.Align.START} />
      {children}
    </box>
  )
}

// Track+dot visual de un toggle (Luz nocturna, Bluetooth, Wi-Fi). El `<button>`
// que lo envuelve se queda en cada caller porque su `onClicked` varía.
function ToggleSwitch({ active }: { active: any }) {
  return (
    <box cssClasses={["qs-toggle-track"]}>
      <box cssClasses={active((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
    </box>
  )
}

// Clúster "icono + columna(nombre + subtítulo)" compartido por la fila de
// dispositivo Bluetooth, la fila de red Wi-Fi y la fila de stream de audio.
// `icon` y `subtitle` se pasan como nodos JSX ya construidos por el caller
// (el icono de Wi-Fi es un box de barras de señal, no un <label>) — el botón
// envolvente, los gestos y el trailing de cada fila se quedan en el caller.
function QsRowLabel({ icon, title, titleClass = "qs-wifi-name", subtitle, spacing = 8, valign }: {
  icon: any, title: any, titleClass?: string, subtitle?: any, spacing?: number, valign?: Gtk.Align
}) {
  return (
    <box spacing={spacing} valign={valign}>
      {icon}
      <box orientation={Gtk.Orientation.VERTICAL} hexpand>
        <label label={title} halign={Gtk.Align.START} ellipsize={3} cssClasses={[titleClass]} />
        {subtitle}
      </box>
    </box>
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

  // Tile de red consciente de ethernet: si network.primary es WIRED y el cable
  // está activo, el tile muestra Ethernet; si no, comportamiento WiFi de siempre.
  const NET_P  = AstalNetwork.Primary
  const NET_DS = AstalNetwork.DeviceState
  const ETHERNET_GLYPH = "󰈀"   // nf-md-ethernet
  const computeNetTile = () => {
    const wired = network.wired
    const onWired = network.primary === NET_P.WIRED
      && !!wired && wired.state === NET_DS.ACTIVATED
    if (onWired) return { icon: ETHERNET_GLYPH, label: "Ethernet", active: true }
    return { icon: "󰤨", label: wifi?.ssid || "Wi-Fi", active: wifi?.enabled ?? false }
  }
  const [netTile, setNetTile] = createState(computeNetTile())
  const syncNetTile = () => setNetTile(computeNetTile())
  network.connect("notify::primary", syncNetTile)
  network.connect("notify::wired", syncNetTile)
  network.connect("notify::wifi", syncNetTile)
  if (wifi) {
    wifi.connect("notify::ssid", syncNetTile)
    wifi.connect("notify::enabled", syncNetTile)
    wifi.connect("notify::strength", syncNetTile)
  }
  if (network.wired) network.wired.connect("notify::state", syncNetTile)
  const wifiStrength = wifi ? createBinding(wifi, "strength") : null

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
  // Igual que el reloj: el sondeo del monitor solo corre con el panel abierto y
  // se remueve al cerrar en vez de despertar cada 5s (patrón de netSpeedTimer).
  let monitorTimer: number | null = null
  quickSettingsVisible.subscribe(() => {
    if (quickSettingsVisible.get()) {
      updateMonitor()
      if (monitorTimer === null) {
        monitorTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
          updateMonitor()
          return GLib.SOURCE_CONTINUE
        })
      }
    } else if (monitorTimer !== null) {
      GLib.source_remove(monitorTimer)
      monitorTimer = null
    }
  })

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
    <box cssClasses={["qs-tiles"]} spacing={6} hexpand homogeneous>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand>
        <QsTile
          icon={netTile((t) => t.icon)}
          iconWidget={
            <box cssClasses={["qs-tile-net-icon"]} valign={Gtk.Align.CENTER}>
              <label
                cssClasses={["qs-tile-icon"]}
                label={ETHERNET_GLYPH}
                visible={netTile((t) => t.icon === ETHERNET_GLYPH)}
              />
              <box
                cssClasses={["qs-tile-icon", "qs-tile-wifi-signal"]}
                spacing={1}
                valign={Gtk.Align.CENTER}
                visible={netTile((t) => t.icon !== ETHERNET_GLYPH)}
              >
                <For each={wifiStrength ? wifiStrength((s) => wifiSignalBarClasses(s ?? 0)) : () => wifiSignalBarClasses(0)}>
                  {(classes) => <box cssClasses={classes} valign={Gtk.Align.END} />}
                </For>
              </box>
            </box>
          }
          label={netTile((t) => t.label)}
          subtitle={netSpeed((s) => `󰇚${s.down} 󰕒${s.up}`)}
          subtitleWidthRequest={96}
          active={netTile((t) => t.active)}
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
          active={nightOn}
          onToggle={onDisplayClick}
          onSecondaryClick={onDisplayClick}
          onRightClick={() => toggleNightNow()}
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


// ── Section 3: Media Player ───────────────────────────────────────────────────

const MEDIA_THEMES = [
  { bg: "rgba(137, 180, 250, 0.08)", border: "rgba(137, 180, 250, 0.2)", accent: "#89b4fa" },
  { bg: "rgba(245, 194, 231, 0.08)", border: "rgba(245, 194, 231, 0.2)", accent: "#f5c2e7" },
  { bg: "rgba(166, 227, 161, 0.08)", border: "rgba(166, 227, 161, 0.2)", accent: "#a6e3a1" },
  { bg: "rgba(250, 179, 135, 0.08)", border: "rgba(250, 179, 135, 0.2)", accent: "#fab387" },
  { bg: "rgba(203, 166, 247, 0.08)", border: "rgba(203, 166, 247, 0.2)", accent: "#cba6f7" },
  { bg: "rgba(249, 226, 175, 0.08)", border: "rgba(249, 226, 175, 0.2)", accent: "#f9e2af" },
  { bg: "rgba(148, 226, 213, 0.08)", border: "rgba(148, 226, 213, 0.2)", accent: "#94e2d5" },
]

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "")
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ]
}

function rgbToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

// One UI 8 deriva de la semilla una paleta tonal APAGADA (muteada): tanto el
// tinte del fondo como el seekbar tienen saturación baja. Medido sobre la misma
// carátula, Samsung usa fondo≈HSL(_,0.36,0.18) y seekbar≈HSL(_,0.21,0.51). El
// hue se preserva siempre; lo que corregimos aquí es la SATURACIÓN (antes íbamos
// demasiado saturados) y clavamos el tono.

// Tinte del fondo: oscuro y MUTEADO. Se pinta a alpha bajo para que la carátula
// se siga viendo por debajo (como en el teléfono).
function oneUiBgTone(rgb: [number, number, number]): [number, number, number] {
  const [h, s] = rgbToHsl(rgb)
  const sat = Math.min(0.42, s * 0.6 + 0.06) // apagado, tope ~Samsung 0.36–0.42
  const lum = 0.18 + Math.min(1, s) * 0.05   // ~0.18–0.23
  return hslToRgb([h, sat, lum])
}

// Seekbar / acento activo: mismo hue, periwinkle MUTEADO y de tono medio,
// legible sobre el fondo oscuro (Samsung ≈ HSL(_,0.21,0.51)).
function oneUiFgTone(rgb: [number, number, number]): [number, number, number] {
  const [h, s] = rgbToHsl(rgb)
  const sat = Math.min(0.30, s * 0.4 + 0.08)
  return hslToRgb([h, sat, 0.55])
}

function cssRgbToTuple(rgb: string): [number, number, number] {
  const values = rgb.match(/\d+/g)?.map(Number)
  if (!values || values.length < 3) return hexToRgb(MEDIA_THEMES[0].accent)
  return [values[0], values[1], values[2]]
}

function formatMediaTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0:00"
  const total = Math.floor(value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

// Extrae el color "semilla" de la carátula igual que hace la máquina monet de
// One UI 8 (Material Color Utilities → Score): puntúa por CROMA + población, sin
// sesgo de luminancia. El código viejo penalizaba/premiaba por luminancia
// ("darkFit") y calidez ("warmBias"), lo que a veces elegía un color distinto al
// de Samsung → de ahí las inversiones "aquí oscuro / allí claro".
// Muchos navegadores (Firefox) NO publican mpris:artUrl para YouTube, pero sí
// xesam:url con el enlace del vídeo. Derivamos la miniatura del ID del vídeo.
// Cubre watch?v=, youtu.be/, /embed/ y /shorts/.
function youtubeThumb(url: string): string {
  if (!url) return ""
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : ""
}

// Nombre de caché ÚNICO por URL. El esquema viejo (último segmento de la ruta)
// colisiona: todas las miniaturas de YouTube son "hqdefault.jpg" → portada vieja.
function coverCacheName(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (Math.imul(h, 31) + url.charCodeAt(i)) | 0
  const ext = (url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || "img").toLowerCase()
  return `c${(h >>> 0).toString(16)}.${ext}`
}

function dominantPixbufColor(pixbuf: GdkPixbuf.Pixbuf): [number, number, number] {
  const pixels = pixbuf.get_pixels()
  const width = pixbuf.get_width()
  const height = pixbuf.get_height()
  const channels = pixbuf.get_n_channels()
  const rowstride = pixbuf.get_rowstride()
  const step = Math.max(1, Math.floor(Math.min(width, height) / 28))
  const buckets = new Map<string, { r: number; g: number; b: number; chroma: number; count: number }>()
  let total = 0

  for (let y = 0; y < height; y += step) {
    const row = y * rowstride
    for (let x = 0; x < width; x += step) {
      const i = row + x * channels
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const chroma = max - min // 0..255, proxy perceptual de croma (HCT-lite)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

      total += 1
      // Descarta casi-negro, casi-blanco y casi-gris; el resto SÍ compite,
      // incluidos colores oscuros y saturados (Samsung sí los elige de semilla).
      if (lum < 14 || lum > 236 || chroma < 16) continue

      const qr = r >> 5
      const qg = g >> 5
      const qb = b >> 5
      const key = `${qr},${qg},${qb}`
      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, chroma: 0, count: 0 }
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.chroma += chroma
      bucket.count += 1
      buckets.set(key, bucket)
    }
  }

  // Score al estilo Material: proporción·0.7 + (croma-48)·peso. El croma manda,
  // pero un color muy poblado y algo menos saturado puede ganar (como en monet).
  const TARGET_CHROMA = 48
  let best: { r: number; g: number; b: number; chroma: number; count: number } | null = null
  let bestScore = -Infinity
  for (const bucket of buckets.values()) {
    const proportion = total > 0 ? bucket.count / total : 0
    const chroma = (bucket.chroma / bucket.count) / 255 * 100 // 0..100
    if (chroma < 5) continue
    const proportionScore = proportion * 100 * 0.7
    const chromaScore = chroma < TARGET_CHROMA
      ? (chroma - TARGET_CHROMA) * 0.1
      : (chroma - TARGET_CHROMA) * 0.3
    const score = proportionScore + chromaScore
    if (!best || score > bestScore) {
      best = bucket
      bestScore = score
    }
  }
  if (!best || best.count <= 0) return hexToRgb(MEDIA_THEMES[0].accent)

  return [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
  ]
}

function QsMedia() {
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />

  const [title, setTitle] = createState("Sin reproducción")
  const [artist, setArtist] = createState("")
  const [isPlaying, setIsPlaying] = createState(false)
  const [prog, setProg] = createState(0)
  const [positionLabel, setPositionLabel] = createState("0:00")
  const [durationLabel, setDurationLabel] = createState("0:00")
  const [hasProgress, setHasProgress] = createState(false)
  const [hasPlayer, setHasPlayer] = createState(false)
  const [cover, setCover] = createState("")
  const [playerIndex, setPlayerIndex] = createState(0)
  const [numPlayers, setNumPlayers] = createState(0)
  const [playerName, setPlayerName] = createState("")
  const [themeIdx, setThemeIdx] = createState(0)
  const [coverAccent, setCoverAccent] = createState(MEDIA_THEMES[0].accent)
  const [trackId, setTrackIdState] = createState<string | null>(null)
  const [isAdState, setIsAd] = createState(false)
  const [liked, setLiked] = createState(false)
  const [likeVisible, setLikeVisible] = createState(false)
  const [canLike, setCanLike] = createState(false)
  const [isSpotifyPlayer, setIsSpotifyPlayer] = createState(false)
  let lastQueriedId: string | null = null

  // El corazón solo aplica con cuenta Premium (los endpoints /me/tracks dan 403 en
  // free). isPremium() implica estar configurado. Se resuelve una vez (async) y se
  // cachea aquí para leerlo síncronamente en update(); si no es Premium, el corazón
  // no llega a mostrarse.
  Spotify.isPremium().then(setCanLike)

  let currentP: any = null

  // Contador de anuncios del bloque actual. Spotify no expone por MPRIS cuántos
  // anuncios hay ni en cuál vas, así que los contamos: cada trackid de anuncio
  // distinto incrementa el índice; al volver una pista real se resetea.
  let adIndex = 0
  let lastAdTrackId: string | null = null

  // AstalMpris no está descargando la carátula (deja la URL https, que GTK4 no puede
  // pintar en CSS). La descargamos nosotros a ~/.cache/ags/media/ una vez por álbum y
  // usamos la ruta local. Rutas locales / vacío se pasan tal cual.
  // Dedup contra la ENTRADA cruda (no solo la rama http). Si comparábamos solo
  // en la rama http, una portada local intermedia (Spotify) dejaba lastCoverUrl
  // desactualizado y al volver a una URL ya vista se saltaba el cambio.
  let lastCoverInput = "\0" // centinela ≠ "" para que la primera vez ("") sí aplique
  const resolveCover = (raw: string) => {
    if (raw === lastCoverInput) return // misma fuente que el tick anterior
    lastCoverInput = raw
    if (!raw) { setCover(""); return }
    if (!raw.startsWith("http")) { setCover(raw); return } // ya es ruta local
    const dir = `${GLib.get_user_cache_dir()}/ags/media`
    const path = `${dir}/${coverCacheName(raw)}`
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) { setCover(path); return }
    execAsync(["bash", "-c", `mkdir -p '${dir}' && curl -sfL -o '${path}' '${raw}'`])
      .then(() => setCover(path))
      .catch(() => setCover(""))
  }

  const update = () => {
    const players = mpris.players
    setNumPlayers(players.length)
    if (players.length === 0) {
      setHasPlayer(false)
      setIsSpotifyPlayer(false)
      return
    }

    let idx = playerIndex.get()
    if (idx >= players.length) {
      idx = 0
      setPlayerIndex(0)
    }

    const p = players[idx]
    if (!p) {
      setHasPlayer(false)
      setIsSpotifyPlayer(false)
      return
    }

    currentP = p
    setHasPlayer(true)
    const rawTrackId = p.trackid || ""
    const ad = Spotify.isAd(rawTrackId)
    const id = Spotify.parseTrackId(rawTrackId)
    const isSpotify = (p.bus_name || "").includes("spotify")
    setIsSpotifyPlayer(isSpotify)
    setIsAd(ad)

    if (ad) {
      // Nuevo anuncio dentro del bloque solo si cambió el trackid (el mismo
      // anuncio persiste varios ticks de 1 s mientras suena).
      if (rawTrackId !== lastAdTrackId) {
        adIndex += 1
        lastAdTrackId = rawTrackId
      }
      setTitle(`Anuncio · ${adIndex}`)
      setArtist("")
    } else {
      // Fin del bloque de anuncios: resetea el contador.
      adIndex = 0
      lastAdTrackId = null
      setTitle(p.title || "Sin título")
      setArtist(p.artist || "Artista desconocido")
    }

    setLikeVisible(isSpotify && canLike.get() && !ad && id !== null)

    // Consultar "liked" solo al CAMBIAR de track (no en cada tick de 1 s).
    if (!ad && id && canLike.get()) {
      if (id !== lastQueriedId) {
        lastQueriedId = id
        setTrackIdState(id)
        Spotify.isLiked(id).then(setLiked)
      }
    } else {
      lastQueriedId = null
    }

    setIsPlaying(p.playback_status === AstalMpris.PlaybackStatus.PLAYING)
    // Arte: primero el que da el reproductor; si no hay (Firefox no publica
    // artUrl para YouTube), lo derivamos de xesam:url.
    let art = p.cover_art || p.art_url || ""
    if (!art) {
      let pageUrl = ""
      try { pageUrl = p.get_meta?.("xesam:url")?.deep_unpack?.() || "" } catch (_) {}
      art = youtubeThumb(pageUrl)
    }
    resolveCover(art)
    setPlayerName(p.identity || p.bus_name.split(".").pop() || "Player")
    // Algunos reproductores (Firefox/YouTube) no exponen duración ni posición por
    // MPRIS. Sin dato, ocultamos la barra y los tiempos en vez de mostrar 0:00 muerto.
    if (p.length > 0) {
      setHasProgress(true)
      setProg(p.position / p.length)
      setPositionLabel(formatMediaTime(p.position))
      setDurationLabel(formatMediaTime(p.length))
    } else {
      setHasProgress(false)
      setProg(0)
      setPositionLabel("0:00")
      setDurationLabel("0:00")
    }

    // Fallback theme for non-cover UI. The background filter uses the real cover color.
    setThemeIdx(0)
  }

  const nextPlayer = () => {
    const players = mpris.players
    if (players.length > 1) {
      setPlayerIndex((playerIndex.get() + 1) % players.length)
      update()
    }
  }

  const prevPlayer = () => {
    const players = mpris.players
    if (players.length > 1) {
      setPlayerIndex((playerIndex.get() - 1 + players.length) % players.length)
      update()
    }
  }

  // Initial update and interval — skip when panel is closed
  update()
  const interval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    if (quickSettingsVisible.get()) update()
    return GLib.SOURCE_CONTINUE
  })
  quickSettingsVisible.subscribe(() => { if (quickSettingsVisible.get()) update() })

  const curTheme = themeIdx((i) => MEDIA_THEMES[i])

  // Fondo con Gtk.Picture (el background-image CSS no renderiza en este contenedor).
  const coverPicture = new Gtk.Picture()
  coverPicture.set_content_fit(Gtk.ContentFit.COVER)
  coverPicture.set_can_shrink(true)
  coverPicture.set_hexpand(true)
  coverPicture.set_vexpand(true)

  // La Picture propaga el tamaño natural de la imagen (grande) y desbordaba la tarjeta.
  // Un ScrolledWindow con propagate_natural_height=false + min/max_content_height
  // CORTA la altura del fondo pase lo que pase con la imagen. Es el hijo principal
  // del Overlay; así el Overlay no puede crecer más que la tarjeta.
  const CARD_H = 100
  const bgCap = new Gtk.ScrolledWindow()
  bgCap.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.NEVER)
  bgCap.set_propagate_natural_height(false)
  bgCap.set_min_content_height(CARD_H)
  bgCap.set_max_content_height(CARD_H)
  bgCap.set_hexpand(true)
  bgCap.set_child(coverPicture)
  const applyCover = () => {
    const c = cover.get()
    // Los anuncios SÍ pintan carátula si Spotify la publica; si no hay imagen,
    // cover queda "" y cae al fondo base como antes.
    if (!c || c.startsWith("http")) { coverPicture.set_paintable(null); return }
    const path = c.startsWith("file://") ? c.slice(7) : c
    try {
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path)
      // Guardamos la semilla cruda; el tono (fondo oscuro / seekbar claro) se
      // deriva en cada sitio de dibujo con oneUiBgTone / oneUiFgTone.
      setCoverAccent(rgbToCss(dominantPixbufColor(pixbuf)))
      coverPicture.set_paintable(Gdk.Texture.new_for_pixbuf(pixbuf))
    } catch (_) { coverPicture.set_paintable(null) }
  }
  cover.subscribe(applyCover)
  isAdState.subscribe(applyCover)
  applyCover()

  const colorFilter = new Gtk.DrawingArea()
  colorFilter.set_can_target(false)
  colorFilter.set_halign(Gtk.Align.FILL)
  colorFilter.set_valign(Gtk.Align.FILL)
  colorFilter.set_hexpand(true)
  colorFilter.set_vexpand(true)
  colorFilter.set_content_width(1)
  colorFilter.set_content_height(CARD_H)
  colorFilter.set_draw_func((_area, cr, width, height) => {
    if (!cover.get()) return
    const [r, g, b] = oneUiBgTone(cssRgbToTuple(coverAccent.get()))
    // Alpha medio: unifica el color pero DEJA VER la carátula por debajo, como
    // hace One UI (no un bloque opaco).
    cr.setSourceRGBA(r / 255, g / 255, b / 255, 0.45)
    cr.rectangle(0, 0, width, height)
    cr.fill()
  })
  const queueColorFilter = () => colorFilter.queue_draw()
  cover.subscribe(queueColorFilter)
  isAdState.subscribe(queueColorFilter)
  coverAccent.subscribe(queueColorFilter)

  const coverScrim = new Gtk.DrawingArea()
  coverScrim.set_can_target(false)
  coverScrim.set_halign(Gtk.Align.FILL)
  coverScrim.set_valign(Gtk.Align.FILL)
  coverScrim.set_hexpand(true)
  coverScrim.set_vexpand(true)
  coverScrim.set_content_width(1)
  coverScrim.set_content_height(CARD_H)
  coverScrim.set_draw_func((_area, cr, width, height) => {
    if (!cover.get()) return
    // Degradado vertical real: arriba casi transparente (se ve la carátula), abajo
    // oscuro para dar contraste al texto/controles. Igual que One UI.
    try {
      const grad = new (cairo as any).LinearGradient(0, 0, 0, height)
      grad.addColorStopRGBA(0, 0, 0, 0, 0.10)
      grad.addColorStopRGBA(0.55, 0, 0, 0, 0.30)
      grad.addColorStopRGBA(1, 0, 0, 0, 0.58)
      cr.setSource(grad)
      cr.rectangle(0, 0, width, height)
      cr.fill()
    } catch (_) {
      // Fallback si el binding de GJS no expone LinearGradient: scrim plano.
      cr.setSourceRGBA(0, 0, 0, 0.34)
      cr.rectangle(0, 0, width, height)
      cr.fill()
    }
  })
  const queueCoverScrim = () => coverScrim.queue_draw()
  cover.subscribe(queueCoverScrim)
  isAdState.subscribe(queueCoverScrim)

  const progressArea = new Gtk.DrawingArea()
  progressArea.set_can_target(false)
  progressArea.set_hexpand(true)
  progressArea.set_content_width(1)
  progressArea.set_content_height(7)
  progressArea.set_draw_func((_area, cr, width, height) => {
    const radius = Math.min(height / 2, 3)
    const drawRoundRect = (x: number, y: number, w: number, h: number) => {
      const r = Math.min(radius, w / 2, h / 2)
      cr.newPath()
      cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
      cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
      cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
      cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI)
      cr.closePath()
    }

    const y = Math.max(0, (height - 5) / 2)
    drawRoundRect(0, y, width, 5)
    cr.setSourceRGBA(0, 0, 0, 0.42)
    cr.fill()

    const fillW = Math.max(0, Math.min(width, width * prog.get()))
    if (fillW <= 0) return
    const [r, g, b] = oneUiFgTone(cssRgbToTuple(coverAccent.get()))
    drawRoundRect(0, y, fillW, 5)
    cr.setSourceRGBA(r / 255, g / 255, b / 255, 1)
    cr.fill()
  })
  const queueProgress = () => progressArea.queue_draw()
  prog.subscribe(queueProgress)
  coverAccent.subscribe(queueProgress)

  const mediaContent = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      hexpand
      heightRequest={CARD_H}
      cssClasses={["qs-media-content"]}
    >
      <box spacing={4} visible={numPlayers((n) => n > 1)} cssClasses={["qs-media-switcher-row"]}>
        <label 
          cssClasses={["qs-media-source"]} 
          label={playerName} 
          hexpand 
          halign={Gtk.Align.START} 
          css={curTheme((t) => `color: ${t.accent};`)}
        />
        <box spacing={0} valign={Gtk.Align.CENTER}>
          <button cssClasses={["qs-media-switch"]} onClicked={prevPlayer}>
            <label label="󰅁" css={curTheme((t) => `color: ${t.accent};`)} />
          </button>
          <label 
            cssClasses={["qs-media-count"]} 
            label={playerIndex((i) => `${i + 1}/${numPlayers()}`)} 
            halign={Gtk.Align.CENTER} 
            css={curTheme((t) => `color: ${t.accent};`)}
          />
          <button cssClasses={["qs-media-switch"]} onClicked={nextPlayer}>
            <label label="󰅂" css={curTheme((t) => `color: ${t.accent};`)} />
          </button>
        </box>
      </box>

      <box spacing={10} vexpand valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand valign={Gtk.Align.CENTER}>
          <label cssClasses={["qs-media-title"]} label={title} halign={Gtk.Align.START} ellipsize={3} />
          <label cssClasses={["qs-media-artist"]} label={artist} halign={Gtk.Align.START} ellipsize={3} />
        </box>
      </box>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} visible={hasProgress}>
        {progressArea}
        <box>
          <label cssClasses={["qs-media-time"]} label={positionLabel} halign={Gtk.Align.START} hexpand />
          <label cssClasses={["qs-media-time"]} label={durationLabel} halign={Gtk.Align.END} />
        </box>
      </box>
      <box spacing={2} halign={Gtk.Align.CENTER} valign={Gtk.Align.END}>
        <button
          cssClasses={["qs-media-btn", "qs-media-like"]}
          visible={likeVisible}
          onClicked={() => {
            const id = trackId.get()
            if (!id) return
            const next = !liked.get()
            setLiked(next) // optimista
            Spotify.setLiked(id, next).then((ok) => { if (!ok) setLiked(!next) })
          }}
        >
          <label label={liked((v) => v ? "󰋑" : "󰋕")} />
        </button>
        <button cssClasses={["qs-media-btn"]} onClicked={() => {
          const p = mpris.players[playerIndex.get()]
          if (p) {
            const name = p.bus_name.replace("org.mpris.MediaPlayer2.", "")
            execAsync(["playerctl", "-p", name, "previous"]).catch(() => {})
          }
        }}>
          <label label="󰒮" />
        </button>
        <button cssClasses={["qs-media-btn"]} onClicked={() => {
          const p = mpris.players[playerIndex.get()]
          if (p) p.play_pause()
        }}>
          <label label={isPlaying((v) => v ? "󰏤" : "󰐊")} />
        </button>
        <button cssClasses={["qs-media-btn"]} onClicked={() => {
          const p = mpris.players[playerIndex.get()]
          if (p) {
            const name = p.bus_name.replace("org.mpris.MediaPlayer2.", "")
            execAsync(["playerctl", "-p", name, "next"]).catch(() => {})
          }
        }}>
          <label label="󰒭" />
        </button>
      </box>
    </box>
  )

  const spotifyLogo = (
    <label
      cssClasses={["qs-media-spotify-logo"]}
      label="󰓇"
      visible={isSpotifyPlayer}
      halign={Gtk.Align.END}
      valign={Gtk.Align.START}
    />
  )

  return (
    <box
      cssClasses={["qs-media"]}
      visible={hasPlayer}
      overflow={Gtk.Overflow.HIDDEN}
    >
      <Gtk.Overlay $={(self: any) => {
        self.set_child(bgCap)
        self.add_overlay(colorFilter)
        self.add_overlay(coverScrim)
        self.add_overlay(mediaContent)
        self.add_overlay(spotifyLogo)
        self.set_measure_overlay(mediaContent, true)
      }} />
    </box>
  )
}

// ── Section 4: Volume ─────────────────────────────────────────────────────────

// `QsAudioMenu` (altavoces) y `QsMicMenu` (micrófono) eran casi el mismo
// componente (header, sección "dispositivos"/"apps" con For, volúmenes,
// presets, mute...), solo cambiaba sink↔source, la lista de streams y las
// etiquetas en español. `QsAudioMenuBase` concentra la lógica parametrizada
// por `kind`; `QsAudioMenu`/`QsMicMenu` quedan como wrappers de una línea.
type QsAudioKind = "speaker" | "mic"

function QsAudioMenuBase({ kind, onBack }: { kind: QsAudioKind; onBack: () => void }) {
  const isSpk = kind === "speaker"
  const wp = AstalWp.get_default()
  const [audioMode, setAudioMode] = createState<"devices" | "apps">("devices")
  // Estado de apps y presets compartidos a nivel de módulo (ver bloque "Shared
  // audio-apps polling"). `presets`/`setPresets` se mantienen como alias para no tocar
  // el resto de la función.
  const streams = isSpk ? spkAppStreams : micAppStreams
  const presets = audioPresets
  const setPresets = setAudioPresets
  const handledDevices = new Set<string>()

  if (!wp.audio) return <box />

  function deviceIcon(vol: number, mute: boolean) {
    if (isSpk) {
      if (mute || vol === 0) return "󰝟"
      if (vol < 0.33) return "󰕿"
      if (vol < 0.66) return "󰖀"
      return "󰕾"
    }
    return mute ? "󰍭" : "󰍬"
  }

  // Esta instancia solo declara si "quiere" el sondeo (panel abierto ∧ vista propia ∧
  // modo apps); el poller compartido con refcount lo arranca/detiene según haya ≥1
  // instancia activa. `wanting` evita contar mal el refcount al re-disparar syncRefresh.
  let wanting = false
  const shouldRefresh = () =>
    quickSettingsVisible.get() && qsView.get() === (isSpk ? "audio" : "mic") && audioMode.get() === "apps"
  const syncRefresh = () => {
    const want = shouldRefresh()
    if (want === wanting) return
    wanting = want
    if (want) (isSpk ? startSpkPoll : startMicPoll)(); else (isSpk ? stopSpkPoll : stopMicPoll)()
  }
  audioMode.subscribe(syncRefresh)
  quickSettingsVisible.subscribe(syncRefresh)
  qsView.subscribe(syncRefresh)

  const endpoints = createBinding(wp.audio, isSpk ? "speakers" : "microphones")
  // Vestigial en las dos versiones originales (ninguna lo leía), se conserva
  // solo para no cambiar el comportamiento reactivo existente.
  const defaultEndpoint = createBinding(wp.audio, isSpk ? "defaultSpeaker" : "defaultMicrophone")

  // Local state for immediate visual update on click (don't wait for WirePlumber signal)
  const [localDefaultId, setLocalDefaultId] = createState<number | null>(
    (isSpk ? wp.audio.defaultSpeaker?.id : wp.audio.defaultMicrophone?.id) ?? null
  )
  wp.audio.connect(isSpk ? "notify::default-speaker" : "notify::default-microphone", () => {
    setLocalDefaultId((isSpk ? wp.audio.defaultSpeaker?.id : wp.audio.defaultMicrophone?.id) ?? null)
  })

  return (
    <box cssClasses={[isSpk ? "qs-audio-menu" : "qs-mic-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <QsMenuHeader title={isSpk ? "Volumen" : "Micrófono"} onBack={onBack}>
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => {
            // setAudioMode dispara syncRefresh (suscrito a audioMode), que arranca o
            // detiene el sondeo según corresponda.
            setAudioMode(audioMode.get() === "devices" ? "apps" : "devices")
          }}
          tooltipText={audioMode((m) => m === "devices" ? "Mezcla de aplicaciones" : (isSpk ? "Dispositivos de salida" : "Dispositivos de entrada"))}
        ><label label={audioMode((m) => m === "devices" ? "󰓃" : "󰋎")} /></button>
      </QsMenuHeader>

      <Gtk.ScrolledWindow
        cssClasses={["qs-wifi-list-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vexpand
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={audioMode((m) => m === "devices")}>
            <label cssClasses={["qs-dropdown-header"]} label={isSpk ? "DISPOSITIVOS DE SALIDA" : "DISPOSITIVOS DE ENTRADA"} halign={Gtk.Align.START} />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
              <For each={endpoints}>
                {(ep: AstalWp.Endpoint) => {
                  const vol = createBinding(ep, "volume")
                  const mute = createBinding(ep, "mute")
                  // El resaltado del dispositivo activo se deriva del propio
                  // `is_default` del endpoint (reactivo y correcto al entrar).
                  // `notify::default-speaker`/`notify::default-microphone` del objeto
                  // Audio NO se dispara en esta versión de AstalWp y su id llega sin
                  // resolver (0) al construirse el panel, por eso antes nada salía en
                  // azul. `localDefaultId` se conserva como override optimista para
                  // feedback instantáneo al pulsar.
                  const isDefault = createBinding(ep, "isDefault")
                  const activeClasses = createComputed(() =>
                    (isDefault() || localDefaultId() === ep.id)
                      ? ["qs-audio-item", "active"]
                      : ["qs-audio-item"])

                  // Apply device preset if new
                  const devTag = isSpk ? "spk" : "mic"
                  const devKey = `dev:${devTag}:${ep.name}`
                  if (ep.name && !handledDevices.has(`${devTag}:${ep.name}`)) {
                    const p = presets.get()[devKey]
                    if (p !== undefined) {
                      ep.volume = p
                    }
                    handledDevices.add(`${devTag}:${ep.name}`)
                  }

                  const scale = makeScale(
                    ["qs-slider", isSpk ? "speaker" : "mic"],
                    () => ep.volume,
                    (v) => {
                      ep.volume = v
                      const p = { ...presets.get() }
                      p[devKey] = v
                      setPresets(p)
                      saveAudioPresets(p)
                    },
                    (cb) => { ep.connect("notify::volume", cb) },
                    { heightRequest: 4 },
                  )

                  const activate = async () => {
                    setLocalDefaultId(ep.id)
                    const id = String(ep.id)
                    const nodeName = await execAsync(["bash", "-c",
                      isSpk
                        ? `pactl list sinks | awk '/^Sink/{n=""} /\tName:/{n=$2} /object\\.id = "${id}"/{print n; exit}'`
                        : `pactl list sources | awk '/^Source/{n=""} /\tName:/{n=$2} /object\\.id = "${id}"/{print n; exit}'`
                    ]).catch(() => "")
                    const name = nodeName.trim()
                    if (!name) return
                    execAsync(["pw-metadata", "-n", "default", "0", isSpk ? "default.audio.sink" : "default.audio.source",
                      `{"name":"${name}"}`]).catch(() => {})
                    execAsync(["bash", "-c",
                      isSpk
                        ? `pactl list short sink-inputs | awk '{print $1}' | xargs -r -I{} pactl move-sink-input {} "${name}"`
                        : `pactl list short source-outputs | awk '{print $1}' | xargs -r -I{} pactl move-source-output {} "${name}"`
                    ]).catch(() => {})
                  }
                  const toggleMute = () => {
                    ep.mute = !ep.mute
                  }

                  return (
                    <box orientation={Gtk.Orientation.VERTICAL} spacing={3} cssClasses={activeClasses}>
                      <box hexpand>
                        <Gtk.GestureClick
                          button={Gdk.BUTTON_PRIMARY}
                          onPressed={activate}
                        />
                        <label cssClasses={["qs-audio-name"]} label={endpointLabel(ep)} ellipsize={3} halign={Gtk.Align.START} />
                      </box>
                      <box spacing={5} valign={Gtk.Align.CENTER}>
                        <button cssClasses={["qs-audio-card-btn"]} onClicked={toggleMute} tooltipText={mute((m) => m ? "Activar sonido" : "Silenciar")}>
                          <label cssClasses={["qs-audio-icon"]} label={createComputed(() => deviceIcon(vol(), mute()))} />
                        </button>
                        <box spacing={5} valign={Gtk.Align.CENTER} hexpand>
                          <box hexpand valign={Gtk.Align.CENTER}>
                            <Gtk.GestureClick
                              button={Gdk.BUTTON_PRIMARY}
                              onPressed={activate}
                            />
                            {scale}
                          </box>
                          <InlineEditableValue
                            display={vol((v) => `${Math.round(v * 100)}`)}
                            getValue={() => ep.volume * 100}
                            onCommit={(value) => {
                              ep.volume = value / 100
                              const p = { ...presets.get(), [devKey]: value / 100 }
                              setPresets(p)
                              saveAudioPresets(p)
                            }}
                            min={0} max={100}
                            labelClass="qs-audio-vol-pct"
                            tooltip="Editar volumen"
                            widthRequest={18}
                          />
                        </box>
                      </box>
                    </box>
                  )
                }}
              </For>
            </box>
          </box>

          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={audioMode((m) => m === "apps")}>
            <label cssClasses={["qs-dropdown-header"]} label={isSpk ? "MEZCLA DE APLICACIONES" : "MEZCLA DE ENTRADAS"} halign={Gtk.Align.START} />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
              <For each={streams}>
                {(si: any) => {
                  const props = si.properties || {}
                  const name = props["application.name"]
                    || props["node.name"]
                    || props["media.name"]
                    || props["application.process.binary"]
                    || "App"
                  // Clave unificada con el poller: `app:${devTag}:` (antes la fila de
                  // mic guardaba con `mic:` pero el poller aplicaba con `app:mic:`, así
                  // que el preset no se releía).
                  const key = `app:${isSpk ? "spk" : "mic"}:${name.toLowerCase()}`

                  const volObj = si.volume || {}
                  const channels = Object.keys(volObj)
                  const presetVal = presets.get()[key]
                  const initialVol = channels.length > 0
                    ? parseFloat((volObj[channels[0]].value_percent || "100%").replace("%", "")) / 100
                    : (presetVal !== undefined ? presetVal : 1.0)

                  const [currentVol, setCurrentVol] = createState(initialVol)

                  const applyVol = makeVolThrottle((v) => {
                    if (si.index !== -1) execAsync([
                      "pactl", isSpk ? "set-sink-input-volume" : "set-source-output-volume",
                      `${si.index}`, `${Math.round(v * 100)}%`,
                    ]).catch(() => { })
                  })
                  // El modo "media" (slider ancho tipo Spotify) solo existe para
                  // altavoces; las entradas de micrófono siempre usan el slider "mic".
                  const isMedia = isSpk && (name.toLowerCase().includes("spotify") || si.properties?.["media.name"])
                  const streamScale = makeScale(
                    isMedia ? ["qs-slider", "media"] : ["qs-slider", isSpk ? "app" : "mic"],
                    () => currentVol.get(),
                    (v) => {
                      setCurrentVol(v)
                      if (isSpk) spkLastInteraction = Date.now(); else micLastInteraction = Date.now()
                      // Update preset
                      const p = { ...presets.get() }
                      p[key] = v
                      setPresets(p)
                      saveAudioPresets(p)
                      // Apply to stream if active (throttled)
                      applyVol(v)
                    },
                    undefined,
                    { heightRequest: 4 },
                  )
                  const icon = props["application.icon_name"]
                    || props["window.icon_name"]
                    || name.toLowerCase()
                    || (isSpk ? "audio-x-generic-symbolic" : "audio-input-microphone-symbolic")

                  return (
                    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-wifi-item", "qs-audio-app-item"]}>
                      <box spacing={6} valign={Gtk.Align.CENTER}>
                        <QsRowLabel
                          icon={<Gtk.Image iconName={icon} cssClasses={["qs-stream-icon"]} />}
                          title={name}
                          titleClass="qs-section-label"
                          spacing={6}
                        />
                        <InlineEditableValue
                          display={currentVol((v) => `${Math.round(v * 100)}`)}
                          getValue={() => currentVol.get() * 100}
                          onCommit={(value) => {
                            const v = value / 100
                            setCurrentVol(v)
                            const p = { ...presets.get(), [key]: v }
                            setPresets(p)
                            saveAudioPresets(p)
                            applyVol(v)
                          }}
                          min={0} max={100}
                          labelClass={si.isSilent ? ["qs-section-pct", "is-silent"] : ["qs-section-pct"]}
                          tooltip="Editar volumen"
                          widthRequest={18}
                        />
                      </box>
                      <box spacing={6}>
                        {streamScale}
                        {si.isSilent && <label label={isSpk ? "󰝟" : "󰍭"} cssClasses={["qs-audio-silent-icon"]} tooltipText="Aplicación en silencio/espera" />}
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

function QsAudioMenu({ onBack }: { onBack: () => void }) {
  return <QsAudioMenuBase kind="speaker" onBack={onBack} />
}

function QsMicMenu({ onBack }: { onBack: () => void }) {
  return <QsAudioMenuBase kind="mic" onBack={onBack} />
}

// ── Section 5: Brightness ─────────────────────────────────────────────────────

function QsDisplayMenu({ onBack }: { onBack: () => void }) {
  const [selectedName, setSelectedName] = createState<string>("")
  const [editingBrightness, setEditingBrightness] = createState(false)
  const [editingTemp, setEditingTemp] = createState(false)
  let brightnessEntry: Gtk.Entry
  let tempEntry: Gtk.Entry

  const commitBrightness = () => {
    const parsed = Number.parseInt(brightnessEntry?.text.trim() ?? "", 10)
    const value = Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : Math.round(brightness.get() * 100)
    setBrightness(value / 100)
    saveDisplayConfig()
    execAsync(["bash", "-c", `brightnessctl -n2 s ${value}%`]).catch(() => {})
    if (brightnessEntry) brightnessEntry.text = String(value)
    setEditingBrightness(false)
  }

  const editBrightness = () => {
    if (!brightnessEntry) return
    brightnessEntry.text = String(Math.round(brightness.get() * 100))
    setEditingBrightness(true)
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      brightnessEntry.grab_focus()
      brightnessEntry.select_region(0, -1)
      return GLib.SOURCE_REMOVE
    })
  }

  const commitTemp = () => {
    const parsed = Number.parseInt(tempEntry?.text.trim() ?? "", 10)
    const value = Number.isFinite(parsed)
      ? Math.max(1500, Math.min(6000, parsed))
      : nightLightTemp.get()
    setManualTemp(value)
    if (tempEntry) tempEntry.text = String(value)
    setEditingTemp(false)
  }

  const editTemp = () => {
    if (!tempEntry) return
    tempEntry.text = String(nightLightTemp.get())
    setEditingTemp(true)
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      tempEntry.grab_focus()
      tempEntry.select_region(0, -1)
      return GLib.SOURCE_REMOVE
    })
  }

  // El poller de monitores vive en display/service (ref-counted, compartido con
  // la sección Pantalla de Ajustes). Este menú lo adquiere solo con QS abierto Y
  // en la vista "display", y lo libera al salir.
  const evalPoll = () => {
    if (quickSettingsVisible.get() && qsView.get() === "display") acquirePoll()
    else releasePoll()
  }
  quickSettingsVisible.subscribe(evalPoll)
  qsView.subscribe(evalPoll)

  // Corrige la selección si el monitor elegido desaparece (desconexión) o si aún
  // no hay ninguno: cae al enfocado o al primero.
  const fixSelection = () => {
    const list = monitors.get()
    if (list.length && !list.some((m: any) => m.name === selectedName.get())) {
      const f = list.find((m: any) => m.focused) || list[0]
      setSelectedName(f ? f.name : "")
    }
  }
  monitors.subscribe(fixSelection)
  fixSelection()

  const selected = createComputed(() => {
    const list = monitors()
    const name = selectedName()
    return list.find((m: any) => m.name === name) || null
  })

  const enabledCount = () => monitors().filter((m: any) => !m.disabled).length
  const canDisable = (mon: any) => mon.disabled || enabledCount() > 1

  const brightScale = makeScale(
    ["qs-slider", "brightness"],
    () => brightness.get(),
    (v) => {
      setBrightness(v)
      saveDisplayConfig()
      execAsync(["bash", "-c", `brightnessctl -n2 s ${Math.round(v * 100)}%`]).catch(() => {})
    },
    (cb) => brightness.subscribe(cb),
  )

  const tempScale = makeScale(
    ["qs-slider", "temperature"],
    () => (nightLightTemp.get() - 1500) / 4500,
    (v) => setManualTemp(Math.round(v * 4500 + 1500)),
    (cb) => nightLightTemp.subscribe(cb),
  )
  nightLightTemp.subscribe(() => { tempScale.adjustment.value = (nightLightTemp.get() - 1500) / 4500 })

  return (
    <overlay cssClasses={["display-select-host"]} hexpand>
    <box cssClasses={["qs-display-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={5} hexpand>
      <QsMenuHeader title="Pantalla" onBack={onBack} />

      {/* Selector de monitor */}
      <label
        cssClasses={["qs-dropdown-header", "qs-display-detected-title"]}
        label="PANTALLAS DETECTADAS"
        halign={Gtk.Align.START}
        marginStart={10}
        marginEnd={10}
      />
      <box cssClasses={["qs-display-monitor-tabs"]} spacing={6} marginStart={10} marginEnd={10}>
        <For each={monitors}>
          {(m: any) => (
            <button
              cssClasses={selectedName((n) => n === m.name ? ["qs-display-monitor-pill", "active"] : ["qs-display-monitor-pill"])}
              onClicked={() => setSelectedName(m.name)}
            >
              <box spacing={5} valign={Gtk.Align.CENTER}>
                <label cssClasses={["qs-display-monitor-dot"]} label="●" visible={m.focused} />
                <label label={m.name} ellipsize={3} maxWidthChars={14} />
              </box>
            </button>
          )}
        </For>
      </box>

      {/* Gestión del monitor seleccionado */}
      <box cssClasses={["qs-section", "qs-display-panel"]} orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        {/* Encendido */}
        <box spacing={6} visible={createComputed(() => monitors().length > 1)}>
          <label cssClasses={["qs-section-icon"]} label="󰍹" />
          <label cssClasses={["qs-section-label"]} label="Encendido" hexpand halign={Gtk.Align.START} />
          <button
            cssClasses={createComputed(() => { const s = selected(); return s && !s.disabled ? ["qs-toggle", "on"] : ["qs-toggle"] })}
            onClicked={() => {
              const s = selected(); if (!s) return
              if (!s.disabled && !canDisable(s)) return // guarda: no apagar el último activo
              applyPatch(s, { enabled: s.disabled })
            }}
          >
            <ToggleSwitch active={createComputed(() => { const s = selected(); return s ? !s.disabled : false })} />
          </button>
        </box>

        {/* Controles (ocultos si el monitor está apagado) */}
        <box orientation={Gtk.Orientation.VERTICAL} spacing={3}
          visible={createComputed(() => { const s = selected(); return !!s && !s.disabled })}>

          {/* Resolución (lista general — Hyprland acepta modos no nativos) */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-display-compact-field"]}>
            <label cssClasses={["qs-dropdown-header"]} label="RESOLUCIÓN" halign={Gtk.Align.START} />
            <DisplaySelect
              compact
              current={createComputed(() => { const s = selected(); return s ? `${s.width}×${s.height}` : "—" })}
              options={createComputed(() => {
                const s = selected()
                if (!s || s.disabled) return []
                return resolutionOptions(s.availableModes).map(o => ({
                  label: o.label, value: o.key, active: s.width === o.w && s.height === o.h,
                }))
              })}
              onSelect={(value) => {
                const s = selected(); if (!s) return
                applyPatch(s, { mode: `${value}@${s.refreshRate.toFixed(2)}Hz` })
              }}
            />
          </box>

          {/* Frecuencia */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-display-compact-field"]}>
            <label cssClasses={["qs-dropdown-header"]} label="FRECUENCIA" halign={Gtk.Align.START} />
            <DisplaySelect
              compact
              current={createComputed(() => { const s = selected(); return s ? `${Math.round(s.refreshRate)} Hz` : "—" })}
              options={createComputed(() => {
                const s = selected()
                if (!s || s.disabled) return []
                return refreshOptions(s.availableModes).map(o => ({
                  label: `${o.hz} Hz`, value: o.raw, active: Math.round(s.refreshRate) === o.hz,
                }))
              })}
              onSelect={(value) => {
                const s = selected(); if (!s) return
                applyPatch(s, { mode: `${s.width}x${s.height}@${value}Hz` })
              }}
            />
          </box>

          {/* Escala */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-display-compact-field"]}>
            <label cssClasses={["qs-dropdown-header"]} label="ESCALA" halign={Gtk.Align.START} />
            <DisplaySelect
              compact
              current={createComputed(() => { const s = selected(); return s ? matchScalePreset(s.scale).toFixed(2) : "—" })}
              options={createComputed(() => {
                const s = selected()
                if (!s || s.disabled) return []
                const cur = matchScalePreset(s.scale)
                return SCALE_PRESETS.map(sc => ({ label: sc.toFixed(2), value: String(sc), active: sc === cur }))
              })}
              onSelect={(value) => {
                const s = selected(); if (!s) return
                applyPatch(s, { scale: Number(value) })
              }}
            />
          </box>

          {/* Duplicar (mirror) — solo con 2+ monitores */}
          <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-display-compact-field"]}
            visible={createComputed(() => monitors().length > 1)}>
            <label cssClasses={["qs-dropdown-header"]} label="DUPLICAR EN" halign={Gtk.Align.START} />
            <DisplaySelect
              compact
              current={createComputed(() => {
                const s = selected()
                return s && s.mirrorOf && s.mirrorOf !== "none" ? s.mirrorOf : "Ninguno"
              })}
              options={createComputed(() => {
                const s = selected()
                if (!s) return []
                const noMirror = !s.mirrorOf || s.mirrorOf === "none"
                const opts = [{ label: "Ninguno", value: "none", active: noMirror }]
                for (const m of monitors()) {
                  if (m.name === s.name) continue
                  opts.push({ label: m.name, value: m.name, active: s.mirrorOf === m.name })
                }
                return opts
              })}
              onSelect={(value) => {
                const s = selected(); if (!s) return
                applyPatch(s, { mirrorOf: value })
              }}
            />
          </box>
        </box>
      </box>

      {/* Brillo + Luz nocturna */}
      <box cssClasses={["qs-section", "qs-display-panel"]} orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
          <box spacing={6}>
            <label cssClasses={["qs-section-icon", "bright"]} label="󰃟" />
            <label cssClasses={["qs-section-label"]} label="Brillo" hexpand halign={Gtk.Align.START} />
            <button
              cssClasses={["qs-inline-value-btn"]}
              visible={editingBrightness((editing) => !editing)}
              onClicked={editBrightness}
              tooltipText="Editar brillo"
            >
              <label cssClasses={["qs-section-pct"]} label={brightness((v) => `${Math.round(v * 100)}`)} />
            </button>
            <Gtk.Entry
              cssClasses={["qs-inline-number-input"]}
              visible={editingBrightness}
              maxLength={3}
              widthChars={3}
              widthRequest={28}
              heightRequest={16}
              xalign={1}
              inputPurpose={Gtk.InputPurpose.DIGITS}
              $={(self: Gtk.Entry) => {
                brightnessEntry = self
                self.text = String(Math.round(brightness.get() * 100))
              }}
              onActivate={commitBrightness}
            >
              <Gtk.EventControllerFocus onLeave={commitBrightness} />
            </Gtk.Entry>
          </box>
          {brightScale}
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} cssClasses={["qs-night-light-block"]}>
          <box spacing={6}>
            <label cssClasses={["qs-section-icon", "night"]} label="󰌾" />
            <label cssClasses={["qs-section-label"]} label="Luz nocturna" hexpand halign={Gtk.Align.START} />
            <button
              cssClasses={["qs-inline-value-btn"]}
              visible={editingTemp((editing) => !editing)}
              onClicked={editTemp}
              tooltipText="Editar temperatura"
            >
              <label cssClasses={["qs-section-pct"]} label={nightLightTemp((t) => `${t}K`)} />
            </button>
            <Gtk.Entry
              cssClasses={["qs-inline-number-input"]}
              visible={editingTemp}
              maxLength={4}
              widthChars={4}
              widthRequest={34}
              heightRequest={16}
              xalign={1}
              inputPurpose={Gtk.InputPurpose.DIGITS}
              $={(self: Gtk.Entry) => {
                tempEntry = self
                self.text = String(nightLightTemp.get())
              }}
              onActivate={commitTemp}
            >
              <Gtk.EventControllerFocus onLeave={commitTemp} />
            </Gtk.Entry>
            <button
              cssClasses={nightOn((n) => n ? ["qs-toggle", "on"] : ["qs-toggle"])}
              onClicked={() => toggleNightNow()}
            >
              <ToggleSwitch active={nightOn} />
            </button>
          </box>
          {tempScale}
        </box>
      </box>
    </box>
    </overlay>
  )
}

// ── Section 6: Footer ─────────────────────────────────────────────────────────

function QsFooter() {
  const user = GLib.get_user_name() ?? "user"
  const host = GLib.get_host_name() ?? "host"
  const initials = user.slice(0, 2).toUpperCase()

  // Foto de perfil: copia única de runtime en el cache XDG
  // (~/.cache/gigios/face.png), compartida con hyprlock. La materializa
  // bin/link.sh desde el master versionado assets/face.png.
  return (
    <box cssClasses={["qs-footer"]} spacing={10}>
      <box cssClasses={["qs-user-block"]} spacing={10} hexpand halign={Gtk.Align.START}>
        <With value={avatarRevision}>{(_revision: number) =>
          GLib.file_test(AVATAR_PATH, GLib.FileTest.EXISTS) ? (
            <box cssClasses={["qs-avatar-img"]} css={`background-image: url("file://${AVATAR_PATH}");`}
              valign={Gtk.Align.CENTER} halign={Gtk.Align.START} />
          ) : <label cssClasses={["qs-avatar"]} label={initials} halign={Gtk.Align.START} />
        }</With>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={1} valign={Gtk.Align.CENTER}>
          <label cssClasses={["qs-username"]} label={user} halign={Gtk.Align.START} />
          <label cssClasses={["qs-hostname"]} label={`@${host}`} halign={Gtk.Align.START} />
        </box>
      </box>

      <button
        cssClasses={["qs-icon-btn", "qs-user-settings-btn"]}
        onClicked={() => openSettingsPanel()}
        valign={Gtk.Align.CENTER}
      >
        <label label="󰒓" />
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
  const [showUnnamed, setShowUnnamed] = createState(false)
  const [buffering, setBuffering] = createState(false)
  const [search, setSearch] = createState("")

  const matchesSearch = (dev: any, query: string) => {
    if (!query) return true
    return [dev.alias, dev.name, dev.address]
      .some((v) => v && String(v).toLowerCase().includes(query))
  }

  const update = () => {
    if (buffering.get()) return
    setDevices(bt.get_devices())
  }

  // Timers del escaneo, a nivel de componente para poder cancelarlos al cerrar.
  let scanStartTimer: number | null = null
  let scanInterval: number | null = null
  let scanStopTimer: number | null = null

  const stopScan = () => {
    if (scanStartTimer !== null) { clearTimeout(scanStartTimer); scanStartTimer = null }
    if (scanInterval !== null) { clearInterval(scanInterval); scanInterval = null }
    if (scanStopTimer !== null) { clearTimeout(scanStopTimer); scanStopTimer = null }
    if (scanning.get()) {
      try { bt.adapter?.stop_discovery() } catch {}
      setBuffering(false)
      setScanning(false)
    }
  }

  const scan = (duration: number = 15000) => {
    if (scanning.get()) return
    const adapter = bt.adapter
    if (!adapter) {
      execAsync(["notify-send", "Bluetooth Error", "Adapter is null"]).catch(() => {})
      return
    }

    setScanning(true)
    setBuffering(true)
    adapter.start_discovery()

    scanStartTimer = setTimeout(() => {
      scanStartTimer = null
      setBuffering(false)
      update()

      scanInterval = setInterval(update, 1000)

      const remaining = Math.max(0, duration - 2000)
      scanStopTimer = setTimeout(() => {
        scanStopTimer = null
        try { adapter.stop_discovery() } catch {}
        if (scanInterval !== null) { clearInterval(scanInterval); scanInterval = null }
        setScanning(false)
        update()
      }, remaining)
    }, 2000)
  }

  // A diferencia de NetworkManager (que reescanea solo al encender la radio WiFi),
  // BlueZ NO inicia discovery al encender el adaptador: hay que llamar a
  // start_discovery() explícitamente. Por eso, además de escanear al ENTRAR en la
  // vista con el BT ya encendido, hay que reintentar el escaneo cuando el usuario
  // enciende el BT estando ya dentro de la sección. El adaptador puede tardar unos
  // ms en estar disponible tras el power-on, así que reintentamos brevemente.
  let powerOnTimer: number | null = null
  const clearPowerOnTimer = () => {
    if (powerOnTimer !== null) { clearTimeout(powerOnTimer); powerOnTimer = null }
  }
  const autoScan = () => {
    if (!bt.isPowered || scanning.get()) return
    if (bt.adapter) { scan(5000); return }
    // Adaptador aún no listo tras el power-on: reintenta una vez cuando aparezca.
    clearPowerOnTimer()
    powerOnTimer = setTimeout(() => {
      powerOnTimer = null
      if (inBtView() && bt.isPowered && bt.adapter && !scanning.get()) scan(5000)
    }, 600)
  }

  // Al cerrar el panel: cortar el discovery y todos sus timers (antes la radio
  // seguía escaneando en background hasta agotar el `duration`).
  quickSettingsVisible.subscribe(() => { if (!quickSettingsVisible.get()) { stopScan(); clearPowerOnTimer() } })

  // Solo refrescamos la lista mientras la vista Bluetooth está visible. Con el QS
  // cerrado o en otra pestaña ignoramos las señales: antes cada notify::devices
  // reconstruía la lista aunque nadie la mirara (mismo patrón que el menú WiFi).
  const inBtView = () => qsView.get() === "bluetooth"
  // Al encender el BT dentro de la sección: refresco inmediato + escaneo activo.
  bt.connect("notify::is-powered", () => { if (inBtView()) { update(); autoScan() } })
  bt.connect("notify::devices", () => { if (inBtView()) update() })
  bt.connect("device-added", () => { if (inBtView()) update() })
  bt.connect("device-removed", () => { if (inBtView()) update() })

  const isMac = (str: string) => /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/i.test(str)
  const hasRealName = (dev: any) => {
    if (dev.alias && !isMac(dev.alias)) return true;
    if (dev.name && !isMac(dev.name)) return true;
    return false;
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

  const pairedBinding = createComputed(() => {
    const arr = devices() || []
    const query = search().trim().toLowerCase()
    return arr.filter(d => (d.paired || d.connected) && matchesSearch(d, query)).sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      const nameA = (a.alias || a.name || a.address || "").toLowerCase();
      const nameB = (b.alias || b.name || b.address || "").toLowerCase();
      return nameA.localeCompare(nameB);
    })
  })

  const availableBinding = createComputed(() => {
    const arr = devices() || []
    const query = search().trim().toLowerCase()
    return arr.filter(d => !d.paired && !d.connected && hasRealName(d) && matchesSearch(d, query)).sort((a, b) => {
      const nameA = (a.alias || a.name || "").toLowerCase();
      const nameB = (b.alias || b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    })
  })

  const unnamedBinding = createComputed(() => {
    const arr = devices() || []
    const query = search().trim().toLowerCase()
    return arr.filter(d => !d.paired && !d.connected && !hasRealName(d) && matchesSearch(d, query)).sort((a, b) => {
      const nameA = (a.address || "").toLowerCase();
      const nameB = (b.address || "").toLowerCase();
      return nameA.localeCompare(nameB);
    })
  })

  const renderDevice = (dev: any) => {
    const connectedBinding = createBinding(dev, "connected");
    const aliasBinding = createBinding(dev, "alias");
    
    return (
      <button
        cssClasses={connectedBinding((c) => {
          const classes = ["qs-wifi-item"];
          if (c) classes.push("active");
          else if (dev.paired) classes.push("known");
          return classes;
        })}
        onClicked={() => {
          if (dev.connected) {
            execAsync(["bluetoothctl", "disconnect", dev.address]).catch(() => {})
          } else {
            execAsync(["bluetoothctl", "connect", dev.address]).catch(() => {})
          }
        }}
      >
        <box spacing={8}>
          <QsRowLabel
            icon={<label cssClasses={["qs-wifi-icon"]} label={aliasBinding(() => getDeviceIcon(dev))} />}
            title={aliasBinding((a) => {
              if (a && !isMac(a)) return a;
              if (dev.name && !isMac(dev.name)) return dev.name;
              return dev.address || "Desconocido";
            })}
            subtitle={
              <label
                label={connectedBinding((c) => c ? "Conectado" : dev.paired ? "Vinculado" : "Disponible")}
                halign={Gtk.Align.START}
                cssClasses={["qs-wifi-sec"]}
              />
            }
          />
          <label
            label="󰄬"
            cssClasses={["qs-wifi-lock"]}
            halign={Gtk.Align.END}
            visible={connectedBinding}
          />
        </box>
      </button>
    )
  }

  // Al entrar en la vista Bluetooth: refresco inmediato desde la caché + escaneo
  // activo (mismo patrón que WiFi). autoScan() respeta el guard de `scanning` y no
  // hace nada si el BT está apagado. Al salir, stopScan() corta el discovery.
  qsView.subscribe(() => {
    if (qsView.get() !== "bluetooth") { stopScan(); clearPowerOnTimer(); return }
    update()
    autoScan()
  })

  const searchEntry = new Gtk.Entry()
  searchEntry.set_css_classes(["qs-wifi-search-entry"])
  searchEntry.set_placeholder_text("Buscar dispositivos")
  searchEntry.set_hexpand(true)
  searchEntry.set_text(search())
  searchEntry.connect("changed", () => setSearch(searchEntry.text))

  return (
    <box cssClasses={["qs-bluetooth-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <Gtk.EventControllerKey
        onKeyPressed={(self, keyval, _keycode, state) => handleSearchSectionKey(self, searchEntry, keyval, state)}
      />
      <QsMenuHeader title="Bluetooth" onBack={onBack} titleHexpand={false}>
        <box cssClasses={["qs-wifi-search"]} spacing={0} hexpand valign={Gtk.Align.CENTER}>
          {searchEntry}
        </box>
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => execAsync("blueman-manager")}
        ><label label="󰒓" /></button>
        <button
          cssClasses={scanning((s) => s ? ["qs-icon-btn", "scanning"] : ["qs-icon-btn"])}
          onClicked={() => scan()}
        ><label label="󰑐" /></button>
        <button
          cssClasses={btPowered((p) => p ? ["qs-toggle", "on"] : ["qs-toggle"])}
          onClicked={() => execAsync(["bash", "-c", bt.isPowered ? "bluetoothctl power off" : "bluetoothctl power on"])}
        >
          <ToggleSwitch active={btPowered} />
        </button>
      </QsMenuHeader>

      <Gtk.ScrolledWindow
        cssClasses={["qs-wifi-list-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vexpand
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} visible={pairedBinding((arr) => arr.length > 0)}>
            <label cssClasses={["qs-dropdown-header"]} label="VINCULADOS" halign={Gtk.Align.START} />
            <For each={pairedBinding}>
              {renderDevice}
            </For>
          </box>

          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} visible={availableBinding((arr) => arr.length > 0)}>
            <label cssClasses={["qs-dropdown-header"]} label="DISPONIBLES" halign={Gtk.Align.START} />
            <For each={availableBinding}>
              {renderDevice}
            </For>
          </box>

          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} visible={unnamedBinding((arr) => arr.length > 0)}>
            <button
              cssClasses={["qs-dropdown-header"]}
              onClicked={() => setShowUnnamed(!showUnnamed.get())}
            >
              <box spacing={6}>
                <label label="OTROS DISPOSITIVOS (MAC)" cssClasses={["qs-bt-unnamed-label"]} />
                <label label={showUnnamed((s) => s ? "󰅀" : "󰅂")} cssClasses={["qs-bt-unnamed-chevron"]} />
              </box>
            </button>
            <revealer revealChild={showUnnamed} transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN} transitionDuration={200}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                <For each={unnamedBinding}>
                  {renderDevice}
                </For>
              </box>
            </revealer>
          </box>

          <label
            label={search((q) => q.trim() ? "Sin resultados" : "No se encontraron dispositivos")}
            cssClasses={["qs-bt-empty-label"]}
            visible={createComputed(() =>
              pairedBinding().length === 0 && availableBinding().length === 0 && unnamedBinding().length === 0
            )}
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
      <QsMenuHeader title="Wi-Fi" onBack={onBack} />
      <label label="No Wi-Fi device found" halign={Gtk.Align.CENTER} />
    </box>
  )

  const [apsVar, setApsVar] = createState<any[]>(wifi.get_access_points())
  const [passwordTarget, setPasswordTarget] = createState<string | null>(null)
  const [passwordStr, setPasswordStr] = createState("")
  const [wifiState, setWifiState] = createState({ ssid: wifi.ssid || "", connecting: null as string | null })
  const [savedSsids, setSavedSsids] = createState<string[]>([])
  const [search, setSearch] = createState("")

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
  savedSsids.subscribe(() => setWifiState({ ...wifiState() }))

  // Solo procesamos señales de red mientras la vista WiFi está visible. Con QS
  // cerrado (qsView vuelve a "main") o en otra pestaña las ignoramos: antes cada
  // notify::connectivity lanzaba un pipeline nmcli|grep|cut aunque nadie mirara,
  // y una conexión dispara varias transiciones seguidas.
  const inWifiView = () => qsView.get() === "wifi"

  wifi.connect("notify::access-points", () => { if (inWifiView()) setApsVar(wifi.get_access_points()) })
  wifi.connect("notify::active-access-point", () => {
    if (!inWifiView()) return
    setApsVar(wifi.get_access_points())
    setWifiState({ ...wifiState(), ssid: wifi.ssid || "" })
  })
  wifi.connect("notify::ssid", () => {
    if (!inWifiView()) return
    setWifiState({ ...wifiState(), ssid: wifi.ssid || "" })
  })
  network.connect("notify::connectivity", () => {
    if (!inWifiView()) return
    setWifiState({ ...wifiState() })
    updateSaved()
  })

  // NM rechaza rescans muy seguidos (~10s). El escaneo automático al abrir la vista
  // respeta ese margen; el botón manual fuerza el intento.
  let lastScan = 0
  const rescan = (force = false) => {
    if (scanning.get()) return
    if (!wifi.enabled) return   // radio apagada: escanear es imposible y nmcli falla
    const now = Date.now()
    if (!force && now - lastScan < 10000) {
      setApsVar(wifi.get_access_points())
      updateSaved()
      return
    }
    lastScan = now
    setScanning(true)
    execAsync(["nmcli", "device", "wifi", "rescan"]).finally(() => {
      setTimeout(() => setScanning(false), 2000)
      updateSaved()
      setApsVar(wifi.get_access_points())
    })
  }

  // Al entrar en la vista WiFi: refresco inmediato desde la caché de NM + lista de
  // guardadas + escaneo activo (throttled). Reemplaza el rescan que hacía onWifiClick
  // y el `nmcli device wifi list` de arranque por monitor; ahora todo es perezoso.
  qsView.subscribe(() => {
    if (qsView.get() !== "wifi") return
    setApsVar(wifi.get_access_points())
    setWifiState({ ...wifiState(), ssid: wifi.ssid || "" })
    updateSaved()
    // Con la radio apagada no tiene sentido escanear ni sondear conectividad:
    // ambos nmcli fallarían/serían inútiles. La lista de guardadas (updateSaved)
    // sí se muestra para poder reconectar al reactivar el WiFi.
    if (wifi.enabled) {
      rescan()
      // Fuerza a NM a re-evaluar la conectividad ahora (en vez de esperar su chequeo
      // periódico de ~5 min). Así, si el usuario acaba de iniciar sesión en el portal,
      // el estado portal→full se limpia al instante tanto aquí como en el glifo del bar.
      execAsync(["nmcli", "networking", "connectivity", "check"]).catch(() => { })
    }
  })

  const wifiEnabled = createBinding(wifi, "enabled")
  const searchEntry = new Gtk.Entry()
  searchEntry.set_css_classes(["qs-wifi-search-entry"])
  searchEntry.set_placeholder_text("Buscar redes")
  searchEntry.set_hexpand(true)
  searchEntry.set_text(search())
  searchEntry.connect("changed", () => setSearch(searchEntry.text))

  return (
    <box cssClasses={["qs-wifi-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <Gtk.EventControllerKey
        onKeyPressed={(self, keyval, _keycode, state) => handleSearchSectionKey(self, searchEntry, keyval, state)}
      />
      <QsMenuHeader title="Wi-Fi" onBack={onBack} titleHexpand={false}>
        <box cssClasses={["qs-wifi-search"]} spacing={0} hexpand valign={Gtk.Align.CENTER}>
          {searchEntry}
        </box>
        <button
          cssClasses={["qs-icon-btn"]}
          onClicked={() => execAsync("nm-connection-editor")}
        ><label label="󰒓" /></button>
        <button
          cssClasses={scanning((s) => s ? ["qs-icon-btn", "scanning"] : ["qs-icon-btn"])}
          onClicked={() => rescan(true)}
        ><label label="󰑐" /></button>
        <button
          cssClasses={wifiEnabled((e) => e ? ["qs-toggle", "on"] : ["qs-toggle"])}
          onClicked={() => execAsync(["bash", "-c", wifi.enabled ? "nmcli radio wifi off" : "nmcli radio wifi on"])}
        >
          <ToggleSwitch active={wifiEnabled} />
        </button>
      </QsMenuHeader>

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
            const query = search().trim().toLowerCase()
            const unique = apsVar()
              .filter(ap => ap.ssid)
              .filter(ap => !query || ap.ssid.toLowerCase().includes(query))
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
                  <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["qs-wifi-item", "password-prompt"]} spacing={6}>
                    <label label={`Contraseña para ${ap.ssid}`} halign={Gtk.Align.START} cssClasses={["qs-wifi-password-label"]} />
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
                    <QsRowLabel
                      icon={
                        <box cssClasses={["qs-wifi-icon", "qs-wifi-signal"]} spacing={1} valign={Gtk.Align.CENTER}>
                          <For each={() => wifiSignalBarClasses(ap.strength ?? 0)}>
                            {(classes) => <box cssClasses={classes} valign={Gtk.Align.END} />}
                          </For>
                        </box>
                      }
                      title={ap.ssid}
                      subtitle={
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
                      }
                    />
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
  const PANEL_TOTAL_WIDTH = 350
  const PANEL_PANEL_WIDTH = 330
  const PANEL_TOP = 37
  const PANEL_PREPARE_MS = 32
  const PANEL_ENTER_MS = 280
  // Tiempo mínimo en el reloj de fotogramas antes de desmapear. La salida CSS
  // dura 220 ms; después se exige además un frame final ya fuera de pantalla.
  const PANEL_EXIT_MS = 280

  let qsPanelRef: any = null
  let qsAnimationRef: any = null
  let qsWindowRef: any = null
  const [qsRendered, setQsRendered] = createState(quickSettingsVisible.get())
  const [qsExitCss, setQsExitCss] = createState(".qs-wrapper {}")
  let enterTimer: number | null = null
  let entranceGuardTimer: number | null = null
  let exitTickId: number | null = null
  let hoverCloseTimer: number | null = null
  let entranceActive = false
  // Recorte de la región de entrada; se asigna tras construir la ventana. Debe re-ejecutarse al
  // terminar la animación de entrada (el transform de deslizamiento falsea la medida mientras corre).
  let reclipInput: (() => void) | null = null

  function cancelExitWait(): void {
    if (exitTickId === null || !qsAnimationRef) return
    qsAnimationRef.remove_tick_callback(exitTickId)
    exitTickId = null
  }

  function finishExit(): void {
    setQsRendered(false)
    exitTickId = null
    // Reiniciar el contenido solo después de que `visible=false` se haya
    // aplicado; hacerlo antes podía redimensionar el panel aún visible.
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      if (!quickSettingsVisible.get() && !qsRendered.get()) {
        setQsView("main")
        setInfoSsid(null)
      }
      return GLib.SOURCE_REMOVE
    })
  }

  function cancelHoverClose(): void {
    if (hoverCloseTimer === null) return
    GLib.source_remove(hoverCloseTimer)
    hoverCloseTimer = null
  }

  function pointerIsOverQuickSettings(): boolean {
    try {
      const surface = qsWindowRef?.get_surface()
      const pointer = qsWindowRef?.get_display()?.get_default_seat()?.get_pointer()
      if (!surface || !pointer) return false
      const [inside] = surface.get_device_position(pointer)
      return inside
    } catch (_) {
      return false
    }
  }

  function handlePointerEnter(): void {
    cancelHoverClose()
  }

  function handlePointerLeave(): void {
    cancelHoverClose()
    if (entranceActive || !quickSettingsVisible.get()) return
    hoverCloseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
      hoverCloseTimer = null
      if (quickSettingsVisible.get() && !pointerIsOverQuickSettings()) closeAllPanels()
      return GLib.SOURCE_REMOVE
    })
  }

  function beginEntrance(): void {
    if (enterTimer !== null) GLib.source_remove(enterTimer)
    if (entranceGuardTimer !== null) GLib.source_remove(entranceGuardTimer)
    entranceActive = true
    // Quitar la animación de salida dinámica mientras la ventana aún está oculta.
    setQsExitCss(".qs-wrapper {}")
    qsAnimationRef?.remove_css_class("qs-entering")
    qsAnimationRef?.add_css_class("qs-preparing")
    setQsRendered(true)

    enterTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_PREPARE_MS, () => {
      qsAnimationRef?.remove_css_class("qs-preparing")
      qsAnimationRef?.add_css_class("qs-entering")
      entranceGuardTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_ENTER_MS, () => {
        entranceActive = false
        entranceGuardTimer = null
        // El transform ya está en identidad: re-medir la región de entrada, que
        // se había calculado desplazada mientras el panel se deslizaba.
        reclipInput?.()
        return GLib.SOURCE_REMOVE
      })
      enterTimer = null
      return GLib.SOURCE_REMOVE
    })
  }

  // Mantener la ventana mapeada durante la salida permite completar el recorrido
  // hacia arriba antes de ocultarla realmente.
  quickSettingsVisible.subscribe(() => {
    cancelHoverClose()
    if (quickSettingsVisible.get()) {
      cancelExitWait()
      beginEntrance()
      return
    }

    if (enterTimer !== null) {
      GLib.source_remove(enterTimer)
      enterTimer = null
    }
    if (entranceGuardTimer !== null) {
      GLib.source_remove(entranceGuardTimer)
      entranceGuardTimer = null
    }
    entranceActive = false
    qsAnimationRef?.remove_css_class("qs-preparing")
    qsAnimationRef?.remove_css_class("qs-entering")
    // Igual que el recorrido horizontal de Notificaciones, pero usando la altura
    // real de QS: el borde inferior cruza y=0 justo en el último frame.
    const exitDistance = Math.max(1, Math.ceil(qsAnimationRef?.get_height?.() ?? 0) + 2)
    setQsExitCss(`
      @keyframes qs-panel-slide-out-dynamic {
        from { transform: translateY(0); }
        to { transform: translateY(-${exitDistance}px); }
      }
      .qs-wrapper {
        animation: qs-panel-slide-out-dynamic 220ms cubic-bezier(0.4, 0, 1, 1) forwards;
      }
    `)
    cancelExitWait()
    let firstFrameUs: number | null = null
    let finalFramePresented = false
    exitTickId = qsAnimationRef.add_tick_callback((_widget: any, frameClock: any) => {
      const nowUs = frameClock.get_frame_time()
      if (firstFrameUs === null) firstFrameUs = nowUs
      const elapsedMs = (nowUs - firstFrameUs) / 1000
      if (elapsedMs < PANEL_EXIT_MS) return true

      // Este tick dibujará el estado final. Esperar al siguiente garantiza que
      // ese frame llegó al compositor antes de ocultar la superficie.
      if (!finalFramePresented) {
        finalFramePresented = true
        return true
      }

      finishExit()
      return false
    })
  })

  const result = <window
    name="quick-settings"
    visible={qsRendered}
    gdkmonitor={gdkmonitor}
    layer={Astal.Layer.TOP}
    exclusivity={Astal.Exclusivity.NORMAL}
    keymode={Astal.Keymode.ON_DEMAND}
    anchor={TOP | RIGHT}
    application={app}
    widthRequest={PANEL_TOTAL_WIDTH}
    marginTop={barTopMargin(PANEL_TOP)}
    marginRight={0}
    decorated={false}
    cssClasses={["qs-window"]}
    $={(self: any) => { qsWindowRef = self }}
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
        cssClasses={["qs-wrapper"]}
        css={qsExitCss}
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={0}
        $={(self: any) => {
          qsAnimationRef = self
          if (quickSettingsVisible.get()) beginEntrance()
        }}
      >
      <box cssClasses={["qs-bar-connector"]} valign={Gtk.Align.START} />
      <box
        cssClasses={["qs-panel"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={3}
        overflow={Gtk.Overflow.HIDDEN}
        widthRequest={PANEL_PANEL_WIDTH}
        $={(self: any) => {
          qsPanelRef = self
        }}
      >
        <Gtk.EventControllerMotion
          onEnter={handlePointerEnter}
          onLeave={handlePointerLeave}
        />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={3} visible={qsView((v) => v === "main")}>
          <QsHeader />
          <QsTiles
            onWifiClick={() => setQsView("wifi")}
            onBluetoothClick={() => setQsView("bluetooth")}
            onDisplayClick={() => setQsView("display")}
            onAudioClick={() => setQsView("audio")}
            onMicClick={() => setQsView("mic")}
          />
          <QsMedia />
          <QsFooter />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} visible={qsView((v) => v === "wifi")}>
          <QsWifiMenu onBack={() => setQsView("main")} />
        </box>

        <box
          orientation={Gtk.Orientation.VERTICAL}
          visible={qsView((v) => v === "display")}
          widthRequest={PANEL_PANEL_WIDTH - 10}
          hexpand
        >
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
      </box>
    </window>

  reclipInput = clipWindowInputToContent(result, qsPanelRef)
  return result
}
