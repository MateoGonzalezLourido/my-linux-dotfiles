import { readFile } from "ags/file"
import { createState } from "ags"
import GLib from "gi://GLib"
import Gio from "gi://Gio"

const HYPR = `${GLib.get_home_dir()}/.config/hypr`

export interface Keybind { binding: string; description: string }
export interface KeybindGroup { name: string; binds: Keybind[] }

function loadVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  try {
    for (const line of readFile(`${HYPR}/variables.conf`).split("\n")) {
      const m = line.match(/^\s*\$(\w+)\s*=\s*(.+?)(?:\s*#.*)?$/)
      if (m) vars[`$${m[1]}`] = m[2].trim()
    }
  } catch (_) {}
  return vars
}

function resolveVars(s: string, vars: Record<string, string>): string {
  return s.replace(/\$\w+/g, k => vars[k] ?? k)
}

const KEY_NAMES: Record<string, string> = {
  SUPER: "Super", CTRL: "Ctrl", SHIFT: "Shift", ALT: "Alt",
  Print: "PrtScn", Space: "Espacio", Return: "Enter", Tab: "Tab",
  left: "←", right: "→", up: "↑", down: "↓",
  mouse_down: "Scroll↓", mouse_up: "Scroll↑",
  "mouse:272": "Click izq", "mouse:273": "Click der",
  XF86AudioRaiseVolume: "Vol↑", XF86AudioLowerVolume: "Vol↓",
  XF86AudioMute: "Mute", XF86AudioMicMute: "Mic Mute",
  XF86MonBrightnessUp: "Brillo↑", XF86MonBrightnessDown: "Brillo↓",
  XF86AudioNext: "Media Next", XF86AudioPause: "Media Pausa",
  XF86AudioPlay: "Media Play", XF86AudioPrev: "Media Prev",
  XF86Calculator: "Calculadora",
}

function fmtKey(k: string): string { return KEY_NAMES[k] ?? k }

export function fmtBinding(rawMods: string, rawKey: string): string {
  const parts: string[] = []
  if (rawMods.trim()) rawMods.trim().split(/\s+/).forEach(m => parts.push(fmtKey(m)))
  parts.push(fmtKey(rawKey.trim()))
  return parts.join("+")
}

const EXEC_PATTERNS: [RegExp, string][] = [
  [/toggle-fake-fullscreen/, "Simular ventana maximizada"],
  [/toggle-gaps-borders/, "Pegar ventanas (toggle)"],
  [/compact-workspaces/, "Compactar workspaces"],
  [/kitty/, "Abrir terminal"],
  [/dolphin/, "Abrir gestor de archivos"],
  [/nautilus/, "Abrir gestor de archivos"],
  [/firefox/, "Abrir Firefox"],
  [/\bcode\b/, "Abrir VS Code"],
  [/obsidian/, "Abrir Obsidian"],
  [/discord/, "Abrir Discord"],
  [/clipboard-history|cliphist.*wl-copy|rofi.*dmenu/, "Abrir portapapeles"],
  [/rofi-launch|rofi.*drun|hyprlauncher|pkill.*rofi/, "Abrir lanzador de apps"],
  [/hyprshot.*region/, "Captura de región"],
  [/hyprshot.*output/, "Captura de pantalla"],
  [/wf-recorder.*slurp/, "Grabar región de pantalla"],
  [/grabar-pantalla\.sh\s+ventana/, "Grabar ventana seleccionada (toggle)"],
  [/grabar-pantalla\.sh|record\.sh|wf-recorder/, "Grabar pantalla (toggle)"],
  [/qalculate/, "Abrir calculadora"],
  [/hyprshutdown|hyprctl.*exit/, "Salir de Hyprland"],
  [/wpctl.*set-volume.*%\+/, "Subir volumen"],
  [/wpctl.*set-volume.*%-/, "Bajar volumen"],
  [/wpctl.*set-mute.*SOURCE/, "Silenciar/activar micrófono"],
  [/wpctl.*set-mute/, "Silenciar/activar audio"],
  [/brightnessctl.*%\+/, "Subir brillo"],
  [/brightnessctl.*%-/, "Bajar brillo"],
  [/playerctl next/, "Siguiente pista"],
  [/playerctl previous/, "Pista anterior"],
  [/playerctl play-pause/, "Play / Pausa"],
  [/toggle-orion|ags toggle orion/, "Mostrar/ocultar panel Orion"],
  [/toggle-bar|ags-bar-toggle/, "Mostrar/ocultar barra"],
  [/toggle-quicksettings/, "Mostrar/ocultar ajustes rápidos"],
]

function describeExec(cmd: string): string {
  for (const [re, label] of EXEC_PATTERNS) if (re.test(cmd)) return label
  return `Ejecutar ${cmd.trim().split(/[\s/]+/).filter(Boolean).pop() ?? cmd}`
}

function describeAction(action: string, args: string): string {
  const a = action.trim()
  const arg = args.trim()
  const dirs: Record<string, string> = { l: "←", r: "→", u: "↑", d: "↓" }
  switch (a) {
    case "exec":               return describeExec(arg)
    case "killactive":         return "Cerrar ventana activa"
    case "togglefloating":     return "Alternar flotante"
    case "fullscreen":         return "Pantalla completa"
    case "pseudo":             return "Modo pseudo tile"
    case "exit":               return "Salir de Hyprland"
    case "layoutmsg":          return arg === "togglesplit" ? "Cambiar división" : `Layout: ${arg}`
    case "togglespecialworkspace": return "Mostrar/ocultar scratchpad"
    case "resizewindow":       return "Redimensionar ventana (arrastrar)"
    case "movewindow":         return arg ? `Mover ventana ${dirs[arg] ?? arg}` : "Mover ventana (arrastrar)"
    case "movefocus":          return `Mover foco ${dirs[arg] ?? arg}`
    case "workspace":
      if (arg === "e+1")      return "Workspace siguiente"
      if (arg === "e-1")      return "Workspace anterior"
      if (arg === "previous") return "Workspace anterior"
      return `Ir al workspace ${arg}`
    case "movetoworkspace":
      return arg.startsWith("special") ? "Mover al scratchpad" : `Mover ventana → workspace ${arg}`
    case "movetoworkspacesilent":
      return `Mover ventana → workspace ${arg} (silencioso)`
    default:
      return arg ? `${a}: ${arg}` : a
  }
}

function formatGroupName(comment: string): string {
  const s = comment.replace(/^[#\-\s]+/, "").replace(/[\-\s]+$/, "").trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""
}

function parseKeybinds(): KeybindGroup[] {
  const vars = loadVars()
  const groups: KeybindGroup[] = []
  let cur: KeybindGroup = { name: "General", binds: [] }
  let prevBlank = true

  try {
    for (const line of readFile(`${HYPR}/keybinds.conf`).split("\n")) {
      const t = line.trim()
      if (!t) { prevBlank = true; continue }
      if (t.startsWith("#")) {
        const name = formatGroupName(t)
        if (name && prevBlank) {
          if (cur.binds.length > 0) groups.push(cur)
          cur = { name, binds: [] }
        }
        prevBlank = false
        continue
      }
      const m = t.match(/^(bind[a-z]*)\s*=\s*([^,]*),\s*([^,]+),\s*([^,#]+)(?:,\s*([^#]*))?/)
      if (m) {
        const [, type, rawMods, rawKey, rawAction, rawArgs = ""] = m
        const mods = resolveVars(rawMods.trim(), vars)
        const key  = resolveVars(rawKey.trim(), vars)
        const args = resolveVars(rawArgs.trim(), vars)
        const binding = fmtBinding(mods, key)
        const description = type === "bindm"
          ? (rawAction.trim() === "movewindow" ? "Mover ventana (arrastrar)" : "Redimensionar ventana (arrastrar)")
          : describeAction(rawAction.trim(), args)
        cur.binds.push({ binding, description })
      }
      prevBlank = false
    }
  } catch (_) {}

  if (cur.binds.length > 0) groups.push(cur)
  return groups
}

// Reactive keybinds: parsed at load, re-parsed whenever keybinds.conf or
// variables.conf change on disk, so the UI reflects edits without restarting AGS.
const [keybinds, setKeybinds] = createState<KeybindGroup[]>(parseKeybinds())
export { keybinds }

/** Current parsed keybinds (used by the search handler, which reads synchronously). */
export function getKeybinds(): KeybindGroup[] {
  return keybinds.get()
}

let _refreshTimer: number | null = null
function scheduleRefresh() {
  // Editors write in bursts; debounce so we parse once the file settles.
  if (_refreshTimer) clearTimeout(_refreshTimer)
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null
    setKeybinds(parseKeybinds())
  }, 200)
}

// Kept alive for the process lifetime so the monitors keep firing.
const _monitors: Gio.FileMonitor[] = []
for (const name of ["keybinds.conf", "variables.conf"]) {
  try {
    const monitor = Gio.file_new_for_path(`${HYPR}/${name}`)
      .monitor(Gio.FileMonitorFlags.NONE, null)
    monitor.connect("changed", scheduleRefresh)
    _monitors.push(monitor)
  } catch (e) {
    console.error(`[keybinds] monitor error for ${name}:`, e)
  }
}
