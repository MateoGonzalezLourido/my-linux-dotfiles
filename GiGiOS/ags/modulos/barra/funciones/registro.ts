import { createComputed, type Accessor } from "ags"
import {
  fijarMantenerDespiertoActivo,
  mantenerDespiertoActivo,
  tiempoRestanteMantenerDespierto,
} from "../../../servicios/energia/mantenerDespierto"
import { textoChipMantenerDespierto } from "../../../servicios/energia/tiempoMantenerDespierto"
import OpcionesMantenerDespierto from "./OpcionesMantenerDespierto"
import { cpuRamHabilitado, fijarCpuRamHabilitado } from "./estado"

export type EstadoReactivo<T> = Accessor<T>

export type FuncionBarra = {
  etiqueta: string
  habilitada: EstadoReactivo<boolean>
  alternar: (activa: boolean) => void
  /** Texto del chip derecho. Si falta, la fila enseña ON/OFF. */
  estado?: EstadoReactivo<string>
  /** Contenido desplegable bajo la fila mientras la función está encendida. */
  expandir?: () => any
}

const chipMantenerDespierto = createComputed(
  [mantenerDespiertoActivo, tiempoRestanteMantenerDespierto],
  (activo: boolean, restante: number | null) =>
    textoChipMantenerDespierto(activo, restante),
)

/** Registro de funciones visibles en el menú de la barra. */
export const FUNCIONES_BARRA: FuncionBarra[] = [
  {
    etiqueta: "CPU / RAM",
    habilitada: cpuRamHabilitado,
    alternar: fijarCpuRamHabilitado,
  },
  {
    etiqueta: "Wake up",
    habilitada: mantenerDespiertoActivo,
    alternar: fijarMantenerDespiertoActivo,
    estado: chipMantenerDespierto,
    expandir: OpcionesMantenerDespierto,
  },
]
