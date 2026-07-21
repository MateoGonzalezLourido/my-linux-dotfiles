import { createState, createComputed, type Accessor } from "ags"
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
// y añade una entrada a BAR_FUNCTIONS. El menú se dibuja iterando ese array, así
// que no hay que tocar la UI.
//
// Dos extras opcionales por función (los usa Wake up):
//   estado → texto del chip de la derecha en vez del ON/OFF de serie.
//   expandir → widget desplegado bajo la fila mientras la función está encendida.

// CPU / RAM: desactivada por defecto. Al desactivarse, Bar.tsx desmonta <CpuRam/>
// mediante una ranura condicional, con lo que su fuente deja de tener consumidores.
export const [cpuRamEnabled, setCpuRamEnabled] = createState(false)

// Interfaz mínima de un accessor reactivo (misma convención que PanelState en
// state.tsx): evita depender del tipo Accessor de gnim.
export type EstadoReactivo<T> = Accessor<T>

export type FuncionBarra = {
  etiqueta: string
  habilitada: EstadoReactivo<boolean>
  alternar: (activa: boolean) => void
  /** Texto del chip derecho. Si falta, la fila enseña ON/OFF. */
  estado?: EstadoReactivo<string>
  /** Contenido desplegable bajo la fila, visible solo con la función encendida. */
  expandir?: () => any
}

// Chip del Wake up: la cuenta atrás ("29:58"), ∞ si no tiene plazo, OFF si está
// apagado. Sale de la lógica pura de wakeupTime.ts (testeada con node).
const chipWakeUp = createComputed(
  [wakeUpActive, wakeUpRemaining],
  (active: boolean, remaining: number | null) => chipText(active, remaining),
)

export const BAR_FUNCTIONS: FuncionBarra[] = [
  {
    etiqueta: "CPU / RAM",
    habilitada: cpuRamEnabled,
    alternar: (activa) => setCpuRamEnabled(activa),
  },
  {
    etiqueta: "Wake up",
    habilitada: wakeUpActive,
    alternar: (activa) => setWakeUpActive(activa),
    estado: chipWakeUp,
    // Referencia al componente, no JSX: este módulo es .ts. Lo instancia Functions.tsx.
    expandir: WakeUpOptions,
  },
]
