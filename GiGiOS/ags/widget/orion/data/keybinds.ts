import { readFile } from "ags/file"
import GLib from "gi://GLib"

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
  [/kitty/, "Abrir terminal"],
  [/dolphin/, "Abrir gestor de archivos"],
  [/nautilus/, "Abrir gestor de archivos"],
  [/firefox/, "Abrir Firefox"],
  [/\bcode\b/, "Abrir VS Code"],
  [/obsidian/, "Abrir Obsidian"],
  [/discord/, "Abrir Discord"],
  [/cliphist.*wl-copy|wofi.*dmenu/, "Abrir portapapeles"],
  [/rofi.*drun|hyprlauncher|pkill.*rofi/, "Abrir lanzador de apps"],
  [/hyprshot.*region/, "Captura de región"],
  [/hyprshot.*output/, "Captura de pantalla"],
  [/wf-recorder.*slurp/, "Grabar región de pantalla"],
  [/record\.sh|wf-recorder/, "Grabar pantalla (toggle)"],
  [/qalculate/, "Abrir calculadora"],
  [/hyprshutdown|hyprctl.*exit/, "Salir de Hyprland"],
  [/wpctl.*set-volume.*5%\+/, "Subir volumen 5%"],
  [/wpctl.*set-volume.*5%-/, "Bajar volumen 5%"],
  [/wpctl.*set-mute.*SOURCE/, "Silenciar/activar micrófono"],
  [/wpctl.*set-mute/, "Silenciar/activar audio"],
  [/brightnessctl.*5%\+/, "Subir brillo 5%"],
  [/brightnessctl.*5%-/, "Bajar brillo 5%"],
  [/playerctl next/, "Siguiente pista"],
  [/playerctl previous/, "Pista anterior"],
  [/playerctl play-pause/, "Play / Pausa"],
  [/ags toggle orion/, "Mostrar/ocultar panel Orion"],
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

let _keybindsCache: KeybindGroup[] | null = null

export function getKeybinds(): KeybindGroup[] {
  if (_keybindsCache) return _keybindsCache
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
      const m = t.match(/^(bind[elm]?)\s*=\s*([^,]*),\s*([^,]+),\s*([^,#]+)(?:,\s*([^#]*))?/)
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
  _keybindsCache = groups
  return groups
}
