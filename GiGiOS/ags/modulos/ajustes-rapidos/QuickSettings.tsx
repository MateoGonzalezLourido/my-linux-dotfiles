import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, For, With, createComputed, onCleanup } from "ags"
import { createBinding } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import ProfileAvatar from "../ajustes/ProfileAvatar"
import Interruptor from "../../componentes/Interruptor"
import { barTopMargin, clasesFondoShell } from "../ajustes/preferences"
import AstalWp from "gi://AstalWp"
import AstalNetwork from "gi://AstalNetwork"
import AstalBluetooth from "gi://AstalBluetooth"
import AstalNotifd from "gi://AstalNotifd"
import AstalHyprland from "gi://AstalHyprland"
import Gio from "gi://Gio"
import GdkPixbuf from "gi://GdkPixbuf"
import cairo from "gi://cairo"
import {
  quickSettingsVisible,
  closeAllPanels,
  alternarPanelNotificaciones,
  nightLightTemp,
  qsView,
  setQsView,
  infoSsid,
  setInfoSsid,
  openSettingsPanel,

  brightness
} from "../../estado/shell"
import { applyBrightness, brightnessSupported } from "../../servicios/pantalla/brightness"
import { gamemodeAvailable, gamemodeActive, toggleGamemode } from "../../servicios/energia/gamemode"
import { forcePowerSave, setForcePowerSave, powerSaveActive } from "../../servicios/energia/powerState"
import { GLIFO_JUEGO as GAME_GLYPH } from "../../servicios/juegos/iconos"
import { clipWindowInputToContent } from "../../utilidades/inputRegion"
import * as Spotify from "../../servicios/spotify/SpotifyService"
import {
  matchScalePreset,
  resolutionOptions,
  refreshOptions,
  SCALE_PRESETS,
} from "../../servicios/pantalla/modes"
import {
  monitors, saveDisplayConfig,
  applyPatch, acquirePoll, releasePoll,
  initDisplayService, setManualTemp, nightOn, toggleNightNow,
} from "../../servicios/pantalla/service"
import { DisplaySelect } from "../../servicios/pantalla/controls"
import { InlineEditableValue } from "../../componentes/InlineEditableValue"
import { conectarCambioDeslizador } from "../../utilidades/deslizador"
import { obtenerGlifoAplicacion as getIcon } from "../../servicios/aplicaciones/glifos"
import { obtenerEntradaEscritorio } from "../../servicios/aplicaciones/entradasEscritorio"
import {
  reabrirVentanaRestauracion,
  resolverRestauracionBluetooth,
  valorBluetoothParaGuardar,
} from "../../servicios/bluetooth/estadoInicio"
import { getBluetoothTileInfo } from "../../servicios/bluetooth/tileState"
import { resolveMediaLengthSeconds, safeMediaPosition } from "../../servicios/multimedia/mediaProgress"
import { findMediaClient } from "../../servicios/multimedia/mediaClient"
import {
  obtenerEstadoReproductor,
  reproductoresMultimedia,
  revisionMultimedia,
} from "../../servicios/multimedia/mpris"

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
// Al conectar un dispositivo de audio pasa a ser la salida/entrada por defecto.
// `speaker-added` NO significa "alguien acaba de enchufar algo", y creerlo costó
// dos bugs distintos — los dos dejaban el sonido en el HDMI de la GPU, que aquí no
// tiene NADA conectado (es una salida interna), y el default así fijado se persiste
// (`default.configured.audio.sink`), así que el estropicio sobrevivía al reinicio:
//
// 1. AstalWp lo emite también por cada endpoint que YA existía al arrancar el shell
//    (medido: HDMI y analógico, ~8 ms entre medias). Esa ráfaga de enumeración hacía
//    que se pusiera por defecto CADA sink, en execAsync concurrentes donde ganaba el
//    último en *terminar* — moneda al aire en cada arranque. → gate de asentamiento.
//
// 2. Y lo emite otra vez cada vez que un nodo se RECREA. El HDMI/DP no es un
//    dispositivo que se enchufe: su nodo se destruye y se recrea al reconfigurar los
//    monitores (`hyprctl reload`, DPMS, apagar la pantalla), y esa recreación llega
//    aquí indistinguible de unos cascos recién puestos. → nunca es destino.
//
// El gate de (1) no cubre (2) —la recreación llega mucho después de arrancar— ni al
// revés, así que hacen falta los dos.
const AUDIO_SETTLE_MS = 1500

// El nombre de nodo es la única señal fiable para reconocer una salida de pantalla:
// `Endpoint.name` viene a null, y el `icon` es el mismo ("audio-card-analog-pci") en
// el HDMI que en el analógico. Las claves de `wpctl inspect` no se traducen; la
// `description` sí, así que buscar "(HDMI)" ahí dependería del locale.
const nodeNameOf = async (id: number): Promise<string> => {
  const out = await execAsync(["wpctl", "inspect", String(id)]).catch(() => "")
  return /node\.name\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? ""
}
const isDisplayOutput = (nodeName: string) => /hdmi|displayport|iec958/i.test(nodeName)

try {
  const wp = AstalWp.get_default()
  const audio = wp?.audio
  if (audio) {
    let settled = false
    let settleTimer: number | null = null

    const armSettle = () => {
      if (settleTimer !== null) GLib.source_remove(settleTimer)
      settleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUDIO_SETTLE_MS, () => {
        settleTimer = null
        // Sin endpoints todavía, WirePlumber no ha enumerado nada: seguir esperando,
        // o la ráfaga que está por llegar se tomaría por conexiones reales.
        if (audio.get_speakers().length === 0) armSettle()
        else settled = true
        return GLib.SOURCE_REMOVE
      })
    }
    armSettle()

    // Un solo `set-default` por ráfaga: si entran dos endpoints casi a la vez, dos
    // execAsync concurrentes pueden resolverse en cualquier orden. Esto los colapsa
    // y deja ganar al último *pedido*, no al último en terminar.
    const switchOnConnect = (skipDisplayOutputs: boolean) => {
      let pending: number | null = null
      let timer: number | null = null
      return (id: number) => {
        pending = id
        if (timer !== null) GLib.source_remove(timer)
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
          timer = null
          const target = pending
          pending = null
          if (target === null) return GLib.SOURCE_REMOVE
          void (async () => {
            if (skipDisplayOutputs && isDisplayOutput(await nodeNameOf(target))) return
            await execAsync(["wpctl", "set-default", String(target)])
          })().catch(() => {})
          return GLib.SOURCE_REMOVE
        })
      }
    }
    const switchSpeaker = switchOnConnect(true)
    const switchMic = switchOnConnect(false)

    audio.connect("speaker-added", (_, speaker) => {
      if (!settled) { armSettle(); return }
      switchSpeaker(speaker.id)
    })
    audio.connect("microphone-added", (_, mic) => {
      if (!settled) { armSettle(); return }
      switchMic(mic.id)
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

// Algunos adaptadores USB aparecen en BlueZ pero quedan bloqueados por rfkill
// (`PowerState: off-blocked`). En ese estado `bluetoothctl power on` falla con
// org.bluez.Error.Blocked: primero hay que desbloquear la radio y dar tiempo a
// BlueZ para actualizar/crear el controlador. Los portátiles sin bloqueo siguen
// la misma ruta; si no tienen `rfkill`, bluetoothctl conserva el fallback normal.
let bluetoothPowerChanging = false

function bluetoothPowerDelay(ms: number) {
  return new Promise<void>((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve()
      return GLib.SOURCE_REMOVE
    })
  })
}

function bluetoothPowerError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function setBluetoothPower(powered: boolean, notifyOnError = true) {
  if (bluetoothPowerChanging) return false
  if (!AstalBluetooth.get_default()?.adapter) return false
  bluetoothPowerChanging = true

  try {
    if (!powered) {
      await execAsync(["bluetoothctl", "power", "off"])
      return true
    }

    // Un dongle puede no estar sujeto a rfkill; no abortamos si el comando no
    // existe o no encuentra radios porque BlueZ aún puede encender el adaptador.
    try {
      await execAsync(["rfkill", "unblock", "bluetooth"])
    } catch (error) {
      console.warn(`No se pudo desbloquear Bluetooth con rfkill: ${bluetoothPowerError(error)}`)
    }

    // Al desbloquear algunos dongles el kernel inicia por sí mismo una transición
    // `off-enabling`; durante ese intervalo BlueZ responde Error.Busy. Otros USB
    // desaparecen unos segundos de BlueZ mientras se reenumeran y vuelven ya
    // encendidos. Dejamos que avance y comprobamos ambas vías en cada intento.
    await bluetoothPowerDelay(250)
    let lastError: unknown = new Error("BlueZ no encontró un controlador Bluetooth")
    for (let attempt = 0; attempt < 16; attempt++) {
      if (AstalBluetooth.get_default()?.isPowered) return true
      try {
        await execAsync(["bluetoothctl", "power", "on"])
        return true
      } catch (error) {
        lastError = error
        await bluetoothPowerDelay(350)
      }
    }
    if (AstalBluetooth.get_default()?.isPowered) return true
    throw lastError
  } catch (error) {
    console.error(`No se pudo ${powered ? "encender" : "apagar"} Bluetooth: ${bluetoothPowerError(error)}`)
    if (notifyOnError) {
      execAsync([
        "notify-send",
        "Bluetooth",
        `No se pudo ${powered ? "encender" : "apagar"} el adaptador`,
      ]).catch(() => {})
    }
    return false
  } finally {
    bluetoothPowerChanging = false
  }
}

function toggleBluetoothPower(bt: any) {
  const objetivo = !bt.isPowered
  // Una acción explícita del usuario cierra la restauración de arranque y pasa a ser la
  // intención vigente: manda lo que acaba de pedir, no lo que había guardado, y es lo que se
  // volverá a aplicar la próxima vez que el dongle reaparezca. Sin cerrar la restauración,
  // encender el BT dentro de la ventana de asentamiento haría que se lo volviera a apagar
  // en la cara.
  finalizarRestauracionBluetooth(objetivo)
  return setBluetoothPower(objetivo)
}

// ── System State Persistence (Wifi, BT, Vol) ──────────────────────────────────
const RUTA_ESTADO_SISTEMA = `${GLib.get_user_config_dir()}/gigios/system_state.json`

function cargarEstadoSistemaGuardado(): Record<string, unknown> {
  if (!GLib.file_test(RUTA_ESTADO_SISTEMA, GLib.FileTest.EXISTS)) return {}

  try {
    const [ok, contenido] = GLib.file_get_contents(RUTA_ESTADO_SISTEMA)
    if (ok) {
      const estado = JSON.parse(new TextDecoder().decode(contenido))
      if (estado && typeof estado === "object" && !Array.isArray(estado)) return estado
    }
  } catch (error) {
    console.warn(`No se pudo leer el estado del sistema: ${bluetoothPowerError(error)}`)
  }
  return {}
}

const estadoSistemaGuardado = cargarEstadoSistemaGuardado()

// Intención Bluetooth del usuario: nace del disco, la fija su pulsación del interruptor y la
// adopta cualquier cambio externo hecho con la restauración ya cerrada y el adaptador presente.
// Es a la vez el OBJETIVO de la restauración y el valor que se persiste. Antes eran dos
// variables —`objetivoBluetoothInicial`, congelada en el arranque, y
// `ultimoEstadoBluetoothConfirmado`, la que se guardaba— y en cuanto la restauración se reabre a
// mitad de sesión (ver `reabrirVentanaRestauracion`) podían decir cosas distintas: la ventana
// nueva habría restaurado el valor del arranque en vez del último que pidió el usuario.
let intencionBluetooth: boolean | null = typeof estadoSistemaGuardado.bluetooth === "boolean"
  ? estadoSistemaGuardado.bluetooth
  : null
let restauracionBluetoothCompletada = intencionBluetooth === null
let restauracionBluetoothEnCurso = false

// Ventana de asentamiento del adaptador. BlueZ registra el adaptador y solo DESPUÉS lo
// enciende por su cuenta (`AutoEnable`); entre las dos cosas el adaptador existe y está
// apagado, que es indistinguible de "el usuario lo dejó apagado". Sin esta espera la
// restauración se cerraba ahí y el power-on posterior de BlueZ se guardaba como decisión
// del usuario: el "apagado" se perdía en cada arranque. Ver `resolverRestauracionBluetooth`.
// Se cuenta desde que el adaptador APARECE, no desde que arranca AGS —igual que el gate de
// audio de arriba—: es un dongle USB y puede tardar en enumerarse, así que una gracia
// contada desde el arranque del shell expiraría antes de que BlueZ llegue siquiera a verlo.
const BT_SETTLE_MS = 5000
let bluetoothAsentado = false
let temporizadorAsentadoBt: number | null = null
/** Última generación vista del adaptador; su alta reabre la ventana de restauración. */
let habiaAdaptadorBluetooth = false

function armarAsentadoBluetooth() {
  if (bluetoothAsentado || temporizadorAsentadoBt !== null) return
  if (!AstalBluetooth.get_default()?.adapter) return
  temporizadorAsentadoBt = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BT_SETTLE_MS, () => {
    temporizadorAsentadoBt = null
    bluetoothAsentado = true
    // Reevalúa: si el estado ya coincidía y solo faltaba asentarse, esto la cierra.
    void restaurarEstadoInicialBluetooth()
    return GLib.SOURCE_REMOVE
  })
}

function finalizarRestauracionBluetooth(intencion?: boolean) {
  bluetoothAsentado = true
  if (temporizadorAsentadoBt !== null) {
    GLib.source_remove(temporizadorAsentadoBt)
    temporizadorAsentadoBt = null
  }
  restauracionBluetoothCompletada = true
  if (intencion !== undefined) intencionBluetooth = intencion
}

/**
 * Reabre la ventana de restauración: el adaptador que tenemos delante es NUEVO para BlueZ, así
 * que su `AutoEnable` va a encenderlo igual que en el arranque y hay que volver a corregirlo.
 * Ver `reabrirVentanaRestauracion` para el porqué; aquí solo se aplica el estado que devuelve.
 */
function rearmarRestauracionBluetooth() {
  const ventana = reabrirVentanaRestauracion(intencionBluetooth)
  if (temporizadorAsentadoBt !== null) {
    GLib.source_remove(temporizadorAsentadoBt)
    temporizadorAsentadoBt = null
  }
  restauracionBluetoothCompletada = ventana.completada
  bluetoothAsentado = ventana.asentado
  // Con intención nula las dos llamadas son no-ops: la ventana nace ya cerrada.
  armarAsentadoBluetooth()
  void restaurarEstadoInicialBluetooth()
}

/**
 * Reabre la ventana también AL DESPERTAR, y no sobra con el alta del adaptador.
 *
 * Que el dongle se reenumere al volver de una suspensión depende del hardware y del modo de
 * suspensión: si el kernel lo recupera con `reset_resume` el objeto de BlueZ nunca desaparece,
 * así que no hay alta que observar — pero el controlador sí ha pasado por un reinicio y BlueZ
 * puede volver a encenderlo. Esto cubre ese caso; cuando sí hay reenumeración las dos rutas se
 * solapan y la segunda reapertura es idempotente.
 *
 * Fail-open: sin logind no hay señal y se degrada al comportamiento de antes.
 */
function vigilarSuspensionBluetooth() {
  try {
    const bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null)
    bus.signal_subscribe(
      "org.freedesktop.login1",
      "org.freedesktop.login1.Manager",
      "PrepareForSleep",
      "/org/freedesktop/login1",
      null,
      Gio.DBusSignalFlags.NONE,
      (_c, _s, _p, _i, _sig, params) => {
        // `true` = nos vamos a dormir; `false` = ya hemos vuelto, que es cuando el adaptador
        // puede haber revivido encendido por su cuenta.
        const [durmiendo] = params.deep_unpack() as [boolean]
        if (!durmiendo) rearmarRestauracionBluetooth()
      },
    )
  } catch (error) {
    console.warn(`No se pudo vigilar la suspensión para Bluetooth: ${bluetoothPowerError(error)}`)
  }
}

/**
 * Y la reabre también cuando la radio pasa por un BLOQUEO de rfkill.
 *
 * Tercera vía por la que BlueZ enciende el controlador sin que lo pida nadie, y la única que se
 * reproduce sin privilegios: `rfkill block bluetooth` deja el adaptador en `PowerState:
 * off-blocked` **sin darlo de baja** (el objeto de `org.bluez` sigue ahí), así que no hay alta que
 * observar; al desbloquear, BlueZ lo enciende él solo. Medido en esta máquina con la restauración
 * ya cerrada y `bluetooth: false` en disco: block + unblock terminaba con `Powered: yes` y el
 * fichero reescrito a `true` — el mismo borrado del "apagado" del usuario que los otros dos casos.
 *
 * Se engancha a `off-blocked` (la entrada al bloqueo) y no al encendido posterior, porque es lo
 * único que distingue este encendido de uno que el usuario haya pedido a mano con `bluetoothctl` o
 * blueman: esos **sí** se adoptan, y pelearse con ellos sería peor que el bug. `on-disabling` y
 * `off-enabling`, que son los estados por los que pasa un apagado/encendido normal, se ignoran a
 * propósito.
 */
function vigilarBloqueoRadioBluetooth() {
  try {
    const bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null)
    bus.signal_subscribe(
      "org.bluez",
      "org.freedesktop.DBus.Properties",
      "PropertiesChanged",
      null,
      "org.bluez.Adapter1",
      Gio.DBusSignalFlags.NONE,
      (_c, _s, _p, _i, _sig, params) => {
        // `lookup_value` de la clave suelta, no `recursiveUnpack()` del `a{sv}` entero: el mismo
        // criterio que la ingesta de notificaciones.
        const estado = params
          .get_child_value(1)
          .lookup_value("PowerState", GLib.VariantType.new("s"))
        if (estado?.get_string()[0] === "off-blocked") rearmarRestauracionBluetooth()
      },
    )
  } catch (error) {
    console.warn(`No se pudo vigilar el bloqueo de radio Bluetooth: ${bluetoothPowerError(error)}`)
  }
}

let temporizadorGuardadoSistema: number | null = null
function programarGuardadoEstadoSistema(demora: number) {
  if (temporizadorGuardadoSistema !== null) GLib.source_remove(temporizadorGuardadoSistema)
  temporizadorGuardadoSistema = GLib.timeout_add(GLib.PRIORITY_DEFAULT, demora, () => {
    try {
      const directorio = GLib.path_get_dirname(RUTA_ESTADO_SISTEMA)
      if (!GLib.file_test(directorio, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(directorio, 0o755)
      
      const wp = AstalWp.get_default()
      const altavoz = wp?.audio?.defaultSpeaker
      const red = AstalNetwork.get_default()
      const bluetooth = AstalBluetooth.get_default()
      
      const configuracion = {
        wifi: red?.wifi?.enabled ?? true,
        bluetooth: valorBluetoothParaGuardar(
          intencionBluetooth,
          restauracionBluetoothCompletada,
          !!bluetooth?.adapter,
          bluetooth?.isPowered ?? false,
        ),
        volume: altavoz?.volume ?? 0.5,
        mute: altavoz?.mute ?? false
      }
      GLib.file_set_contents(RUTA_ESTADO_SISTEMA, JSON.stringify(configuracion))
    } catch (error) {
      console.warn(`No se pudo guardar el estado del sistema: ${bluetoothPowerError(error)}`)
    }
    temporizadorGuardadoSistema = null
    return GLib.SOURCE_REMOVE
  })
}

function guardarEstadoSistema() {
  programarGuardadoEstadoSistema(2000)
}

function guardarEstadoSistemaAhora() {
  programarGuardadoEstadoSistema(0)
}

function registrarEstadoBluetoothConfirmado() {
  const bluetooth = AstalBluetooth.get_default()
  if (restauracionBluetoothCompletada && bluetooth?.adapter)
    intencionBluetooth = bluetooth.isPowered
}

async function restaurarEstadoInicialBluetooth() {
  if (restauracionBluetoothCompletada || restauracionBluetoothEnCurso) return

  const bluetooth = AstalBluetooth.get_default()
  const estado = resolverRestauracionBluetooth(
    intencionBluetooth,
    !!bluetooth?.adapter,
    bluetooth?.isPowered ?? false,
    bluetoothAsentado,
  )
  if (estado.completada) {
    restauracionBluetoothCompletada = true
    return
  }
  if (estado.accion === null) return

  restauracionBluetoothEnCurso = true
  try {
    await setBluetoothPower(estado.accion, false)
  } finally {
    restauracionBluetoothEnCurso = false
    const bluetoothActual = AstalBluetooth.get_default()
    const estadoActual = resolverRestauracionBluetooth(
      intencionBluetooth,
      !!bluetoothActual?.adapter,
      bluetoothActual?.isPowered ?? false,
      bluetoothAsentado,
    )
    if (estadoActual.completada) {
      restauracionBluetoothCompletada = true
      registrarEstadoBluetoothConfirmado()
      guardarEstadoSistemaAhora()
    }
  }
}

try {
  const wp = AstalWp.get_default()
  const network = AstalNetwork.get_default()
  const bt = AstalBluetooth.get_default()
  
  if (network?.wifi) network.wifi.connect("notify::enabled", guardarEstadoSistema)
  if (bt) {
    const sincronizarEstadoBluetooth = () => {
      // Un adaptador que pasa de ausente a presente es una GENERACIÓN NUEVA para BlueZ, no el
      // mismo de antes: al volver de una suspensión el dongle USB se reenumera y su AutoEnable
      // lo enciende otra vez. Reabrir aquí la ventana de restauración es lo que impide que ese
      // encendido se adopte como decisión del usuario y borre su "apagado" del disco.
      const hayAdaptador = !!bt.adapter
      if (hayAdaptador !== habiaAdaptadorBluetooth) {
        habiaAdaptadorBluetooth = hayAdaptador
        if (hayAdaptador) rearmarRestauracionBluetooth()
      }
      armarAsentadoBluetooth()
      void restaurarEstadoInicialBluetooth()
      registrarEstadoBluetoothConfirmado()
      guardarEstadoSistemaAhora()
    }
    bt.connect("notify::is-powered", sincronizarEstadoBluetooth)
    bt.connect("notify::adapter", sincronizarEstadoBluetooth)
    bt.connect("adapter-added", sincronizarEstadoBluetooth)
    // `adapter-removed` también, y no es simetría gratuita: es lo único que baja
    // `habiaAdaptadorBluetooth` cuando el adaptador desaparece ya apagado (ahí AstalBluetooth
    // no emite `notify::is-powered`, porque su valor no cambia), y sin esa bajada la vuelta del
    // dongle no se vería como generación nueva.
    bt.connect("adapter-removed", sincronizarEstadoBluetooth)
    vigilarSuspensionBluetooth()
    vigilarBloqueoRadioBluetooth()
  }
  if (wp?.audio) {
    wp.audio.connect("notify::default-speaker", () => {
      const spk = wp.audio?.defaultSpeaker
      if (spk) {
        spk.connect("notify::volume", guardarEstadoSistema)
        spk.connect("notify::mute", guardarEstadoSistema)
      }
      guardarEstadoSistema()
    })
    if (wp.audio.defaultSpeaker) {
      wp.audio.defaultSpeaker.connect("notify::volume", guardarEstadoSistema)
      wp.audio.defaultSpeaker.connect("notify::mute", guardarEstadoSistema)
    }
  }
} catch(e) {}

// AstalBluetooth enumera los adaptadores de forma asíncrona. El primer idle cubre
// los ya disponibles y las señales de arriba reintentan cuando BlueZ registra uno;
// hasta entonces las demás escrituras conservan el valor Bluetooth leído del disco.
GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
  // Siembra la generación vista: el adaptador que ya esté aquí no es un alta, su ventana de
  // restauración es la del arranque y ya está abierta. Sin sembrarlo, la primera señal la
  // contaría como generación nueva y reiniciaría el asentamiento sin motivo.
  habiaAdaptadorBluetooth = !!AstalBluetooth.get_default()?.adapter
  armarAsentadoBluetooth()
  void restaurarEstadoInicialBluetooth()
  registrarEstadoBluetoothConfirmado()
  try {
    const network = AstalNetwork.get_default()
    if (network?.wifi) {
      if (estadoSistemaGuardado.wifi === false && network.wifi.enabled)
        execAsync(["nmcli", "radio", "wifi", "off"]).catch(() => {})
      else if (estadoSistemaGuardado.wifi === true && !network.wifi.enabled)
        execAsync(["nmcli", "radio", "wifi", "on"]).catch(() => {})
    }
  } catch(e) {}
  return GLib.SOURCE_REMOVE
})

// ── Utilities ──────────────────────────────────────────────────────────────────

function getTime() { return GLib.DateTime.new_now_local().format("%H:%M") ?? "" }
function getDate() { return GLib.DateTime.new_now_local().format("%A, %-d %B") ?? "" }
function clamp(v: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)) }

// Techo de volumen de ENTRADA (micrófono), en fracción cruda de PipeWire (0-1).
// En este equipo (Realtek ALC897, mic frontal) PipeWire combina "Capture" +
// "Front Mic Boost" en una única curva cúbica cuyo 100% ronda +60dB de ganancia
// analógica total — mucho más de lo que necesita un micro de sobremesa a
// distancia normal, y la causa medida de la saturación al subir el slider.
// Se remapea el 0-100% que ve el usuario a 0-MIC_SAFE_MAX de esa curva real,
// calibrado grabando voz real y midiendo el pico en dBFS (ver GiGiOS/CLAUDE.md).
// Así el 100% de la UI es siempre "el máximo seguro medido", nunca el máximo
// físico del hardware.
export const MIC_SAFE_MAX = 0.40
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
  layout: { hexpand?: boolean; heightRequest?: number; widthRequest?: number; max?: number } = {},
): Gtk.Scale {
  const max = layout.max ?? 1
  const adj = new Gtk.Adjustment({ lower: 0, upper: max, stepIncrement: 0.01 })
  adj.value = clamp(getValue(), 0, max)
  if (subscribe) {
    subscribe(() => { adj.value = clamp(getValue(), 0, max) })
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

  conectarCambioDeslizador(scale, (val) => setValue(clamp(val, 0, max)))
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
        {/* Modo ahorro: fuerza el ahorro de energía (forcePowerSave), el mismo
            interruptor de Ajustes > Energía. A la izquierda del modo juego. */}
        <button
          cssClasses={["bar-pill", "nb-pill"]}
          tooltipText={forcePowerSave((a) => a
            ? "Modo ahorro forzado activo · toca para desactivar"
            : "Modo ahorro · forzar el ahorro de energía")}
          onClicked={() => setForcePowerSave(!forcePowerSave.get())}
        >
          <label
            cssClasses={forcePowerSave((a) => a ? ["nb-icon", "ps-icon", "active"] : ["nb-icon", "ps-icon"])}
            label="󰌪"
          />
        </button>
        {/* Modo juego (Feral GameMode). Oculto si el paquete no está instalado:
            sin `gamemoded` el botón no podría hacer nada. */}
        <button
          visible={gamemodeAvailable}
          cssClasses={["bar-pill", "nb-pill"]}
          tooltipText={gamemodeActive((a) => a
            ? "Modo juego activo · GameMode prioriza el sistema para jugar"
            : "Modo juego · activar GameMode")}
          onClicked={toggleGamemode}
        >
          <label
            cssClasses={gamemodeActive((a) => a ? ["nb-icon", "gm-icon", "active"] : ["nb-icon", "gm-icon"])}
            label={GAME_GLYPH}
          />
        </button>
        <button
          cssClasses={["bar-pill", "nb-pill"]}
          onClicked={alternarPanelNotificaciones}
        >
          <label
            cssClasses={notifs((n) => n.length > 0 ? ["nb-icon", "has-notifs"] : ["nb-icon"])}
            label="󰂚"
          />
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

function QsTile({ icon, iconWidget, label, subtitle, active, onToggle, onRightClick, subtitleWidthRequest }: {
  icon: any, iconWidget?: any, label: any, subtitle: any, active: any, onToggle: () => void, onRightClick?: () => void, subtitleWidthRequest?: number
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
        <label cssClasses={["qs-tile-arrow"]} label="󰅂" halign={Gtk.Align.END} />
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

  // Tile de red consciente de ethernet: si network.primary es WIRED y el cable
  // está activo, muestra el nombre del perfil de NetworkManager (p. ej. "Casa");
  // si no, mantiene el comportamiento WiFi de siempre mostrando el SSID.
  const NET_P  = AstalNetwork.Primary
  const NET_DS = AstalNetwork.DeviceState
  const ETHERNET_GLYPH = "󰈀"   // nf-md-ethernet
  const computeNetTile = () => {
    const wired = network.wired
    const onWired = network.primary === NET_P.WIRED
      && !!wired && wired.state === NET_DS.ACTIVATED
    if (onWired) return {
      icon: ETHERNET_GLYPH,
      label: network.client.get_primary_connection()?.get_id() || "Ethernet",
      active: true,
    }
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
  if (network.wired) {
    network.wired.connect("notify::state", syncNetTile)
  }
  network.client.connect("notify::primary-connection", syncNetTile)
  network.client.get_primary_connection()?.connect("notify::id", syncNetTile)
  quickSettingsVisible.subscribe(() => {
    if (quickSettingsVisible.get()) syncNetTile()
  })
  const wifiStrength = wifi ? createBinding(wifi, "strength") : null

  // Estado ÚNICO del tile de Bluetooth: icono, texto y CSS (`active`) salen del
  // mismo objeto y del mismo setter. Antes el CSS venía por su cuenta de un
  // `createComputed` sobre `createBinding(bt, "isPowered")` mientras el texto
  // salía de aquí: dos lecturas del mismo hecho actualizadas por handlers
  // distintos de `notify::is-powered`, que GObject invoca en orden de conexión.
  // El del texto se conecta aquí (construcción del componente) y el del binding
  // al renderizar, o sea después, así que el CSS iba un handler por detrás y los
  // dos se contradecían — medido: `CSS=ACTIVE` con `TEXTO="Desactivado"`. Con una
  // sola fuente no hay dos relojes que sincronizar.
  const leerBtInfo = () => getBluetoothTileInfo(!!bt.adapter, bt.isPowered, bt.get_devices())
  const [btInfoState, setBtInfoState] = createState(leerBtInfo())
  const syncBtInfo = () => setBtInfoState(leerBtInfo())
  bt.connect("notify::is-powered", syncBtInfo)
  // Conectar/desconectar un dispositivo YA emparejado no toca la lista, así que
  // `notify::devices` no salta y el tile se quedaba en "Desconectado" con los
  // cascos puestos. `is-connected` ("true si alguno de los devices está
  // conectado") es justo esa señal.
  bt.connect("notify::is-connected", syncBtInfo)
  bt.connect("notify::devices", syncBtInfo)
  bt.connect("notify::adapter", syncBtInfo)
  bt.connect("adapter-added", syncBtInfo)
  bt.connect("adapter-removed", syncBtInfo)
  // Y un resembrado al ABRIR el panel, igual que el tile de red.
  //
  // No sustituye a las señales: cubre que se pierda alguna. `btInfoState` es una FOTO, y una foto
  // que se pierda una emisión miente el resto de la sesión; el interruptor del submenú de
  // Bluetooth es un `createBinding`, que relee la propiedad y por tanto se recompone solo. Esa
  // asimetría es exactamente el síntoma reportado —el texto en "Desactivado" con el interruptor
  // encendido—, así que la foto necesita un punto de reconciliación con lo real, y abrir el panel
  // es el único momento en que alguien mira el tile. No se ha aislado qué emisión concreta se
  // pierde (el ciclo quitar/poner adaptador de AstalBluetooth acaba siempre en un `sync()` que
  // debería notificar), así que esto ataca la clase entera en vez de un caso.
  quickSettingsVisible.subscribe(() => { if (quickSettingsVisible.get()) syncBtInfo() })

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
          onRightClick={() => wifi && execAsync(["bash", "-c", wifi.enabled ? "nmcli radio wifi off" : "nmcli radio wifi on"])}
        />
        <QsTile
          icon={speakerVol && speakerMute ? speakerVol((v) => volIcon(v, speakerMute())) : "󰕾"}
          label="Volumen"
          subtitle={speakerVol ? speakerVol((v) => `${Math.round(v * 100)}`) : "—"}
          active={speakerMute ? speakerMute((m) => !m) : true}
          onToggle={onAudioClick}
          onRightClick={() => { if (speaker) speaker.mute = !speaker.mute }}
        />
        <QsTile
          icon="󰍹"
          label="Pantalla"
          subtitle={monitor}
          active={nightOn}
          onToggle={onDisplayClick}
          onRightClick={() => toggleNightNow()}
        />
      </box>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand>
        <QsTile
          icon={btInfoState((i) => i.icon)}
          label="Bluetooth"
          subtitle={btInfoState((i) => i.label)}
          active={btInfoState((i) => i.active)}
          onToggle={onBluetoothClick}
          onRightClick={() => { void toggleBluetoothPower(bt) }}
        />
        <QsTile
          icon={micMute ? micMute((m) => m ? "󰍭" : "󰍬") : "󰍬"}
          label="Micrófono"
          subtitle={micVol ? micVol((v) => `${Math.round(v * 100)}`) : "—"}
          active={micMute ? micMute((m) => !m) : true}
          onToggle={onMicClick}
          onRightClick={() => { if (mic) mic.mute = !mic.mute }}
        />
      </box>
    </box>
  )
}


// ── Section 3: Media Player ───────────────────────────────────────────────────

const ACENTO_MEDIA_PREDETERMINADO = "#89b4fa"

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

// Tono COMPAÑERO de las ondas: sale de la misma semilla que el resto de la tarjeta,
// pero con reglas propias, para que las dos ondas no sean el mismo color repetido a
// distinto alfa. Tres diferencias respecto a `oneUiFgTone`, y las tres importan:
// gira el hue ~27° (análogo — un giro mayor se pelea con la carátula, del que sale
// el color), sube algo la saturación y sobre todo lo **aclara** (0.68 frente a 0.55).
// La luminosidad es lo que de verdad separa las dos ondas cuando la carátula es
// monocroma y el giro de hue no se aprecia: ahí la diferencia de color no existiría
// y seguirían distinguiéndose por claridad.
function oneUiOndaTone(rgb: [number, number, number]): [number, number, number] {
  const [h, s] = rgbToHsl(rgb)
  const hue = (h + 0.075) % 1
  const sat = Math.min(0.46, s * 0.55 + 0.16)
  return hslToRgb([hue, sat, 0.68])
}

function cssRgbToTuple(rgb: string): [number, number, number] {
  const values = rgb.match(/\d+/g)?.map(Number)
  if (!values || values.length < 3) return hexToRgb(ACENTO_MEDIA_PREDETERMINADO)
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
  if (!best || best.count <= 0) return hexToRgb(ACENTO_MEDIA_PREDETERMINADO)

  return [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
  ]
}

function QsMedia() {
  const hypr = AstalHyprland.get_default()

  const [title, setTitle] = createState("Sin reproducción")
  const [artist, setArtist] = createState("")
  const [isPlaying, setIsPlaying] = createState(false)
  const [prog, setProg] = createState(0)
  const [positionLabel, setPositionLabel] = createState("")
  const [durationLabel, setDurationLabel] = createState("")
  const [hasProgress, setHasProgress] = createState(false)
  const [hasPlayer, setHasPlayer] = createState(false)
  const [cover, setCover] = createState("")
  const [playerIndex, setPlayerIndex] = createState(0)
  const [numPlayers, setNumPlayers] = createState(0)
  const [playerName, setPlayerName] = createState("")
  const [coverAccent, setCoverAccent] = createState(ACENTO_MEDIA_PREDETERMINADO)
  const [trackId, setTrackIdState] = createState<string | null>(null)
  const [isAdState, setIsAd] = createState(false)
  const [liked, setLiked] = createState(false)
  const [likeVisible, setLikeVisible] = createState(false)
  const [canLike, setCanLike] = createState(false)
  let lastQueriedId: string | null = null

  const playerGlyph = new Gtk.Label({
    cssClasses: ["qs-media-app-glyph"],
    visible: false,
    valign: Gtk.Align.CENTER,
  })

  const playerIcon = new Gtk.Image({
    iconName: "audio-x-generic-symbolic",
    pixelSize: 14,
    cssClasses: ["qs-media-app-icon"],
    valign: Gtk.Align.CENTER,
  })

  const playerAppIcon = new Gtk.Box({
    valign: Gtk.Align.CENTER,
    marginBottom: 6,
  })
  playerAppIcon.append(playerGlyph)
  playerAppIcon.append(playerIcon)

  const resolverIconoReproductor = (player: any): Gio.Icon | null => {
    const entry = String(player.entry || "").trim()
    const busId = String(player.bus_name || "")
      .replace(/^org\.mpris\.MediaPlayer2\./i, "")
      .replace(/\.instance[^.]*$/i, "")
    const identity = String(player.identity || "")
    // El índice compartido ya cachea Gio.AppInfo y se invalida cuando cambian las
    // aplicaciones instaladas; evitar otro recorrido y otra caché por monitor.
    return obtenerEntradaEscritorio({ class: entry, initialClass: busId })?.icono
      ?? obtenerEntradaEscritorio({ class: identity })?.icono
      ?? null
  }

  // El corazón solo necesita credenciales: "Me gusta" también funciona en cuentas
  // free. Se resuelve una vez (async) y se cachea aquí para leerlo síncronamente en
  // update(); si la API niega la biblioteca, `isLiked` responde `denied` y se oculta.
  let desmontado = false
  Spotify.isConfigured().then((configurado) => {
    if (desmontado) return
    setCanLike(configurado)
    update()
  })

  let currentP: any = null
  let mediaContentWidget: Gtk.Widget | null = null
  let switchingPlayer = false
  const fallbackLengths = new Map<string, number>()
  const pendingLengthQueries = new Set<string>()
  const lengthQueryAttempts = new Map<string, number>()
  const primedFirefoxTracks = new Set<string>()
  let sessionBus: Gio.DBusConnection | null = null

  // Firefox tiene una carrera conocida en su bridge MPRIS: si el servicio se
  // registra después de durationchange, Metadata nace sin mpris:length y no lo
  // vuelve a calcular hasta el siguiente comando que cambia el estado. Un ciclo
  // Pause/Play consecutivo conserva el estado PLAYING y fuerza ese cálculo. Solo
  // se usa una vez por pista, con el panel abierto y si ambos comandos existen.
  const primeFirefoxLength = (busName: string): boolean => {
    try {
      sessionBus ??= Gio.bus_get_sync(Gio.BusType.SESSION, null)
      const call = (method: "Pause" | "Play") => sessionBus!.call_sync(
        busName,
        "/org/mpris/MediaPlayer2",
        "org.mpris.MediaPlayer2.Player",
        method,
        null,
        null,
        Gio.DBusCallFlags.NONE,
        500,
        null,
      )
      call("Pause")
      call("Play")
      return true
    } catch (_) {
      return false
    }
  }

  const temporizadoresTransitorios = new Set<number>()
  let duracionActual: number | null = null

  // ── Arrastre de la cabeza de reproducción ───────────────────────────────────
  // `puedeBuscar` se refresca en cada sondeo desde `can_seek`; sin él el tirador
  // se ofrecería también en fuentes que no admiten Seek (radios, streams en vivo).
  // Se trata `undefined` como "sí": hay reproductores que no publican la propiedad
  // y sí obedecen SetPosition, y esconder el tirador ahí sería peor que intentarlo.
  let puedeBuscar = false
  let arrastrando = false
  // `progressArea` se construye más abajo (con el resto del lienzo de ondas) y
  // `update()` ya ha corrido para entonces: la petición de repintado va por esta
  // indirección para no leer la constante antes de su inicialización.
  let repintarProgreso: () => void = () => {}
  let fraccionArrastre = 0
  let hoverProgreso = false
  // Tras un Seek el reproductor tarda en publicar la nueva posición (hasta el
  // siguiente tick de 1 s). Sin esta gracia el sondeo devolvía la posición VIEJA y
  // la barra saltaba hacia atrás un instante antes de aterrizar donde se soltó.
  let posicionBuscada: number | null = null
  let buscadaHastaUs = 0
  const SEEK_GRACIA_US = 1_500_000
  const SEEK_TOLERANCIA_S = 1.5

  /** Actualiza solo los datos que avanzan con el tiempo; es la única ruta sondeada. */
  const actualizarPosicion = () => {
    const p = currentP
    if (!p || duracionActual === null) {
      if (puedeBuscar) { puedeBuscar = false; repintarProgreso() }
      arrastrando = false
      posicionBuscada = null
      setHasProgress(false)
      setProg(0)
      setPositionLabel("")
      setDurationLabel("")
      return
    }

    const buscableAhora = p.can_seek !== false
    if (buscableAhora !== puedeBuscar) { puedeBuscar = buscableAhora; repintarProgreso() }

    // Mientras el dedo está en la barra la fuente de verdad es el gesto, no el
    // reproductor: dejar entrar el sondeo aquí haría vibrar el tirador bajo el ratón.
    if (arrastrando) return

    const posicion = safeMediaPosition(p.position, duracionActual)
    if (posicionBuscada !== null) {
      const llego = Math.abs(posicion - posicionBuscada) <= SEEK_TOLERANCIA_S
      if (llego || GLib.get_monotonic_time() > buscadaHastaUs) posicionBuscada = null
      else return
    }
    setHasProgress(true)
    setProg(posicion / duracionActual)
    setPositionLabel(formatMediaTime(posicion))
    setDurationLabel(formatMediaTime(duracionActual))
  }

  /** Lleva la reproducción a `fraccion` (0..1) de la pista. */
  const buscarEnPista = (fraccion: number) => {
    const p = currentP
    if (!p || duracionActual === null || duracionActual <= 0) return
    const destino = Math.max(0, Math.min(duracionActual, fraccion * duracionActual))
    try { p.position = destino } catch (_) { return }
    posicionBuscada = destino
    buscadaHastaUs = GLib.get_monotonic_time() + SEEK_GRACIA_US
    setProg(destino / duracionActual)
    setPositionLabel(formatMediaTime(destino))
  }

  /** Recalcula la duración únicamente cuando cambia el estado MPRIS o el jugador. */
  const actualizarDuracion = () => {
    const p = currentP
    if (!p) {
      duracionActual = null
      actualizarPosicion()
      return
    }

    let duracionMprisCruda: unknown = null
    try { duracionMprisCruda = p.get_meta?.("mpris:length")?.deep_unpack?.() } catch (_) {}

    const claveProgreso = `${p.bus_name || ""}\0${p.trackid || ""}\0${p.title || ""}`
    const duracionDirecta = resolveMediaLengthSeconds(p.length, duracionMprisCruda)
    duracionActual = duracionDirecta ?? fallbackLengths.get(claveProgreso) ?? null

    if (duracionActual !== null) {
      actualizarPosicion()
      return
    }

    actualizarPosicion()

    const esFirefox = String(p.bus_name || "").toLowerCase().includes("firefox")
    const puedePrepararFirefox = esFirefox
      && quickSettingsVisible.get()
      && obtenerEstadoReproductor(p)?.reproduciendo === true
      && p.can_pause
      && p.can_play
      && !primedFirefoxTracks.has(claveProgreso)

    if (puedePrepararFirefox) {
      primedFirefoxTracks.add(claveProgreso)
      if (primeFirefoxLength(p.bus_name)) {
        const idTemporizador = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
          temporizadoresTransitorios.delete(idTemporizador)
          if (!desmontado && currentP === p) actualizarDuracion()
          return GLib.SOURCE_REMOVE
        })
        temporizadoresTransitorios.add(idTemporizador)
        return
      }
    }

    // Astal puede conservar Metadata vacío al registrar Firefox. Consultamos la
    // fuente MPRIS real con un límite corto y cacheamos la duración encontrada.
    const intentos = lengthQueryAttempts.get(claveProgreso) ?? 0
    if (intentos >= 3 || pendingLengthQueries.has(claveProgreso)) return

    const nombreReproductor = String(p.bus_name || "").replace(/^org\.mpris\.MediaPlayer2\./, "")
    if (!nombreReproductor) return
    lengthQueryAttempts.set(claveProgreso, intentos + 1)
    pendingLengthQueries.add(claveProgreso)
    execAsync(["playerctl", "-p", nombreReproductor, "metadata", "mpris:length"])
      .then((salida) => {
        if (desmontado) return
        const duracionAlternativa = resolveMediaLengthSeconds(0, salida.trim())
        if (duracionAlternativa !== null) {
          fallbackLengths.set(claveProgreso, duracionAlternativa)
          while (fallbackLengths.size > 32) {
            const masAntigua = fallbackLengths.keys().next().value
            if (masAntigua === undefined) break
            fallbackLengths.delete(masAntigua)
          }
        }
        pendingLengthQueries.delete(claveProgreso)
        if (duracionAlternativa !== null && currentP === p) actualizarDuracion()
      })
      .catch(() => pendingLengthQueries.delete(claveProgreso))
  }

  /** Metadatos y reproducción llegan por señales desde el servicio MPRIS único. */
  const update = () => {
    const players = reproductoresMultimedia.get()
    setNumPlayers(players.length)
    if (players.length === 0) {
      currentP = null
      duracionActual = null
      setHasPlayer(false)
      actualizarPosicion()
      return
    }

    let idx = playerIndex.get()
    if (idx >= players.length) {
      idx = 0
      setPlayerIndex(0)
    }

    const p = players[idx]
    if (!p) {
      currentP = null
      duracionActual = null
      setHasPlayer(false)
      actualizarPosicion()
      return
    }

    const estado = obtenerEstadoReproductor(p)
    if (!estado) return
    currentP = p
    setHasPlayer(true)
    const rawTrackId = estado.trackIdCrudo
    const ad = estado.esAnuncio
    const id = Spotify.parseTrackId(rawTrackId)
    const esSpotify = estado.esSpotify
    setIsAd(ad)
    setTitle(estado.titulo)
    setArtist(estado.artista)

    setLikeVisible(esSpotify && canLike.get() && !ad && id !== null)

    // Consultar "liked" solo al CAMBIAR de track (no en cada tick de 1 s).
    if (!ad && id && canLike.get()) {
      if (id !== lastQueriedId) {
        lastQueriedId = id
        setTrackIdState(id)
        Spotify.isLiked(id).then((estado) => {
          if (desmontado || lastQueriedId !== id) return
          if (estado === "denied") {
            setCanLike(false)
            setLikeVisible(false)
            return
          }
          if (estado !== "unavailable") setLiked(estado === "liked")
        })
      }
    } else {
      lastQueriedId = null
    }

    setIsPlaying(estado.reproduciendo)
    setCover(estado.caratula)
    setPlayerName(p.identity || p.bus_name.split(".").pop() || "Player")
    const entry = String(p.entry || "").replace(/\.desktop$/i, "")
    const busId = String(p.bus_name || "")
      .replace(/^org\.mpris\.MediaPlayer2\./i, "")
      .replace(/\.instance[^.]*$/i, "")
    const identity = String(p.identity || "")
    const glyph = getIcon(entry, busId, p.bus_name, identity, identity.replace(/\s+/g, "-"))

    if (glyph) {
      playerGlyph.set_label(glyph)
      playerGlyph.set_visible(true)
      playerIcon.set_visible(false)
    } else {
      const appIcon = resolverIconoReproductor(p)
      if (appIcon) playerIcon.set_from_gicon(appIcon)
      else playerIcon.set_from_icon_name("audio-x-generic-symbolic")
      playerGlyph.set_visible(false)
      playerIcon.set_visible(true)
    }
    actualizarDuracion()
  }

  const switchPlayer = (step: -1 | 1) => {
    const players = reproductoresMultimedia.get()
    if (players.length <= 1 || switchingPlayer) return

    const widget = mediaContentWidget
    if (!widget) {
      setPlayerIndex((playerIndex.get() + step + players.length) % players.length)
      update()
      return
    }

    switchingPlayer = true
    const direction = step > 0 ? "next" : "prev"
    const exitClass = `switch-out-${direction}`
    const enterClass = `switch-enter-${direction}`
    widget.add_css_class(exitClass)

    const idSalida = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 110, () => {
      temporizadoresTransitorios.delete(idSalida)
      if (desmontado) return GLib.SOURCE_REMOVE
      const currentPlayers = reproductoresMultimedia.get()
      if (currentPlayers.length > 1) {
        setPlayerIndex((playerIndex.get() + step + currentPlayers.length) % currentPlayers.length)
        update()
      }

      // Coloca el nuevo contenido, todavía invisible, al lado opuesto. Un frame
      // después retiramos la clase para que la transición base lo lleve al centro.
      widget.remove_css_class(exitClass)
      widget.add_css_class(enterClass)
      const idEntrada = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
        temporizadoresTransitorios.delete(idEntrada)
        if (desmontado) return GLib.SOURCE_REMOVE
        widget.remove_css_class(enterClass)
        const idFin = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 130, () => {
          temporizadoresTransitorios.delete(idFin)
          switchingPlayer = false
          return GLib.SOURCE_REMOVE
        })
        temporizadoresTransitorios.add(idFin)
        return GLib.SOURCE_REMOVE
      })
      temporizadoresTransitorios.add(idEntrada)
      return GLib.SOURCE_REMOVE
    })
    temporizadoresTransitorios.add(idSalida)
  }

  const nextPlayer = () => switchPlayer(1)
  const prevPlayer = () => switchPlayer(-1)

  const focusPlayerWindow = () => {
    const player = reproductoresMultimedia.get()[playerIndex.get()]
    const client = findMediaClient(player, hypr.get_clients?.() ?? [])
    if (!client?.address) return

    const address = String(client.address)
    const normalized = address.startsWith("0x") ? address : `0x${address}`
    closeAllPanels()
    execAsync(["hyprctl", "dispatch", `hl.dsp.focus({window='address:${normalized}'})`]).catch(() => {})
  }

  // El sondeo de posición solo corre con el panel abierto: al cerrar se REMUEVE el
  // timer, no basta con saltarse el cuerpo. Antes se armaba una vez y vivía toda la
  // sesión comprobando la visibilidad — 86.400 despertares del bucle principal al día
  // (y por monitor) para no hacer nada. Mismo patrón que clockTimer/netSpeedTimer.
  update()
  let mediaTimer: number | null = null
  const cancelarRevision = revisionMultimedia.subscribe(update)
  const cancelarVisibilidad = quickSettingsVisible.subscribe(() => {
    if (quickSettingsVisible.get()) {
      update()
      if (mediaTimer === null) {
        mediaTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
          actualizarPosicion()
          return GLib.SOURCE_CONTINUE
        })
      }
    } else if (mediaTimer !== null) {
      GLib.source_remove(mediaTimer)
      mediaTimer = null
    }
  })

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
  // 94 hasta que las ondas pidieron aire: el bloque de metadatos subió 5 px y el pie
  // (barra, ondas, botones y tiempos) bajó 3, y la tarjeta NO tenía holgura — medido
  // con `grim`, el contenido ocupaba los 94 justos, así que crece con ellos. Tiene
  // que ir a la par que el `min-height` de `.qs-media` en style.scss: aquí es el
  // alto que se pide al contenido y a los DrawingArea del fondo (filtro y scrim).
  const CARD_H = 108
  // 70% del ancho útil: (panel 330 - padding panel 20 - padding media 28) × 0.7.
  const MEDIA_SOURCE_MAX_W = 197
  const MEDIA_SOURCE_MAX_CHARS = 32
  // El contenido útil de la tarjeta son 282 px. Sin este tope, el tamaño natural
  // de una etiqueta larga se propaga al Overlay antes de que `ellipsize` actúe.
  const MEDIA_METADATA_MAX_CHARS = 42
  const MEDIA_TIME_MAX_CHARS = 10
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
  const cancelarCaratula = cover.subscribe(applyCover)
  const cancelarAnuncioCaratula = isAdState.subscribe(applyCover)
  applyCover()

  // bgCap es una Picture/ScrolledWindow (textura) y colorFilter/coverScrim son
  // Gtk.DrawingArea (superficie cairo): a escala fraccional (p. ej. 1.25) cada
  // una redondea su alto físico por su cuenta, y aunque pidan el mismo CARD_H
  // pueden acabar 1px más cortas que el fondo que deben cubrir. cr.paint() ya
  // cubre TODO el clip del DrawingArea, pero no puede pintar fuera de él — así
  // que se les añade un margen inferior negativo (`.qs-media-bleed` en
  // estilos/style.scss, fuera del clamp ≥0 de la propiedad margin-bottom de
  // GtkWidget) para que sobresalgan por abajo; el `overflow: HIDDEN` de
  // `.qs-media` recorta ese sobrante.
  const colorFilter = new Gtk.DrawingArea()
  colorFilter.set_can_target(false)
  colorFilter.set_halign(Gtk.Align.FILL)
  colorFilter.set_valign(Gtk.Align.FILL)
  colorFilter.set_hexpand(true)
  colorFilter.set_vexpand(true)
  colorFilter.set_content_width(1)
  colorFilter.set_content_height(CARD_H)
  colorFilter.add_css_class("qs-media-bleed")
  colorFilter.set_draw_func((_area, cr, _width, _height) => {
    if (!cover.get()) return
    const [r, g, b] = oneUiBgTone(cssRgbToTuple(coverAccent.get()))
    // Alpha medio: unifica el color pero DEJA VER la carátula por debajo, como
    // hace One UI (no un bloque opaco).
    cr.setSourceRGBA(r / 255, g / 255, b / 255, 0.45)
    // paint() cubre todo el clip real del DrawingArea. Un rectángulo de `height`
    // unidades podía terminar entre píxeles con escalas fraccionales (p. ej. 1.25)
    // y dejar la última fila parcialmente sin filtrar.
    cr.paint()
  })
  const queueColorFilter = () => colorFilter.queue_draw()
  const cancelarFiltroCaratula = cover.subscribe(queueColorFilter)
  const cancelarFiltroAnuncio = isAdState.subscribe(queueColorFilter)
  const cancelarFiltroAcento = coverAccent.subscribe(queueColorFilter)

  const coverScrim = new Gtk.DrawingArea()
  coverScrim.set_can_target(false)
  coverScrim.set_halign(Gtk.Align.FILL)
  coverScrim.set_valign(Gtk.Align.FILL)
  coverScrim.set_hexpand(true)
  coverScrim.set_vexpand(true)
  coverScrim.set_content_width(1)
  coverScrim.set_content_height(CARD_H)
  coverScrim.add_css_class("qs-media-bleed")
  coverScrim.set_draw_func((_area, cr, _width, height) => {
    if (!cover.get()) return
    // Degradado vertical real: arriba casi transparente (se ve la carátula), abajo
    // oscuro para dar contraste al texto/controles. Igual que One UI.
    try {
      const grad = new (cairo as any).LinearGradient(0, 0, 0, height)
      grad.addColorStopRGBA(0, 0, 0, 0, 0.10)
      grad.addColorStopRGBA(0.55, 0, 0, 0, 0.30)
      grad.addColorStopRGBA(1, 0, 0, 0, 0.58)
      cr.setSource(grad)
      cr.paint()
    } catch (_) {
      // Fallback si el binding de GJS no expone LinearGradient: scrim plano.
      cr.setSourceRGBA(0, 0, 0, 0.34)
      cr.paint()
    }
  })
  const queueCoverScrim = () => coverScrim.queue_draw()
  const cancelarScrimCaratula = cover.subscribe(queueCoverScrim)
  const cancelarScrimAnuncio = isAdState.subscribe(queueCoverScrim)

  // La barra de progreso ocupa los 4 px de abajo; el resto del área lo llenan dos
  // ondas viajeras que salen de ella hacia arriba, dentro del tramo ya reproducido.
  // El alto pedido (20) NO lo paga el layout: `.qs-media-progress-ondas` lo devuelve
  // con un margen superior negativo (ver style.scss).
  const PROGRESO_ALTO = 20
  const PROGRESO_BARRA = 4
  // El tirador de arrastre es un círculo CENTRADO en la barra: su mitad inferior
  // cae por debajo de los 4 px de la barra, que antes era el borde del lienzo — ahí
  // GTK lo recortaba y se veía medio círculo plano. Se pide esa holgura extra de
  // alto y `.qs-media-progress-ondas` la devuelve con un margen inferior negativo
  // (igual que ya hacía arriba con las ondas), así el layout de la tarjeta no cambia.
  const TIRADOR_R = 5.5
  const TIRADOR_R_ACTIVO = 6.5
  const PROGRESO_HOLGURA = Math.ceil(TIRADOR_R_ACTIVO - PROGRESO_BARRA / 2)
  // Las ondas NACEN EN LA BARRA, no unos píxeles por encima: el medio píxel de
  // solape con su borde superior evita que el antialiasing deje una línea de aire
  // entre el relleno y la barra.
  const ONDA_SOLAPE = 0.5
  // `velocidad` es px/s **hacia la derecha**: las dos ondas viajan en el MISMO
  // sentido, naciendo al principio de la barra y avanzando hasta la cabeza de
  // reproducción (el envolvente de entrada y el de salida son lo que hace visible
  // ese nacer y morir). Van en el orden en que se pintan: primero la de detrás
  // —más rápida y de onda más corta— y encima la de delante, más lenta y algo más
  // alta. La diferencia de velocidad es lo que hace que la trasera **alcance** a
  // la delantera: unas veces asoma por encima de su cresta y otras queda dentro de
  // su relleno, que es justo el efecto pedido. Con la misma velocidad no se
  // adelantarían nunca y se leerían como una sola onda gruesa.
  // La amplitud está topada por la línea del ARTISTA, que queda justo encima: la
  // cresta llega a `amplitud` px sobre la barra y a partir de ~13,5 cruza el texto —
  // medido con `grim` sobre la tarjeta.
  //
  // **Cada onda es un tren de PULSOS SUELTOS, no una senoidal continua.** Esto es una
  // corrección, y la razón por la que no basta con alargar la onda: una senoidal
  // llena la barra de crestas pegadas *por definición* — al estirarla salen menos
  // lomos, pero siguen siendo uno tras otro sin un hueco donde descansar la vista, y
  // eso es lo que satura. Aquí cada pulso es una campana de Gauss de anchura `ancho`,
  // y entre el final de uno y el principio del siguiente se deja `hueco` px de barra
  // **plana, onda a 0**: se ven dos o tres ondas con aire entre ellas, no un tren.
  //
  // Los dos parámetros son independientes y conviene no confundirlos, que ha costado
  // un par de vueltas: `ancho` es lo que ocupa cada onda (su ancho visible son
  // `ONDA_ANCHO_VISIBLE` sigmas) y `hueco` es el margen vacío entre una y la
  // siguiente. Cada cuánto se crea una — el `espaciado` de antes — ya no se escribe a
  // mano: **sale de sumar los dos**, así que tocar `ancho` no descuadra el margen.
  //
  // La vida ya no sale de batir dos senos (ver `alturaPulso`): **cada pulso nace con
  // su propia altura** y la conserva mientras viaja, así que unos pasan altos y otros
  // bajos. Es lo mismo que se buscaba con el batido, pero por pulso y sin que la
  // altura cambie bajo los pies del que ya está en pantalla.
  const ONDAS = [
    {
      // Va DETRÁS pero con el trazo MÁS marcado que la grande, no al revés: si la de
      // delante es la opaca, la trasera se pierde bajo su relleno justo cuando la
      // adelanta, que es el momento que da sentido a que sean dos. Los dos alfas son
      // ALTOS (0,95 y 0,80): con 0,62 y 0,45 el trazo se diluía sobre la carátula y
      // apenas se veía la onda — el orden entre ellos es lo que importa, no que sean
      // discretos.
      // Su altura es CASI la de la grande (11,5 frente a 13), no la mitad: con una
      // claramente menor deja de leerse como otra onda y parece el eco de la otra.
      // Lo que las distingue es el ritmo, la velocidad y el TONO — esta usa el
      // compañero (`oneUiOndaTone`) y la de delante el mismo acento que la barra.
      amplitud: 11.5, alfa: 0.95, grosor: 1.1, tono: "companero" as const,
      ancho: 9, hueco: 30, velocidad: 20, semilla: 7,
    },
    {
      // Los dos ritmos resultantes son PARECIDOS (78 y 66 px entre pulsos) y las dos
      // `velocidad` casi iguales (20 y 16), y las dos cosas son deliberadas: así los
      // pulsos de una y otra nacen más o menos a la par al principio de la barra y
      // solo se van separando conforme avanzan. Con ritmos muy distintos (84/110 y
      // 30/15, que es como estuvo) cada onda iba a su aire y se leían como dos cosas
      // sin relación. La diferencia que queda es la que interesa: la pequeña emite
      // antes, así que **cambia de altura más a menudo** que la grande, y la ligera
      // diferencia de velocidad hace que se alcancen y se crucen despacio.
      amplitud: 13.0, alfa: 0.80, grosor: 1.4, tono: "acento" as const,
      ancho: 11, hueco: 34, velocidad: 16, semilla: 31,
    },
  ]
  // Ancho visible de un pulso en sigmas: más allá de dos sigmas a cada lado la
  // campana ya no se distingue de la barra, así que es lo que cuenta como "ocupado"
  // al repartir el hueco.
  const ONDA_ANCHO_VISIBLE = 4
  // **Cada pulso varía en ALTURA Y EN ANCHO, no solo en altura.** Con el ancho fijo,
  // dos pulsos de altura parecida salían calcados y el tramo se leía repetitivo — y
  // eso se nota sobre todo cuando la barra dibujada es corta (al principio de la
  // pista, o en una canción larga), porque ahí caben pocos y cada uno tiene que
  // aguantar la mirada él solo. La variación ENTRE pulsos es POCA pero perceptible:
  // la base va del 82 % al 100 % de `amplitud` y `ancho` del 92 % al 122 % del suyo.
  // Lo que sí recorre todo el rango es el latido de cada uno en el tiempo, ver
  // `alturaPulso`.
  //
  // Los dos SUELOS son altos, y ese es el ajuste que costó encontrar: con rangos
  // amplios (0,42 de altura, 0,65 de ancho) el extremo bajo no aportaba variedad,
  // solo estorbaba — salían agujas y pulsos aplastados que no se leen como una onda,
  // y el conjunto parecía irregular en vez de vivo. Si hay que retocar esto, muévete
  // en el suelo; el techo apenas cambia nada.
  //
  // El ancho máximo lo topa el `hueco`, que con 1,22× sigue dejando barra plana entre
  // pulsos.
  const ONDA_PULSO_BASE_MIN = 0.82
  const ONDA_PULSO_ANCHO_MIN = 0.92
  const ONDA_PULSO_ANCHO_MAX = 1.22
  // Duración del ciclo de cada pulso, en segundos: un bajón más el descanso que le
  // sigue. Sorteado por pulso, ver `alturaPulso`. **El rango es ANCHO a propósito.**
  // Con 2,8-4,6 las fases ya salían descorrelacionadas (medido: correlación entre
  // pulsos vecinos −0,10), pero todos se movían casi a la misma velocidad —entre el
  // más rápido y el más lento había un factor 1,5— y eso el ojo lo lee como que suben
  // y bajan a la vez. Aquí el factor real es 2,3.
  //
  // Y son ciclos LARGOS —de 6 a 14 s— porque esto es una onda, no un indicador: todo
  // movimiento tiene que resultar lento y progresivo. Con 2,4-6,0 s el bajón más
  // breve duraba 0,67 s de ida y vuelta, o sea que la altura cambiaba a **4,5 alturas
  // por segundo** en su punto más rápido y se veía como un tirón. Con estos valores
  // el bajón más breve dura 2,7 s y el pico baja a 0,99 alturas/s.
  const ONDA_CICLO_MIN = 6.0
  const ONDA_CICLO_MAX = 14.0
  // Parte del ciclo ocupada por el bajón. El resto (25-55 %) es descanso arriba, y
  // ese descanso es el "margen" entre un movimiento y el siguiente: al sortearse por
  // pulso, los bajones no se encadenan a intervalos regulares.
  const ONDA_BAJON_MIN = 0.45
  const ONDA_BAJON_MAX = 0.75
  // Profundidad del bajón: hasta dónde cae respecto de su altura de reposo. Se quedó
  // en 0,85 y no más: la profundidad es la otra mitad de lo brusco que se ve el
  // movimiento —cuanto más hondo, más recorrido en el mismo tiempo—, y bajar hasta un
  // hilo de onda solo salía suave con ciclos aún más largos.
  const ONDA_BAJON_FONDO_MIN = 0.55
  const ONDA_BAJON_FONDO_MAX = 0.85
  // Ruido determinista por índice de pulso (el mismo truco que `OndaSpotify`): sin
  // estado y sin acumular nada entre frames. Lo que fija es la IDENTIDAD del pulso k
  // —su ancho, su ritmo y su fase—, que no cambia mientras cruza la barra.
  // Las constantes son las del hash clásico de GLSL y **no son intercambiables**: con
  // las que había (127.1 / 311.7) el reparto para índices consecutivos sale sesgado
  // —11 de 24 valores caían en el cuartil alto y solo 1 en el segundo—, así que los
  // periodos se agolpaban todos en la parte lenta del rango. Con estas el reparto es
  // 4/5/9/6 por cuartil. Si se tocan, hay que volver a medirlo.
  const ruidoPulso = (indice: number): number => {
    const seno = Math.sin(indice * 12.9898 + 78.233) * 43758.5453
    return seno - Math.floor(seno)
  }
  // **El pulso NO respira sin parar: descansa arriba y de vez en cuando pega un
  // bajón.** Antes era un seno continuo entre casi 0 y el 100 %, y tenía dos defectos
  // medidos sobre 1.200 muestras: pasaba **más tiempo abajo que arriba** (38 % por
  // encima del 70 % de su altura frente a un 35 % por debajo del 30 %), y como un
  // seno no tiene descansos, los movimientos iban encadenados uno tras otro sin
  // respiro. El modelo de bajones da 75 % arriba / 11 % abajo.
  //
  // Tres factores, cada uno sorteado del índice del pulso y fijo de por vida:
  //
  // 1. **Base** — su altura en reposo, donde pasa la mayor parte del tiempo. Varía
  //    POCO entre pulsos (82 %–100 %): se parecen entre sí, que es lo que se buscaba.
  // 2. **Ciclo y fase** — cada cuánto le toca bajar y en qué momento arranca.
  // 3. **Bajón** — qué parte del ciclo dura el movimiento (`ONDA_BAJON_*`) y hasta
  //    dónde cae (`ONDA_BAJON_FONDO_*`). Lo que queda del ciclo es descanso arriba, y
  //    **ese descanso es el margen aleatorio entre un movimiento y el siguiente**.
  //
  // El movimiento en sí es un coseno completo (baja y vuelve, sin esquinas); lo
  // aleatorio son solo los cuatro sorteos, nunca el valor de un frame.
  const alturaPulso = (indice: number, tiempo: number): number => {
    const base = ONDA_PULSO_BASE_MIN + (1 - ONDA_PULSO_BASE_MIN) * ruidoPulso(indice + 4091)
    const ciclo = ONDA_CICLO_MIN + (ONDA_CICLO_MAX - ONDA_CICLO_MIN) * ruidoPulso(indice)
    const duracion = ONDA_BAJON_MIN + (ONDA_BAJON_MAX - ONDA_BAJON_MIN) * ruidoPulso(indice + 3571)
    const fondo = ONDA_BAJON_FONDO_MIN
      + (ONDA_BAJON_FONDO_MAX - ONDA_BAJON_FONDO_MIN) * ruidoPulso(indice + 6151)
    const avance = (tiempo / ciclo + ruidoPulso(indice + 2027)) % 1
    if (avance >= duracion) return base
    return base * (1 - fondo * (0.5 - 0.5 * Math.cos((2 * Math.PI * avance) / duracion)))
  }
  // El desplazamiento del índice descorrelaciona las dos tiradas: sin él, el pulso
  // más alto sería siempre además el más ancho y la variación se notaría la mitad.
  const anchoPulso = (indice: number): number =>
    ONDA_PULSO_ANCHO_MIN + (ONDA_PULSO_ANCHO_MAX - ONDA_PULSO_ANCHO_MIN) * ruidoPulso(indice + 1013)
  // El relleno bajo la curva lleva **el mismo alfa y la misma rampa** en las dos
  // ondas (referida a la cresta de la MÁS ALTA, no a la de cada una); lo único que
  // cambia entre ellas es el COLOR, ver `tono`. Con un alfa por onda, la pequeña se
  // leía como "sin fondo" al lado de la grande; y con la rampa referida a la amplitud
  // propia, dos puntos a la misma altura salían de distinta intensidad, que es la
  // otra mitad de lo mismo. Al ser semitransparente, el relleno de la onda de detrás
  // se ve a través del de delante y los dos se mezclan donde se cruzan — con dos
  // tonos distintos ese cruce ya no es solo más opaco, es otro color.
  const ONDA_RELLENO = 0.75
  const ONDA_RELLENO_ALTO = Math.max(...ONDAS.map((onda) => onda.amplitud))
  // Medio trazo del más grueso: es lo que sobresale de la ruta al dibujarla, y lo
  // que hay que descontar del lienzo para que la cresta no toque el borde.
  const ONDA_MARGEN_TRAZO = Math.max(...ONDAS.map((onda) => onda.grosor)) / 2
  // Tramo en el que la onda entra y se apaga. Va MUY sobrado en la salida (38 px, no
  // los 12 de antes) porque la onda tiene que **desaparecer** acercándose a la cabeza
  // de reproducción, no acabarse: con un tramo corto la amplitud se desploma en un
  // palmo y el ojo lo lee igual que un corte. Actúan sobre la amplitud y también
  // sobre el alfa del trazo (ver el degradado longitudinal más abajo).
  const ONDA_ENTRADA = 30
  const ONDA_SALIDA = 38
  const ONDA_PASO = 2
  const ONDA_FPS = 30
  const ONDA_FPS_AHORRO = 20

  let tiempoOndas = 0
  // 0 = ondas planas, 1 = amplitud completa. Se cruza en vez de conmutarse para que
  // pausar no dé un salto.
  let energiaOndas = 0
  let ultimoFrameOndas = 0
  let acumuladoOndas = 0
  let idTickOndas: number | null = null

  const suave = (t: number) => {
    const v = Math.min(1, Math.max(0, t))
    return v * v * (3 - 2 * v)
  }

  const progressArea = new Gtk.DrawingArea()
  progressArea.set_hexpand(true)
  progressArea.set_content_width(1)
  progressArea.set_content_height(PROGRESO_ALTO + PROGRESO_HOLGURA)
  progressArea.add_css_class("qs-media-progress-ondas")
  progressArea.set_draw_func((_area, cr, width, height) => {
    const barHeight = PROGRESO_BARRA
    const radius = Math.min(barHeight / 2, 3)
    const drawRoundRect = (x: number, y: number, w: number, h: number) => {
      const r = Math.min(radius, w / 2, h / 2)
      cr.newPath()
      cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
      cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
      cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
      cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI)
      cr.closePath()
    }

    // La barra se ancla ABAJO —lo que hay por encima es el lienzo de las ondas, y
    // centrarla las dejaría sin sitio— pero por debajo se reserva `PROGRESO_HOLGURA`
    // para la mitad inferior del tirador.
    const y = Math.max(0, height - barHeight - PROGRESO_HOLGURA)
    drawRoundRect(0, y, width, barHeight)
    cr.setSourceRGBA(0, 0, 0, 0.42)
    cr.fill()

    // Los dos tonos salen de la MISMA semilla (el acento de la carátula) por reglas
    // distintas; ver `oneUiOndaTone`. La barra usa siempre el de acento.
    const semilla = cssRgbToTuple(coverAccent.get())
    const tonos = { acento: oneUiFgTone(semilla), companero: oneUiOndaTone(semilla) }
    const [r, g, b] = tonos.acento

    // El tirador se pinta SIEMPRE al final, encima de las ondas, y por eso vive en
    // una función: el cuerpo de abajo tiene varias salidas tempranas (sin relleno,
    // sin energía de ondas) y en todas debe seguir viéndose la cabeza.
    const pintarTirador = () => {
      if (!puedeBuscar) return
      const radio = arrastrando || hoverProgreso ? TIRADOR_R_ACTIVO : TIRADOR_R
      // Centro acotado a los bordes: en 0 % y en 100 % el círculo quedaría medio
      // fuera del lienzo y GTK lo recortaría en plano.
      const cx = Math.max(radio, Math.min(width - radio, fillW))
      const cy = y + barHeight / 2
      cr.newPath()
      cr.arc(cx, cy, radio, 0, 2 * Math.PI)
      cr.setSourceRGBA(0, 0, 0, 0.35)
      cr.fill()
      cr.newPath()
      cr.arc(cx, cy, radio - 1.5, 0, 2 * Math.PI)
      cr.setSourceRGBA(r / 255, g / 255, b / 255, 1)
      cr.fill()
    }

    const fraccion = arrastrando ? fraccionArrastre : prog.get()
    const fillW = Math.max(0, Math.min(width, width * fraccion))
    if (fillW <= 0) { pintarTirador(); return }
    drawRoundRect(0, y, fillW, barHeight)
    cr.setSourceRGBA(r / 255, g / 255, b / 255, 1)
    cr.fill()

    if (energiaOndas < 0.004) { pintarTirador(); return }
    const base = y + ONDA_SOLAPE
    cr.setLineCap(cairo.LineCap.ROUND)
    cr.setLineJoin(cairo.LineJoin.ROUND)
    // Techo real del lienzo: por encima de `y = 0` está el borde del DrawingArea y
    // ahí GTK recorta el dibujo. Subir `amplitud` más allá de esto NO hace la onda
    // más alta — la deja **cortada en plano**, que es el síntoma con el que se
    // descubrió. Se reduce la amplitud para que quepa en vez de dejar que la corte el
    // borde; con los valores actuales (cresta 13 px de 16 disponibles) no actúa.
    const amplitudMaxima = Math.max(0, base - ONDA_MARGEN_TRAZO)
    for (const onda of ONDAS) {
      const [or_, og, ob] = tonos[onda.tono]
      const amplitud = Math.min(onda.amplitud, amplitudMaxima) * energiaOndas
      // `sobre - desfase` y no `+`: restar desplaza el pulso hacia la derecha según
      // avanza el tiempo, que es el sentido de marcha pedido.
      const desfase = tiempoOndas * onda.velocidad
      const espaciado = ONDA_ANCHO_VISIBLE * onda.ancho + onda.hueco
      // Los puntos se calculan UNA vez y se recorren dos: `fill` consume la ruta, así
      // que el trazo tendría que rehacerla — y con dos bucles independientes el
      // relleno y su contorno podrían separarse un píxel.
      const puntos: Array<[number, number]> = []
      for (let x = 0; x <= fillW; x += ONDA_PASO) {
        const sobre = Math.min(x, fillW)
        const envolvente = suave(sobre / ONDA_ENTRADA) * suave((fillW - sobre) / ONDA_SALIDA)
        // Posición en ciclos: la parte entera identifica al pulso, que es lo que fija
        // su ancho y el ritmo de su latido. Se miran también los vecinos porque en la frontera
        // entre dos ciclos el de al lado todavía aporta cola; sin ellos ahí saldría un
        // escalón. El sigma se toma del pulso VECINO, no del actual: es su campana la
        // que se está evaluando.
        const ciclo = (sobre - desfase) / espaciado
        const actual = Math.floor(ciclo)
        let forma = 0
        for (let indice = actual - 1; indice <= actual + 1; indice++) {
          const distancia = (ciclo - (indice + 0.5)) * espaciado
          const sigma = onda.ancho * anchoPulso(indice + onda.semilla)
          forma += alturaPulso(indice + onda.semilla, tiempoOndas)
            * Math.exp(-(distancia * distancia) / (2 * sigma * sigma))
        }
        puntos.push([sobre, base - amplitud * envolvente * Math.min(1, forma)])
      }
      if (puntos.length < 2) continue

      const trazar = () => {
        cr.newPath()
        puntos.forEach(([px, py], indice) => {
          if (indice === 0) cr.moveTo(px, py)
          else cr.lineTo(px, py)
        })
      }

      // **Relleno y trazo se pintan en un GRUPO y se enmascaran juntos.** Aplanar la
      // onda contra la barra al llegar a la cabeza NO la hace desaparecer: el
      // degradado del relleno es vertical y su borde inferior está siempre al alfa
      // máximo, así que por muy fina que quede la lámina se sigue viendo una banda
      // maciza hasta el final — ese era el "no llegan a cero". Un degradado
      // longitudinal en cada uno tampoco vale: cairo pinta con UNA fuente por
      // operación y el relleno ya gasta la suya en el degradado vertical. La máscara
      // se aplica al resultado ya compuesto, que es lo único que apaga las dos cosas
      // a la vez y de forma idéntica.
      cr.pushGroup()

      // Relleno: la misma curva cerrada contra la barra. El degradado se desvanece
      // hacia arriba para que el área no tape la carátula.
      trazar()
      cr.lineTo(puntos[puntos.length - 1][0], base)
      cr.lineTo(puntos[0][0], base)
      cr.closePath()
      const alfaRelleno = ONDA_RELLENO * energiaOndas
      try {
        // Mismo fallback que `coverScrim`: si el binding de GJS no expone
        // LinearGradient, se rellena plano en vez de quedarse sin área.
        const grad = new (cairo as any).LinearGradient(0, base - ONDA_RELLENO_ALTO, 0, base)
        grad.addColorStopRGBA(0, or_ / 255, og / 255, ob / 255, 0)
        grad.addColorStopRGBA(1, or_ / 255, og / 255, ob / 255, alfaRelleno)
        cr.setSource(grad)
      } catch (_) {
        cr.setSourceRGBA(or_ / 255, og / 255, ob / 255, alfaRelleno * 0.6)
      }
      cr.fill()

      trazar()
      cr.setLineWidth(onda.grosor)
      cr.setSourceRGBA(or_ / 255, og / 255, ob / 255, onda.alfa * energiaOndas)
      cr.stroke()

      cr.popGroupToSource()
      try {
        // Solo cuenta el alfa de la máscara; el color de sus paradas es irrelevante.
        const mascara = new (cairo as any).LinearGradient(0, 0, fillW, 0)
        const entrada = Math.min(0.45, ONDA_ENTRADA / fillW)
        const salida = Math.min(0.45, ONDA_SALIDA / fillW)
        mascara.addColorStopRGBA(0, 0, 0, 0, 0)
        mascara.addColorStopRGBA(entrada, 0, 0, 0, 1)
        mascara.addColorStopRGBA(1 - salida, 0, 0, 0, 1)
        mascara.addColorStopRGBA(1, 0, 0, 0, 0)
        cr.mask(mascara)
      } catch (_) {
        // Sin máscara la onda se ve entera (como antes), no se pierde.
        cr.paint()
      }
    }

    pintarTirador()
  })
  const queueProgress = () => progressArea.queue_draw()
  repintarProgreso = queueProgress

  // ── Arrastre / clic para buscar en la pista ─────────────────────────────────
  // El gesto de arrastre cubre también el clic simple: GTK emite `drag-begin` y
  // `drag-end` con desplazamiento 0, así que pulsar en un punto salta a él sin
  // necesidad de un `GestureClick` aparte.
  const fraccionEnX = (x: number): number => {
    const ancho = progressArea.get_width()
    if (ancho <= 0) return 0
    return Math.max(0, Math.min(1, x / ancho))
  }

  const previsualizarArrastre = (fraccion: number) => {
    fraccionArrastre = fraccion
    if (duracionActual !== null) setPositionLabel(formatMediaTime(fraccion * duracionActual))
    progressArea.queue_draw()
  }

  let inicioArrastreX = 0
  const gestoBusqueda = new Gtk.GestureDrag()
  gestoBusqueda.set_button(Gdk.BUTTON_PRIMARY)
  gestoBusqueda.connect("drag-begin", (_g: any, x: number) => {
    if (!puedeBuscar || duracionActual === null) return
    inicioArrastreX = x
    arrastrando = true
    previsualizarArrastre(fraccionEnX(x))
  })
  gestoBusqueda.connect("drag-update", (_g: any, dx: number) => {
    if (!arrastrando) return
    previsualizarArrastre(fraccionEnX(inicioArrastreX + dx))
  })
  gestoBusqueda.connect("drag-end", (_g: any, dx: number) => {
    if (!arrastrando) return
    const fraccion = fraccionEnX(inicioArrastreX + dx)
    // Se suelta el arrastre ANTES de buscar: `buscarEnPista` publica la posición
    // nueva en `prog`, y con la bandera aún puesta el dibujo seguiría leyendo
    // `fraccionArrastre` y el sondeo siguiente no podría corregir nada.
    arrastrando = false
    buscarEnPista(fraccion)
    progressArea.queue_draw()
  })
  progressArea.add_controller(gestoBusqueda)

  const punteroProgreso = new Gtk.EventControllerMotion()
  punteroProgreso.connect("enter", () => { hoverProgreso = true; progressArea.queue_draw() })
  punteroProgreso.connect("leave", () => { hoverProgreso = false; progressArea.queue_draw() })
  progressArea.add_controller(punteroProgreso)

  const frameOndas = (_widget: any, reloj: any): boolean => {
    const ahoraUs = reloj.get_frame_time()
    const transcurrido = ultimoFrameOndas ? (ahoraUs - ultimoFrameOndas) / 1e6 : 1 / 60
    ultimoFrameOndas = ahoraUs
    acumuladoOndas += Math.min(0.1, transcurrido)
    if (acumuladoOndas < 1 / (powerSaveActive.get() ? ONDA_FPS_AHORRO : ONDA_FPS)) return true
    const delta = acumuladoOndas
    acumuladoOndas = 0
    tiempoOndas += delta

    const objetivo = isPlaying.get() ? 1 : 0
    energiaOndas += (objetivo - energiaOndas) * (1 - Math.exp(-delta / 0.24))
    progressArea.queue_draw()

    if (objetivo === 0 && energiaOndas < 0.004) {
      energiaOndas = 0
      progressArea.queue_draw()
      idTickOndas = null
      return false
    }
    return true
  }

  // El reloj de frames solo vive con el panel abierto y con la barra a la vista: es
  // el mismo criterio que ya usan el temporizador de posición y `OndaSpotify`.
  const sincronizarOndas = () => {
    const necesario = quickSettingsVisible.get() && hasProgress.get()
      && (isPlaying.get() || energiaOndas > 0)
    if (necesario && idTickOndas === null) {
      ultimoFrameOndas = 0
      acumuladoOndas = 0
      idTickOndas = progressArea.add_tick_callback(frameOndas)
    } else if (!necesario && idTickOndas !== null) {
      progressArea.remove_tick_callback(idTickOndas)
      idTickOndas = null
      // Sin frames que la crucen, la energía tiene que caer de golpe: si no, al
      // reabrir el panel las ondas reaparecerían con la amplitud congelada.
      if (!isPlaying.get()) energiaOndas = 0
    }
  }

  const cancelarProgreso = prog.subscribe(queueProgress)
  const cancelarProgresoAcento = coverAccent.subscribe(queueProgress)
  const cancelarOndasReproduccion = isPlaying.subscribe(sincronizarOndas)
  const cancelarOndasProgreso = hasProgress.subscribe(sincronizarOndas)
  const cancelarOndasPanel = quickSettingsVisible.subscribe(sincronizarOndas)
  sincronizarOndas()

  const mediaContent = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      hexpand
      heightRequest={CARD_H}
      cssClasses={["qs-media-content"]}
      $={(self) => { mediaContentWidget = self }}
    >
      <box spacing={4} cssClasses={["qs-media-switcher-row"]}>
        {playerAppIcon}
        <label
          cssClasses={["qs-media-source"]}
          label={playerName}
          widthRequest={MEDIA_SOURCE_MAX_W}
          xalign={0}
          ellipsize={3}
          maxWidthChars={MEDIA_SOURCE_MAX_CHARS}
        />
        <box hexpand />
        <box spacing={0} valign={Gtk.Align.CENTER} visible={numPlayers((n) => n > 1)}>
          <button cssClasses={["qs-media-switch"]} onClicked={prevPlayer}>
            <label label="󰅁" />
          </button>
          <label
            cssClasses={["qs-media-count"]}
            label={playerIndex((i) => `${i + 1}/${numPlayers()}`)}
            halign={Gtk.Align.CENTER}
          />
          <button cssClasses={["qs-media-switch"]} onClicked={nextPlayer}>
            <label label="󰅂" />
          </button>
        </box>
      </box>

      <box spacing={10} vexpand valign={Gtk.Align.CENTER} cssClasses={["qs-media-meta"]}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand valign={Gtk.Align.CENTER}>
          <label
            cssClasses={["qs-media-title"]}
            label={title}
            hexpand
            halign={Gtk.Align.FILL}
            xalign={0}
            ellipsize={3}
            maxWidthChars={MEDIA_METADATA_MAX_CHARS}
          />
          <label
            cssClasses={["qs-media-artist"]}
            label={artist}
            hexpand
            halign={Gtk.Align.FILL}
            xalign={0}
            ellipsize={3}
            maxWidthChars={MEDIA_METADATA_MAX_CHARS}
          />
        </box>
      </box>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["qs-media-footer"]}>
        <box visible={hasProgress}>
          {progressArea}
        </box>
        {/* `centerbox` para que el corazón no entre en el centrado: el slot central
            lleva solo prev/play/next y queda centrado en toda la fila pase lo que pase
            a los lados. */}
        <centerbox valign={Gtk.Align.CENTER}>
          {/* Los dos tiempos van con `canTarget={false}` porque `.qs-media-time` lleva
              `margin-top: -3px` y esta fila se PRUEBA ANTES que la del progreso (GTK4
              recorre los hijos al revés al elegir destino): siendo alcanzables se
              tragaban la pulsación en los últimos píxeles de la barra y el arrastre no
              llegaba a empezar. No pierden nada: son texto sin interacción. */}
          <box $type="start" hexpand valign={Gtk.Align.CENTER}>
            <label
              cssClasses={["qs-media-time"]}
              label={positionLabel}
              canTarget={false}
              halign={Gtk.Align.START}
              hexpand
              marginEnd={10}
              ellipsize={3}
              maxWidthChars={MEDIA_TIME_MAX_CHARS}
            />
            <button
              cssClasses={["qs-media-btn", "qs-media-like"]}
              visible={likeVisible}
              halign={Gtk.Align.END}
              marginEnd={2}
              onClicked={() => {
                const id = trackId.get()
                if (!id) return
                const next = !liked.get()
                setLiked(next) // optimista
                Spotify.setLiked(id, next).then((ok) => {
                  if (!desmontado && !ok && trackId.get() === id) setLiked(!next)
                })
              }}
            >
              <label label={liked((v) => v ? "󰋑" : "󰋕")} />
            </button>
          </box>
          <box
            $type="center"
            spacing={2}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
            cssClasses={["qs-media-controls"]}
          >
            <button cssClasses={["qs-media-btn"]} onClicked={() => {
              const p = reproductoresMultimedia.get()[playerIndex.get()]
              if (p) {
                const name = p.bus_name.replace("org.mpris.MediaPlayer2.", "")
                execAsync(["playerctl", "-p", name, "previous"]).catch(() => {})
              }
            }}>
              <label label="󰒮" />
            </button>
            <button cssClasses={["qs-media-btn"]} onClicked={() => {
              const p = reproductoresMultimedia.get()[playerIndex.get()]
              if (p) p.play_pause()
            }}>
              <label label={isPlaying((v) => v ? "󰏤" : "󰐊")} />
            </button>
            <button cssClasses={["qs-media-btn"]} onClicked={() => {
              const p = reproductoresMultimedia.get()[playerIndex.get()]
              if (p) {
                const name = p.bus_name.replace("org.mpris.MediaPlayer2.", "")
                execAsync(["playerctl", "-p", name, "next"]).catch(() => {})
              }
            }}>
              <label label="󰒭" />
            </button>
          </box>
          <label
            $type="end"
            cssClasses={["qs-media-time"]}
            label={durationLabel}
            canTarget={false}
            halign={Gtk.Align.END}
            valign={Gtk.Align.CENTER}
            marginStart={10}
            ellipsize={3}
            maxWidthChars={MEDIA_TIME_MAX_CHARS}
          />
        </centerbox>
      </box>
    </box>
  )

  onCleanup(() => {
    desmontado = true
    cancelarRevision()
    cancelarVisibilidad()
    cancelarCaratula()
    cancelarAnuncioCaratula()
    cancelarFiltroCaratula()
    cancelarFiltroAnuncio()
    cancelarFiltroAcento()
    cancelarScrimCaratula()
    cancelarScrimAnuncio()
    cancelarProgreso()
    cancelarProgresoAcento()
    cancelarOndasReproduccion()
    cancelarOndasProgreso()
    cancelarOndasPanel()
    if (idTickOndas !== null) {
      progressArea.remove_tick_callback(idTickOndas)
      idTickOndas = null
    }
    if (mediaTimer !== null) GLib.source_remove(mediaTimer)
    for (const id of temporizadoresTransitorios) GLib.source_remove(id)
    temporizadoresTransitorios.clear()
    pendingLengthQueries.clear()
  })

  return (
    <box
      cssClasses={["qs-media"]}
      visible={hasPlayer}
      overflow={Gtk.Overflow.HIDDEN}
    >
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onReleased={focusPlayerWindow}
      />
      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE}
        onScroll={(_self, _dx, dy) => {
          if (numPlayers.get() <= 1 || dy === 0) return false
          if (dy > 0) nextPlayer()
          else prevPlayer()
          return true
        }}
      />
      <Gtk.Overlay $={(self: any) => {
        // colorFilter/coverScrim van en un Overlay INTERNO cuyo child principal
        // es bgCap, no en el externo junto a mediaContent: así su tamaño real
        // sale directamente de la asignación de bgCap en vez de duplicarla con
        // otra constante (CARD_H) que puede redondear distinto a escala
        // fraccional (p. ej. 1.25) y dejar sin cubrir la última fila del fondo.
        const bgOverlay = new Gtk.Overlay()
        bgOverlay.set_child(bgCap)
        bgOverlay.add_overlay(colorFilter)
        bgOverlay.add_overlay(coverScrim)
        self.set_child(bgOverlay)
        self.add_overlay(mediaContent)
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

                  // Apply device preset if new.
                  // `ep.name` viene a null en el perfil ALSA clásico (altavoces/mic
                  // comparten sink/source genérico); sin fallback, la clave colapsaba
                  // literalmente a "dev:mic:null" y el guard `ep.name &&` de abajo
                  // impedía releerla, así que el preset se guardaba pero nunca se
                  // restauraba. `ep.description` sí se puebla en ese caso (ver Volume.tsx).
                  const devTag = isSpk ? "spk" : "mic"
                  const stableId = ep.name || ep.description || `id:${ep.id}`
                  const devKey = `dev:${devTag}:${stableId}`
                  // El micro remapea 0-100% a 0-MIC_SAFE_MAX de la curva real de PipeWire
                  // (ver la constante). El clamp al restaurar protege contra un preset
                  // guardado antes de este techo (p.ej. un 100% viejo, que saturaba).
                  const maxVol = isSpk ? 1 : MIC_SAFE_MAX
                  if (!handledDevices.has(`${devTag}:${stableId}`)) {
                    const p = presets.get()[devKey]
                    if (p !== undefined) {
                      ep.volume = clamp(p, 0, maxVol)
                    }
                    handledDevices.add(`${devTag}:${stableId}`)
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
                    { heightRequest: 4, max: maxVol },
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
                            display={vol((v) => `${Math.round((v / maxVol) * 100)}`)}
                            getValue={() => (ep.volume / maxVol) * 100}
                            onCommit={(value) => {
                              const v = clamp((value / 100) * maxVol, 0, maxVol)
                              ep.volume = v
                              const p = { ...presets.get(), [devKey]: v }
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
    applyBrightness(value / 100)
    saveDisplayConfig()
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
      applyBrightness(v)
      saveDisplayConfig()
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

      {/* Selector de monitor — innecesario si solo hay una pantalla. */}
      <With value={createComputed(() => monitors().length > 1)}>
        {(hasMultipleMonitors: boolean) => hasMultipleMonitors && (
          <box orientation={Gtk.Orientation.VERTICAL} spacing={5}>
            <label
              cssClasses={["qs-dropdown-header", "qs-display-detected-title"]}
              label="PANTALLAS DETECTADAS"
              halign={Gtk.Align.START}
              marginStart={10}
              marginEnd={10}
            />
            <box cssClasses={["qs-display-monitor-tabs"]} spacing={6} marginStart={10} marginEnd={10}>
              {/* Indexado por conector: `monitors` se repuebla con objetos NUEVOS en
                  cada sondeo de `hyprctl monitors -j` (cada 2 s mientras esta vista
                  está abierta), así que sin clave bastaba mover el foco de pantalla
                  para rehacer todas las pastillas. El punto de foco es lo único que
                  cambia, y por eso se lee del state en vez del objeto capturado. */}
              <For each={monitors} id={(m: any) => m.name}>
                {(m: any) => (
                  <button
                    cssClasses={selectedName((n) => n === m.name ? ["qs-display-monitor-pill", "active"] : ["qs-display-monitor-pill"])}
                    onClicked={() => setSelectedName(m.name)}
                  >
                    <box spacing={5} valign={Gtk.Align.CENTER}>
                      <label
                        cssClasses={["qs-display-monitor-dot"]}
                        label="●"
                        visible={monitors((lista: any[]) =>
                          !!lista.find((actual: any) => actual.name === m.name)?.focused)}
                      />
                      <label label={m.name} ellipsize={3} maxWidthChars={14} />
                    </box>
                  </button>
                )}
              </For>
            </box>
          </box>
        )}
      </With>

      {/* Gestión del monitor seleccionado */}
      <box cssClasses={["qs-section", "qs-display-panel"]} orientation={Gtk.Orientation.VERTICAL} spacing={6}
        visible={createComputed(() => monitors().length > 1)}>
        {/* Encendido */}
        <box spacing={6} visible={createComputed(() => monitors().length > 1)}>
          <label cssClasses={["qs-section-icon"]} label="󰍹" />
          <label cssClasses={["qs-section-label"]} label="Encendido" hexpand halign={Gtk.Align.START} />
          <Interruptor
            activo={createComputed(() => { const s = selected(); return s ? !s.disabled : false })}
            alAlternar={() => {
              const s = selected(); if (!s) return
              if (!s.disabled && !canDisable(s)) return // guarda: no apagar el último activo
              applyPatch(s, { enabled: s.disabled })
            }}
          />
        </box>

        {/* Controles (ocultos si el monitor está apagado) */}
        <box orientation={Gtk.Orientation.VERTICAL} spacing={3}
          visible={createComputed(() => { const s = selected(); return !!s && !s.disabled })}>

          {/* Los ajustes de modo solo son útiles al gestionar varias pantallas. */}
          <With value={createComputed(() => monitors().length > 1)}>
            {(hasMultipleMonitors: boolean) => hasMultipleMonitors && (
              <box orientation={Gtk.Orientation.VERTICAL} spacing={3}>
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
              </box>
            )}
          </With>

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

      {/* Brillo + Luz nocturna. El brillo solo se muestra si hay backend (panel interno o
          DDC/CI); ver `display/brightness.ts`. */}
      <box cssClasses={["qs-section", "qs-display-panel"]} orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={0} visible={brightnessSupported}>
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
            <Interruptor activo={nightOn} alAlternar={() => toggleNightNow()} />
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

  return (
    <box cssClasses={["qs-footer"]} spacing={10}>
      <box cssClasses={["qs-user-block"]} spacing={10} hexpand halign={Gtk.Align.START}>
        <ProfileAvatar
          size={30}
          fallbackLabel={initials}
          fallbackCssClasses={["qs-avatar"]}
          borderWidth={1}
          borderRgba={[139 / 255, 120 / 255, 1, 0.3]}
        />
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
  const [btSupported, setBtSupported] = createState(!!bt.adapter)
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
    if (scanning.get() || !btSupported.get() || !bt.isPowered) return
    const adapter = bt.adapter
    if (!adapter) return

    try {
      adapter.start_discovery()
      setScanning(true)
      setBuffering(true)
    } catch (error) {
      console.warn(`No se pudo iniciar el escaneo Bluetooth: ${bluetoothPowerError(error)}`)
      setScanning(false)
      setBuffering(false)
      return
    }

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
    if (!btSupported.get() || !bt.isPowered || scanning.get()) return
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
  // Al abrir, resembrar `btSupported` por lo mismo que el tile: es una foto y el adaptador puede
  // haber ido y venido con el panel cerrado.
  quickSettingsVisible.subscribe(() => {
    if (quickSettingsVisible.get()) setBtSupported(!!bt.adapter)
    else { stopScan(); clearPowerOnTimer() }
  })

  // Solo refrescamos la lista mientras la vista Bluetooth está visible. Con el QS
  // cerrado o en otra pestaña ignoramos las señales: antes cada notify::devices
  // reconstruía la lista aunque nadie la mirara (mismo patrón que el menú WiFi).
  const inBtView = () => qsView.get() === "bluetooth"
  const syncAdapter = () => {
    const supported = !!bt.adapter
    setBtSupported(supported)
    if (!supported) {
      stopScan()
      clearPowerOnTimer()
      setDevices([])
    } else if (inBtView()) {
      update()
      autoScan()
    }
  }
  // Al encender el BT dentro de la sección: refresco inmediato + escaneo activo.
  bt.connect("notify::is-powered", () => { if (inBtView()) { update(); autoScan() } })
  bt.connect("notify::devices", () => { if (inBtView()) update() })
  bt.connect("notify::adapter", syncAdapter)
  bt.connect("adapter-added", syncAdapter)
  bt.connect("adapter-removed", syncAdapter)
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
        onKeyPressed={(self, keyval, _keycode, state) => btSupported.get()
          ? handleSearchSectionKey(self, searchEntry, keyval, state)
          : false}
      />
      <QsMenuHeader title="Bluetooth" onBack={onBack} titleHexpand={false}>
        <box cssClasses={["qs-wifi-search"]} spacing={0} hexpand valign={Gtk.Align.CENTER} visible={btSupported}>
          {searchEntry}
        </box>
        <button
          cssClasses={["qs-icon-btn"]}
          visible={btSupported}
          onClicked={() => execAsync("blueman-manager").catch(() => {})}
        ><label label="󰒓" /></button>
        <button
          cssClasses={scanning((s) => s ? ["qs-icon-btn", "scanning"] : ["qs-icon-btn"])}
          visible={btSupported}
          sensitive={createComputed(() => btSupported() && btPowered())}
          onClicked={() => scan()}
        ><label label="󰑐" /></button>
        <Interruptor
          activo={btPowered}
          clasesAdicionales={["qs-header-toggle"]}
          visible={btSupported}
          alAlternar={() => { void toggleBluetoothPower(bt) }}
        />
      </QsMenuHeader>

      <Gtk.ScrolledWindow
        cssClasses={["qs-wifi-list-scroll"]}
        visible={btSupported}
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

      <box
        cssClasses={["qs-bt-unsupported"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        visible={btSupported((supported) => !supported)}
        valign={Gtk.Align.CENTER}
        vexpand
      >
        <label cssClasses={["qs-bt-unsupported-icon"]} label="󰂲" />
        <label cssClasses={["qs-bt-unsupported-title"]} label="Bluetooth no compatible" />
        <label
          cssClasses={["qs-bt-unsupported-description"]}
          label="Este equipo no tiene ningún adaptador Bluetooth disponible."
          justify={Gtk.Justification.CENTER}
          wrap
        />
      </box>
    </box>
  )
}

// ── WiFi Menu ─────────────────────────────────────────────────────────────────

function QsWifiMenu({ onBack }: { onBack: () => void }) {
  const network = AstalNetwork.get_default()
  const wifi = network.wifi
  const [scanning, setScanning] = createState(false)

  if (!wifi) {
    const getWiredInfo = () => {
      const wired = network.wired
      const active = !!wired && wired.state === AstalNetwork.DeviceState.ACTIVATED
      return {
        active,
        name: active
          ? network.client.get_primary_connection()?.get_id() || "Ethernet"
          : "Red",
      }
    }
    const [wiredInfo, setWiredInfo] = createState(getWiredInfo())
    const syncWiredInfo = () => setWiredInfo(getWiredInfo())

    if (network.wired) {
      network.wired.connect("notify::state", syncWiredInfo)
    }
    network.connect("notify::wired", syncWiredInfo)
    network.client.connect("notify::primary-connection", syncWiredInfo)
    network.client.get_primary_connection()?.connect("notify::id", syncWiredInfo)
    qsView.subscribe(() => {
      if (qsView.get() === "wifi") syncWiredInfo()
    })

    return (
      <box cssClasses={["qs-wifi-menu"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <QsMenuHeader title="Ethernet" onBack={onBack}>
          <button
            cssClasses={["qs-icon-btn"]}
            tooltipText="Ajustes de red"
            onClicked={() => execAsync("nm-connection-editor")}
          ><label label="󰒓" /></button>
        </QsMenuHeader>
        <label
          label={wiredInfo((info) => info.active
            ? `Conexión Ethernet activa · ${info.name}`
            : "No se encontró ningún dispositivo Wi-Fi")}
          halign={Gtk.Align.CENTER}
        />
      </box>
    )
  }

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
        <Interruptor
          activo={wifiEnabled}
          alAlternar={() => execAsync(["bash", "-c", wifi.enabled ? "nmcli radio wifi off" : "nmcli radio wifi on"])}
        />
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
  // Techo de seguridad del arranque de la entrada. El reloj de frames sólo corre mientras
  // la superficie está mapeada, así que si no llegara ningún tick con allocación la
  // entrada debe arrancar igual: quedarse en `qs-preparing` es quedarse en opacity 0, o
  // sea un panel abierto e invisible. Fail-open, como en NotificationPanel y Orion.
  const PANEL_PREPARE_CAP_MS = 120
  const PANEL_ENTER_MS = 280
  // La salida vertical necesita cruzar el borde con suficiente antelación para
  // que el último muestreo visible no sea una franja del pie. Se calcula sobre
  // la altura real porque las vistas internas de QS no miden todas lo mismo.
  const PANEL_EXIT_CLEARANCE_RATIO = 0.2
  // Tiempo mínimo en el reloj de fotogramas antes de desmapear. La salida CSS
  // dura 220 ms; después se exige además un frame final ya fuera de pantalla.
  const PANEL_EXIT_MS = 280

  let qsPanelRef: any = null
  let qsAnimationRef: any = null
  let qsWindowRef: any = null
  const [qsRendered, setQsRendered] = createState(quickSettingsVisible.get())
  // Pedir foco ON_DEMAND al mapear el layer-surface hace que Hyprland deje el
  // puntero asociado a la superficie nueva hasta el siguiente motion. Si el
  // ratón sigue sobre el botón del bar, el clic para cerrar se pierde. El panel
  // empieza sin foco y solo lo solicita cuando el puntero entra de verdad en él;
  // así los Entry y Escape siguen funcionando al interactuar con su contenido.
  const [qsKeyboardActive, setQsKeyboardActive] = createState(false)
  const [qsExitCss, setQsExitCss] = createState(".qs-wrapper {}")
  let enterTickId: number | null = null
  let enterCapTimer: number | null = null
  let entrancePending = false
  let entranceGuardTimer: number | null = null
  let exitTickId: number | null = null
  let hoverCloseTimer: number | null = null
  let entranceActive = false
  // Recorte de la región de entrada; se asigna tras construir la ventana. Debe re-ejecutarse al
  // terminar la animación de entrada (el transform de deslizamiento falsea la medida mientras corre).
  let reclipInput: ((inmediato?: boolean) => void) | null = null

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
    setQsKeyboardActive(true)
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

  /** Suelta el tick y el techo de la preparación, ganen o pierdan. */
  function cancelPrepare(): void {
    if (enterTickId !== null) {
      qsAnimationRef?.remove_tick_callback(enterTickId)
      enterTickId = null
    }
    if (enterCapTimer !== null) {
      GLib.source_remove(enterCapTimer)
      enterCapTimer = null
    }
  }

  /** Arranca el deslizamiento visible. Idempotente: la gana el tick o el techo, no ambos. */
  function startEntrance(): void {
    if (!entrancePending) return
    entrancePending = false
    cancelPrepare()
    // Región completa mientras dura la entrada; la silueta real la fija el reclip
    // del guard de abajo. Medir aquí NO vale: `qs-preparing` ya trae su propio
    // `translateY(-220px)` (no solo la clase de la animación), y GTK4 pliega el
    // transform de CSS en la asignación, así que `compute_bounds()` devolvía el
    // panel 220 px más arriba — la región caía fuera de la superficie por arriba y
    // los 220 px inferiores del panel se quedaban sordos al ratón hasta el reclip.
    reclipInput?.(true)
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
  }

  function beginEntrance(): void {
    entrancePending = false
    cancelPrepare()
    if (entranceGuardTimer !== null) { GLib.source_remove(entranceGuardTimer); entranceGuardTimer = null }
    entranceActive = true
    // Quitar la animación de salida dinámica mientras la ventana aún está oculta.
    setQsExitCss(".qs-wrapper {}")
    qsAnimationRef?.remove_css_class("qs-entering")
    qsAnimationRef?.add_css_class("qs-preparing")
    setQsRendered(true)
    entrancePending = true

    // La animación arranca cuando GTK dice que ya ha medido y pintado, NO a un plazo fijo
    // (eran 32 ms apostados a ciegas). Aquí el tirón no se notaba —el panel es pequeño y
    // su árbol cabe de sobra en dos fotogramas—, pero el plazo fijo sigue siendo una
    // apuesta: basta un arranque con la caché fría, un monitor a 60 Hz o un frame perdido
    // para que la entrada empiece con el layout a medias. Mismo remedio que en
    // NotificationPanel y Orion; el reloj de frames ya sabe cuándo ha terminado.
    let framesSeen = 0
    enterTickId = qsAnimationRef?.add_tick_callback((widget: any) => {
      if (!entrancePending) return false
      // El tick corre en la fase de ACTUALIZACIÓN, antes de pintar, y los primeros pueden
      // llegar sin allocación. Se espera a tener altura real (ya medido) y a un frame más:
      // ese es el primero con el panel preparado ya pintado.
      if ((widget.get_height?.() ?? 0) <= 0) return true
      if (++framesSeen < 2) return true
      enterTickId = null   // ya nos vamos: que cancelPrepare no lo quite dos veces
      startEntrance()
      return false
    }) ?? null

    enterCapTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_PREPARE_CAP_MS, () => {
      enterCapTimer = null
      startEntrance()
      return GLib.SOURCE_REMOVE
    })
  }

  // Mantener la ventana mapeada durante la salida permite completar el recorrido
  // hacia arriba antes de ocultarla realmente.
  quickSettingsVisible.subscribe(() => {
    cancelHoverClose()
    if (quickSettingsVisible.get()) {
      setQsKeyboardActive(false)
      cancelExitWait()
      beginEntrance()
      return
    }

    setQsKeyboardActive(false)
    entrancePending = false
    cancelPrepare()
    if (entranceGuardTimer !== null) {
      GLib.source_remove(entranceGuardTimer)
      entranceGuardTimer = null
    }
    entranceActive = false
    qsAnimationRef?.remove_css_class("qs-preparing")
    qsAnimationRef?.remove_css_class("qs-entering")
    // Medir la superficie completa (no solo el wrapper) y añadir holgura hace
    // que el borde inferior cruce el límite varios frames antes del final.
    const surfaceHeight = qsWindowRef?.get_surface?.()?.get_height?.() ?? 0
    const windowHeight = qsWindowRef?.get_height?.() ?? 0
    const wrapperHeight = qsAnimationRef?.get_height?.() ?? 0
    const exitBaseHeight = Math.max(1, Math.ceil(Math.max(
      surfaceHeight,
      windowHeight,
      wrapperHeight,
    )))
    const exitDistance = Math.ceil(exitBaseHeight * (1 + PANEL_EXIT_CLEARANCE_RATIO))
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
    namespace="quick-settings"
    visible={qsRendered}
    gdkmonitor={gdkmonitor}
    layer={Astal.Layer.TOP}
    exclusivity={Astal.Exclusivity.NORMAL}
    keymode={qsKeyboardActive((active) =>
      active ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
    anchor={TOP | RIGHT}
    application={app}
    widthRequest={PANEL_TOTAL_WIDTH}
    // La zona exclusiva de la barra mide 38px. Igual que PANEL_TOP=37 cuando
    // flota, solapamos 1px al quedar fija para evitar una costura transparente.
    marginTop={barTopMargin(PANEL_TOP, -1)}
    marginRight={0}
    decorated={false}
    cssClasses={clasesFondoShell("qs-window")}
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

  reclipInput = clipWindowInputToContent(result, qsPanelRef, {
    superficieCompletaMientras: () => entranceActive,
  })
  return result
}
