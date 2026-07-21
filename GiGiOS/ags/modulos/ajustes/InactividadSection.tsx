import { createState, type Accessor } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import Interruptor from "../../componentes/Interruptor"
import { TarjetaAjustes, TextoInformativo, TituloAjuste } from "./componentes"
import { parseHypridle, writeHypridle, type HypridleConfig, type ListenerKind } from "../../servicios/pantalla/hypridle"
import textos from "../../textos/ajustes/pantalla.json" with { type: "json" }

const ARCHIVO_HYPRIDLE = `${GLib.get_user_config_dir()}/hypr/hypridle.conf`

function leerHypridle(): HypridleConfig | null {
  try {
    const [ok, contenido] = GLib.file_get_contents(ARCHIVO_HYPRIDLE)
    if (ok) return parseHypridle(new TextDecoder().decode(contenido))
  } catch (_) { /* la sección conserva valores seguros si no puede leer el archivo */ }
  return null
}

function guardarHypridle(valores: Partial<Record<ListenerKind, { timeout: number; enabled: boolean }>>) {
  try {
    const [ok, contenido] = GLib.file_get_contents(ARCHIVO_HYPRIDLE)
    if (!ok) return
    const salida = writeHypridle(new TextDecoder().decode(contenido), valores)
    GLib.file_set_contents(ARCHIVO_HYPRIDLE, salida)
    execAsync(["bash", "-c", "pkill hypridle; hypridle &"]).catch(() => {})
  } catch (_) { /* un fallo de hypridle no debe cerrar el shell */ }
}

function SelectorMinutos({ valor, alCambiar }: { valor: Accessor<number>, alCambiar: (minutos: number) => void }) {
  return (
    <box spacing={6} valign={Gtk.Align.CENTER}>
      <button cssClasses={["sp-step-btn"]} onClicked={() => alCambiar(Math.max(1, valor.get() - 1))}><label label="−" /></button>
      <label cssClasses={["sp-step-val"]} label={valor((minutos: number) => `${minutos} min`)} />
      <button cssClasses={["sp-step-btn"]} onClicked={() => alCambiar(valor.get() + 1)}><label label="+" /></button>
    </box>
  )
}

function FilaInactividad({ etiqueta, minutos, fijarMinutos, activo, fijarActivo, guardar }: {
  etiqueta: string
  minutos: Accessor<number>
  fijarMinutos: (valor: number) => void
  activo: Accessor<boolean>
  fijarActivo: (valor: boolean) => void
  guardar: () => void
}) {
  return (
    <box cssClasses={["dev-row"]} spacing={8} valign={Gtk.Align.CENTER}>
      <TituloAjuste label={etiqueta} hexpand halign={Gtk.Align.START} />
      <label cssClasses={["sp-step-val", "off"]} label={textos.suspension.nunca} visible={activo((valor) => !valor)} />
      <box visible={activo}>
        <SelectorMinutos valor={minutos} alCambiar={(valor) => { fijarMinutos(valor); guardar() }} />
      </box>
      <Interruptor activo={activo} alAlternar={() => { fijarActivo(!activo.get()); guardar() }} />
    </box>
  )
}

export default function InactividadSection() {
  const configuracion = leerHypridle() || {
    dpms: { timeout: 600, enabled: true },
    lock: { timeout: 630, enabled: true },
    suspend: { timeout: 660, enabled: true },
  }
  const aMinutos = (segundos: number) => Math.max(1, Math.round(segundos / 60))
  const [minutosDpms, fijarMinutosDpms] = createState(aMinutos(configuracion.dpms.timeout))
  const [minutosBloqueo, fijarMinutosBloqueo] = createState(aMinutos(configuracion.lock.timeout))
  const [minutosSuspension, fijarMinutosSuspension] = createState(aMinutos(configuracion.suspend.timeout))
  const [dpmsActivo, fijarDpmsActivo] = createState(configuracion.dpms.enabled)
  const [bloqueoActivo, fijarBloqueoActivo] = createState(configuracion.lock.enabled)
  const [suspensionActiva, fijarSuspensionActiva] = createState(configuracion.suspend.enabled)
  const guardar = () => guardarHypridle({
    dpms: { timeout: minutosDpms.get() * 60, enabled: dpmsActivo.get() },
    lock: { timeout: minutosBloqueo.get() * 60, enabled: bloqueoActivo.get() },
    suspend: { timeout: minutosSuspension.get() * 60, enabled: suspensionActiva.get() },
  })

  return (
    <TarjetaAjustes titulo={textos.suspension.titulo} icono="󰒲">
      <box cssClasses={["dev-row"]}>
        <TextoInformativo label={textos.suspension.descripcion} halign={Gtk.Align.START} wrap maxWidthChars={62} xalign={0} />
      </box>
      <FilaInactividad etiqueta={textos.suspension.apagarPantalla} minutos={minutosDpms} fijarMinutos={fijarMinutosDpms} activo={dpmsActivo} fijarActivo={fijarDpmsActivo} guardar={guardar} />
      <FilaInactividad etiqueta={textos.suspension.bloquear} minutos={minutosBloqueo} fijarMinutos={fijarMinutosBloqueo} activo={bloqueoActivo} fijarActivo={fijarBloqueoActivo} guardar={guardar} />
      <FilaInactividad etiqueta={textos.suspension.suspender} minutos={minutosSuspension} fijarMinutos={fijarMinutosSuspension} activo={suspensionActiva} fijarActivo={fijarSuspensionActiva} guardar={guardar} />
    </TarjetaAjustes>
  )
}
