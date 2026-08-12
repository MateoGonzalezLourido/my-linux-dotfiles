import { createState } from "ags"
import { Gtk } from "ags/gtk4"
import { AjusteInterruptor, TarjetaAjustes, TextoInformativo } from "../componentes"
import FilaInactividad from "./FilaInactividad"
import { guardarInactividadGeneral, leerInactividadGeneral } from "../../../servicios/pantalla/inactividadAhorro"
import textos from "../../../textos/ajustes/pantalla.json" with { type: "json" }

/**
 * Tiempos de inactividad GENERALES. No escribe en hypridle.conf directamente: pasa por
 * `guardarInactividadGeneral`, que desvía la escritura al apunte mientras el modo ahorro
 * tiene sus propios tiempos puestos — si no, la restauración del final del ahorro borraría
 * lo que se acabara de editar aquí. Por lo mismo lee con `leerInactividadGeneral`, que con
 * el override puesto devuelve los valores de siempre y no los del ahorro.
 * Ver `servicios/pantalla/inactividadAhorro.ts`.
 */
export default function Inactividad() {
  const configuracion = leerInactividadGeneral() || {
    dpms: { timeout: 600, enabled: true },
    lock: { timeout: 630, enabled: true },
    suspend: { timeout: 660, enabled: true },
    bloqueoAlSuspender: true,
  }
  const aMinutos = (segundos: number) => Math.max(1, Math.round(segundos / 60))
  const [minutosDpms, fijarMinutosDpms] = createState(aMinutos(configuracion.dpms.timeout))
  const [minutosBloqueo, fijarMinutosBloqueo] = createState(aMinutos(configuracion.lock.timeout))
  const [minutosSuspension, fijarMinutosSuspension] = createState(aMinutos(configuracion.suspend.timeout))
  const [dpmsActivo, fijarDpmsActivo] = createState(configuracion.dpms.enabled)
  const [bloqueoActivo, fijarBloqueoActivo] = createState(configuracion.lock.enabled)
  const [suspensionActiva, fijarSuspensionActiva] = createState(configuracion.suspend.enabled)
  const [bloquearAlSuspender, fijarBloquearAlSuspender] = createState(configuracion.bloqueoAlSuspender)
  const guardar = () => guardarInactividadGeneral({
    dpms: { timeout: minutosDpms.get() * 60, enabled: dpmsActivo.get() },
    lock: { timeout: minutosBloqueo.get() * 60, enabled: bloqueoActivo.get() },
    suspend: { timeout: minutosSuspension.get() * 60, enabled: suspensionActiva.get() },
  }, bloquearAlSuspender.get())

  return (
    <TarjetaAjustes titulo={textos.suspension.titulo} icono="󰒲">
      <box cssClasses={["dev-row"]}>
        <TextoInformativo label={textos.suspension.descripcion} halign={Gtk.Align.START} wrap maxWidthChars={62} xalign={0} />
      </box>
      <FilaInactividad etiqueta={textos.suspension.apagarPantalla} minutos={minutosDpms} fijarMinutos={fijarMinutosDpms} activo={dpmsActivo} fijarActivo={fijarDpmsActivo} guardar={guardar} />
      <FilaInactividad etiqueta={textos.suspension.bloquear} minutos={minutosBloqueo} fijarMinutos={fijarMinutosBloqueo} activo={bloqueoActivo} fijarActivo={fijarBloqueoActivo} guardar={guardar} />
      <FilaInactividad etiqueta={textos.suspension.suspender} minutos={minutosSuspension} fijarMinutos={fijarMinutosSuspension} activo={suspensionActiva} fijarActivo={fijarSuspensionActiva} guardar={guardar} />
      <AjusteInterruptor
        titulo={textos.suspension.bloquearAlSuspender.titulo}
        informacion={textos.suspension.bloquearAlSuspender.descripcion}
        activo={bloquearAlSuspender}
        alAlternar={() => { fijarBloquearAlSuspender(!bloquearAlSuspender.get()); guardar() }}
      />
    </TarjetaAjustes>
  )
}
