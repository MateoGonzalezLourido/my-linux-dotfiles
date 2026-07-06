import { createState } from "ags"

// Estado de las "funciones" del bar (menú del logo Arch).
//
// Vive SOLO en RAM a propósito: las funciones se activan por sesión y al reiniciar
// el sistema vuelven a su valor por defecto. No se persiste en
// config/system_state.json (eso es para ajustes que deben sobrevivir a reinicios).
//
// Para añadir una función nueva: crea su createState (default = valor de arranque)
// y añade una entrada a BAR_FUNCTIONS. El popover se dibuja iterando ese array, así
// que no hay que tocar la UI.

// CPU / RAM: desactivada por defecto. Al desactivarse, Bar.tsx desmonta <CpuRam/>
// (via <With>), con lo que su polling y sus procesos `ps` dejan de existir.
export const [cpuRamEnabled, setCpuRamEnabled] = createState(false)

// Interfaz mínima de un accessor reactivo (misma convención que PanelState en
// state.tsx): evita depender del tipo Accessor de gnim.
type ToggleState = { get: () => boolean; subscribe: (cb: (v: boolean) => void) => unknown }

export type BarFunction = {
  id: string
  label: string
  icon: string
  enabled: ToggleState
  toggle: (on: boolean) => void
}

export const BAR_FUNCTIONS: BarFunction[] = [
  {
    id: "cpuram",
    label: "CPU / RAM",
    icon: "󰻠",
    enabled: cpuRamEnabled,
    toggle: (on) => setCpuRamEnabled(on),
  },
]
