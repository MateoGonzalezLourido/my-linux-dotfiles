export interface AccionEnergia {
  claseCss: string
  icono: string
  etiqueta: string
  comando: string
}

export const ACCIONES_ENERGIA: readonly AccionEnergia[] = [
  { claseCss: "lock", icono: "󰌾", etiqueta: "Bloquear", comando: "hyprlock" },
  { claseCss: "logout", icono: "󰍃", etiqueta: "Salir", comando: "hyprctl dispatch exit" },
  { claseCss: "suspend", icono: "󰏤", etiqueta: "Suspender", comando: "systemctl suspend" },
  { claseCss: "shutdown", icono: "󰐥", etiqueta: "Apagar", comando: "systemctl poweroff" },
  { claseCss: "hibernate", icono: "󰒲", etiqueta: "Hibernar", comando: "systemctl hibernate" },
  { claseCss: "reboot", icono: "󰜉", etiqueta: "Reiniciar", comando: "systemctl reboot" },
]
