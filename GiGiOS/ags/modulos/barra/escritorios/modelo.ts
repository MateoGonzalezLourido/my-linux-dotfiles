import type Gio from "gi://Gio"

/** Forma estructural de AstalHyprland.Client usada por los escritorios. Los nombres de
 * propiedades ingleses pertenecen a la API externa y se conservan como contrato. */
export interface ClienteEscritorio {
  address: string
  class?: string | null
  initialClass?: string | null
  initial_class?: string | null
  title?: string | null
  pid?: number | null
  x?: number | null
  y?: number | null
  workspace?: { id: number } | null
  get_workspace?: () => { id: number } | null
}

export interface IconoClienteEscritorio {
  icono: string
  iconoGio: Gio.Icon | null
  direccion: string
  claseAplicacion: string
  esGlifo: boolean
  descripcion: string
}

export interface EscritorioVisible {
  id: number
  enfocar: () => void
  clientes: IconoClienteEscritorio[]
}

export function claseAplicacionCssSegura(claseAplicacion: string): string {
  return claseAplicacion.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app"
}
