import { createState, createComputed } from "ags"
import { wakeUpActive, wakeUpRemaining, setWakeUpActive } from "./wakeup"
import { chipText } from "./wakeupTime"
import WakeUpOptions from "./WakeUpOptions"

// Estado de las "funciones" del bar (menú del logo Arch).
//
// Vive SOLO en RAM a propósito: las funciones se activan por sesión y al reiniciar
// el sistema vuelven a su valor por defecto. No se persiste en
// config/system_state.json (eso es para ajustes que deben sobrevivir a reinicios).
//
// Para añadir una función nueva: crea su createState (default = valor de arranque)
// y añade una entrada a BAR_FUNCTIONS. El popover se dibuja iterando ese array, así
// que no hay que tocar la UI.
//
// Dos extras opcionales por función (los usa Wake up, ver Functions.tsx):
//   status → texto del chip de la derecha en vez del ON/OFF de serie.
//   expand → widget que se despliega bajo la fila mientras la función está encendida.

// CPU / RAM: desactivada por defecto. Al desactivarse, Bar.tsx desmonta <CpuRam/>
// (via <With>), con lo que su polling y sus procesos `ps` dejan de existir.
export const [cpuRamEnabled, setCpuRamEnabled] = createState(false)

// Interfaz mínima de un accessor reactivo (misma convención que PanelState en
// state.tsx): evita depender del tipo Accessor de gnim.
type Reactive<T> = { get: () => T; subscribe: (cb: (v: T) => void) => unknown }
type ToggleState = Reactive<boolean>

export type BarFunction = {
  id: string
  label: string
  icon: string
  enabled: ToggleState
  toggle: (on: boolean) => void
  /** Texto del chip derecho. Si falta, la fila enseña ON/OFF. */
  status?: Reactive<string>
  /** Contenido desplegable bajo la fila, visible solo con la función encendida. */
  expand?: () => any
}

// Chip del Wake up: la cuenta atrás ("29:58"), ∞ si no tiene plazo, OFF si está
// apagado. Sale de la lógica pura de wakeupTime.ts (testeada con node).
const wakeUpChip = createComputed(
  [wakeUpActive, wakeUpRemaining],
  (active: boolean, remaining: number | null) => chipText(active, remaining),
)

export const BAR_FUNCTIONS: BarFunction[] = [
  {
    id: "cpuram",
    label: "CPU / RAM",
    icon: "󰻠",
    enabled: cpuRamEnabled,
    toggle: (on) => setCpuRamEnabled(on),
  },
  {
    id: "wakeup",
    label: "Wake up",
    icon: "󰅶",
    enabled: wakeUpActive,
    toggle: (on) => setWakeUpActive(on),
    status: wakeUpChip,
    // Referencia al componente, no JSX: este módulo es .ts. Lo instancia Functions.tsx.
    expand: WakeUpOptions,
  },
]
