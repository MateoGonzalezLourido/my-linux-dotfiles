import GLib from "gi://GLib"
import { createState } from "ags"
import { execAsync } from "ags/process"

export interface DeviceSettings {
  kbLayout: string
  kbVariant: string
  repeatRate: number
  repeatDelay: number
  numlock: boolean
  followMouse: number
  tamanoCursor: number
  sensitivity: number
  accelProfile: "adaptive" | "flat"
  forceNoAccel: boolean
  leftHanded: boolean
  mouseNaturalScroll: boolean
  mouseScrollFactor: number
  touchpadNaturalScroll: boolean
  touchpadScrollFactor: number
  tapToClick: boolean
  tapButtonMap: "lrm" | "lmr"
  disableWhileTyping: boolean
  clickfinger: boolean
  middleEmulation: boolean
  dragLock: boolean
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  kbLayout: "es", kbVariant: "", repeatRate: 25, repeatDelay: 600,
  numlock: true, followMouse: 1, tamanoCursor: 24,
  sensitivity: 0, accelProfile: "adaptive", forceNoAccel: false,
  leftHanded: false, mouseNaturalScroll: false, mouseScrollFactor: 1,
  touchpadNaturalScroll: true, touchpadScrollFactor: 0.4,
  tapToClick: true, tapButtonMap: "lrm", disableWhileTyping: true,
  clickfinger: false, middleEmulation: false, dragLock: false,
}

const DATA_PATH = `${GLib.get_user_config_dir()}/gigios/devices.json`
// Chunk Lua puro generado: lo carga hyprland.lua con carga protegida
// (util.carga_opcional) DESPUÉS de gigios/userprefs.lua, para que estas
// preferencias pisen a las de ahí. El antiguo input-settings.conf deja de
// escribirse; queda en el repo solo para la config legacy.
const HYPR_PATH = `${GLib.get_user_config_dir()}/hypr/input-settings.lua`

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function normalize(raw: Partial<DeviceSettings> = {}): DeviceSettings {
  const d = DEFAULT_DEVICE_SETTINGS
  return {
    ...d, ...raw,
    kbLayout: typeof raw.kbLayout === "string" && raw.kbLayout.trim() ? raw.kbLayout.trim() : d.kbLayout,
    kbVariant: typeof raw.kbVariant === "string" ? raw.kbVariant.trim() : d.kbVariant,
    repeatRate: Math.round(clamp(raw.repeatRate, 1, 100, d.repeatRate)),
    repeatDelay: Math.round(clamp(raw.repeatDelay, 100, 2000, d.repeatDelay)),
    followMouse: Math.round(clamp(raw.followMouse, 0, 3, d.followMouse)),
    tamanoCursor: Math.round(clamp(raw.tamanoCursor, 16, 64, d.tamanoCursor)),
    sensitivity: clamp(raw.sensitivity, -1, 1, d.sensitivity),
    mouseScrollFactor: clamp(raw.mouseScrollFactor, 0.1, 5, d.mouseScrollFactor),
    touchpadScrollFactor: clamp(raw.touchpadScrollFactor, 0.1, 5, d.touchpadScrollFactor),
    accelProfile: raw.accelProfile === "flat" ? "flat" : "adaptive",
    tapButtonMap: raw.tapButtonMap === "lmr" ? "lmr" : "lrm",
  }
}

function read(): DeviceSettings {
  try {
    const [ok, bytes] = GLib.file_get_contents(DATA_PATH)
    if (ok) return normalize(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (_) { /* defaults */ }
  return { ...DEFAULT_DEVICE_SETTINGS }
}

function sameSettings(a: DeviceSettings, b: DeviceSettings): boolean {
  return (Object.keys(DEFAULT_DEVICE_SETTINGS) as (keyof DeviceSettings)[]).every((key) => a[key] === b[key])
}

const [deviceSettings, _setDeviceSettings] = createState<DeviceSettings>(read())
export { deviceSettings }

const yes = (v: boolean) => v ? "true" : "false"
// Literal de cadena Lua: kb_layout/kb_variant se interpolan en un chunk y una
// comilla sin escapar rompería el fichero generado (y la config al recargar).
const luaStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
export function renderHyprInput(s: DeviceSettings): string {
  // Ojo con los nombres: en Lua el campo es `tap_to_click` (HL.ConfigOpt.Input.Touchpad),
  // no el `tap-to-click` de hyprlang — verificado con getoption en instancia anidada.
  return `-- Generado por AGS · Ajustes > Dispositivos. No editar a mano.\n` +
    `-- Chunk Lua puro: lo carga hyprland.lua con carga protegida (util.carga_opcional)\n` +
    `-- después de gigios/userprefs.lua, para que estas preferencias pisen a las de ahí.\n` +
    `hl.env("XCURSOR_SIZE", "${s.tamanoCursor}")\nhl.env("HYPRCURSOR_SIZE", "${s.tamanoCursor}")\n\n` +
    `hl.config({\n  input = {\n` +
    `    kb_layout = ${luaStr(s.kbLayout)},\n    kb_variant = ${luaStr(s.kbVariant)},\n` +
    `    repeat_rate = ${s.repeatRate},\n    repeat_delay = ${s.repeatDelay},\n` +
    `    numlock_by_default = ${yes(s.numlock)},\n    follow_mouse = ${s.followMouse},\n` +
    `    sensitivity = ${s.sensitivity.toFixed(2)},\n    accel_profile = ${luaStr(s.accelProfile)},\n` +
    `    force_no_accel = ${yes(s.forceNoAccel)},\n    left_handed = ${yes(s.leftHanded)},\n` +
    `    natural_scroll = ${yes(s.mouseNaturalScroll)},\n    scroll_factor = ${s.mouseScrollFactor.toFixed(2)},\n\n` +
    `    touchpad = {\n      natural_scroll = ${yes(s.touchpadNaturalScroll)},\n` +
    `      scroll_factor = ${s.touchpadScrollFactor.toFixed(2)},\n      tap_to_click = ${yes(s.tapToClick)},\n` +
    `      tap_button_map = ${luaStr(s.tapButtonMap)},\n      disable_while_typing = ${yes(s.disableWhileTyping)},\n` +
    `      clickfinger_behavior = ${yes(s.clickfinger)},\n      middle_button_emulation = ${yes(s.middleEmulation)},\n` +
    `      drag_lock = ${yes(s.dragLock)},\n    },\n  },\n})\n`
}

function write(s: DeviceSettings) {
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(DATA_PATH), 0o755)
    GLib.mkdir_with_parents(GLib.path_get_dirname(HYPR_PATH), 0o755)
    GLib.file_set_contents(DATA_PATH, JSON.stringify(s, null, 2))
    const nextHypr = renderHyprInput(s)
    let currentHypr = ""
    try {
      const [ok, bytes] = GLib.file_get_contents(HYPR_PATH)
      if (ok) currentHypr = new TextDecoder().decode(bytes)
    } catch (_) { /* archivo ausente: se creara al guardar */ }
    if (currentHypr !== nextHypr) GLib.file_set_contents(HYPR_PATH, nextHypr)
  } catch (e) { console.error("[devices] No se pudo guardar:", e) }
}

export function updateDeviceSettings(patch: Partial<DeviceSettings>, reload = false) {
  const next = normalize({ ...deviceSettings.get(), ...patch })
  if (sameSettings(deviceSettings.get(), next)) return
  _setDeviceSettings(next)
  write(next)
  if (patch.tamanoCursor !== undefined) aplicarTamanoCursor(next.tamanoCursor)
  // El reload puede ir detrás sin más: write() escribe input-settings.lua de forma
  // SÍNCRONA (GLib.file_set_contents), así que cuando el `hyprctl reload` re-ejecute
  // la config Lua entera el fichero ya está completo en disco — no puede pisar la
  // sesión con un chunk a medio escribir.
  if (reload) execAsync(["hyprctl", "reload"]).catch(() => {})
  else {
    // `hyprctl keyword` no existe bajo config Lua: todos los campos cambiados van
    // en UN solo `hyprctl eval` con la tabla anidada que espera hl.config.
    const lua = liveConfigLua(patch, next)
    if (lua) execAsync(["hyprctl", "eval", lua]).catch(() => {})
  }
}

const RUTAS_ICONOS = [
  `${GLib.get_user_data_dir()}/icons`,
  `${GLib.get_home_dir()}/.icons`,
  ...GLib.get_system_data_dirs().map((ruta) => `${ruta}/icons`),
]

function leerHerenciasTema(nombre: string): string[] {
  for (const ruta of RUTAS_ICONOS) {
    try {
      const [ok, bytes] = GLib.file_get_contents(`${ruta}/${nombre}/index.theme`)
      if (!ok) continue
      const herencias = new TextDecoder().decode(bytes).match(/^Inherits\s*=\s*(.+)$/m)?.[1]
      if (herencias) return herencias.split(/[;,]/).map((tema) => tema.trim()).filter(Boolean)
    } catch (_) { /* probar la siguiente ruta */ }
  }
  return []
}

function resolverTemaHyprcursor(nombre: string, visitados = new Set<string>()): string | null {
  const tema = nombre.trim()
  if (!/^[A-Za-z0-9._+-]+$/.test(tema) || visitados.has(tema)) return null
  visitados.add(tema)

  if (RUTAS_ICONOS.some((ruta) => GLib.file_test(`${ruta}/${tema}/manifest.hl`, GLib.FileTest.EXISTS))) return tema
  for (const heredado of leerHerenciasTema(tema)) {
    const resuelto = resolverTemaHyprcursor(heredado, visitados)
    if (resuelto) return resuelto
  }
  return null
}

function aplicarTamanoCursor(tamano: number) {
  // GTK no sigue `hyprctl setcursor`; GSettings cubre GTK y persiste por su lado.
  execAsync(["gsettings", "set", "org.gnome.desktop.interface", "cursor-size", String(tamano)]).catch(() => {})

  // Hyprland solo acepta temas hyprcursor. Resolvemos también el alias `default`
  // para no fijar un tema concreto que pueda no existir en otra máquina.
  const candidatos = [GLib.getenv("HYPRCURSOR_THEME"), GLib.getenv("XCURSOR_THEME"), "default"]
  const tema = candidatos.reduce<string | null>((encontrado, candidato) =>
    encontrado ?? resolverTemaHyprcursor(candidato ?? ""), null)
  // HL.ConfigOpt no tiene sección env: las variables van por hl.env(). El --batch
  // admite mezclar `eval …` con `setcursor …` separados por " ; " (verificado en
  // 0.56); lo que NO admite es dispatch con sintaxis legacy.
  const comandos = [
    `eval hl.env('XCURSOR_SIZE','${tamano}')`,
    `eval hl.env('HYPRCURSOR_SIZE','${tamano}')`,
  ]
  if (tema) comandos.push(`setcursor ${tema} ${tamano}`)
  execAsync(["hyprctl", "--batch", comandos.join(" ; ")]).catch(() => {})
}

// Ruta de cada campo dentro de la tabla de hl.config({ input = … }). Es el mapa
// que era LIVE_KEYWORDS, con el anidamiento explícito (input:touchpad:x →
// {input={touchpad={x=…}}}) y los nombres Lua (tap_to_click, no tap-to-click).
const LIVE_LUA_PATHS: Partial<Record<keyof DeviceSettings, string[]>> = {
  kbLayout: ["kb_layout"], kbVariant: ["kb_variant"], repeatRate: ["repeat_rate"],
  repeatDelay: ["repeat_delay"], numlock: ["numlock_by_default"], followMouse: ["follow_mouse"],
  sensitivity: ["sensitivity"], accelProfile: ["accel_profile"], forceNoAccel: ["force_no_accel"],
  leftHanded: ["left_handed"], mouseNaturalScroll: ["natural_scroll"], mouseScrollFactor: ["scroll_factor"],
  touchpadNaturalScroll: ["touchpad", "natural_scroll"], touchpadScrollFactor: ["touchpad", "scroll_factor"],
  tapToClick: ["touchpad", "tap_to_click"], tapButtonMap: ["touchpad", "tap_button_map"],
  disableWhileTyping: ["touchpad", "disable_while_typing"], clickfinger: ["touchpad", "clickfinger_behavior"],
  middleEmulation: ["touchpad", "middle_button_emulation"], dragLock: ["touchpad", "drag_lock"],
}

function luaValue(value: DeviceSettings[keyof DeviceSettings]): string {
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  return luaStr(value)
}

// `hl.config({ input = {…} })` con SOLO los campos del patch que tienen mapeo,
// anidados donde toca. Devuelve null si el patch no toca nada aplicable en vivo.
function liveConfigLua(patch: Partial<DeviceSettings>, next: DeviceSettings): string | null {
  const input: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as (keyof DeviceSettings)[]) {
    const path = LIVE_LUA_PATHS[key]
    if (!path) continue
    let cursor = input
    for (const seg of path.slice(0, -1)) {
      cursor = (cursor[seg] ??= {}) as Record<string, unknown>
    }
    cursor[path[path.length - 1]] = next[key]
  }
  if (Object.keys(input).length === 0) return null
  const tabla = (obj: Record<string, unknown>): string =>
    `{ ${Object.entries(obj).map(([k, v]) =>
      `${k} = ${typeof v === "object" && v !== null ? tabla(v as Record<string, unknown>) : luaValue(v as DeviceSettings[keyof DeviceSettings])}`,
    ).join(", ")} }`
  return `hl.config({ input = ${tabla(input)} })`
}

export function resetDeviceSettings() {
  const next = { ...DEFAULT_DEVICE_SETTINGS }
  _setDeviceSettings(next)
  write(next)   // síncrono: el .lua queda completo ANTES del reload de abajo
  aplicarTamanoCursor(next.tamanoCursor)
  execAsync(["hyprctl", "reload"]).catch(() => {})
}

// No escribimos input-settings.lua al importar este modulo: Hyprland vigila sus
// archivos de configuracion y cualquier escritura en el arranque de AGS provoca
// una recarga visible. El archivo se guarda solo cuando el usuario cambia algo.
