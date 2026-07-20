import Interruptor from "../../Interruptor"
import FilaAjuste from "./FilaAjuste"

type PropiedadesAjusteInterruptor = {
  titulo: any
  informacion?: any
  activo: any
  alAlternar: () => void
  visible?: any
}

/** Fila reutilizable para una preferencia booleana dentro de una tarjeta. */
export default function AjusteInterruptor({
  titulo,
  informacion,
  activo,
  alAlternar,
  visible,
}: PropiedadesAjusteInterruptor) {
  return (
    <FilaAjuste titulo={titulo} informacion={informacion} visible={visible}>
      <Interruptor activo={activo} alAlternar={alAlternar} />
    </FilaAjuste>
  )
}
