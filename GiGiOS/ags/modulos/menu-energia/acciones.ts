export interface AccionEnergia {
  claseCss: string
  icono: string
  etiqueta: string
  comando: string
}

export const ACCIONES_ENERGIA: readonly AccionEnergia[] = [
  { claseCss: "lock", icono: "󰌾", etiqueta: "Bloquear", comando: "hyprlock" },
  // Forma Lua del dispatcher (bajo config Lua la sintaxis legacy `dispatch exit`
  // no existe). Las comillas sobreviven: execAsync con string parsea con
  // GLib.shell_parse_argv, así que llega como un solo argumento.
  { claseCss: "logout", icono: "󰍃", etiqueta: "Salir", comando: 'hyprctl dispatch "hl.dsp.exit()"' },
  { claseCss: "suspend", icono: "󰏤", etiqueta: "Suspender", comando: "systemctl suspend" },
  { claseCss: "shutdown", icono: "󰐥", etiqueta: "Apagar", comando: "systemctl poweroff" },
  { claseCss: "hibernate", icono: "󰒲", etiqueta: "Hibernar", comando: "systemctl hibernate" },
  { claseCss: "reboot", icono: "󰜉", etiqueta: "Reiniciar", comando: "systemctl reboot" },
]
