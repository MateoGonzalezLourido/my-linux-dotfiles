import { Gtk } from "ags/gtk4"
import { createComputed, createMemo, createState, type Accessor } from "ags"
import GLib from "gi://GLib"
import { DisplaySelect } from "../../../servicios/pantalla/controls"
import {
  nightRules,
  nightRulesEnabled,
  setNightRulesAndSave,
} from "../../../servicios/pantalla/service"
import { activeRuleFor, type NightRule } from "../../../servicios/pantalla/schedule"
import { brightnessSupported } from "../../../servicios/pantalla/brightness"
import { TextoInformativo } from "../componentes"
import textos from "../../../textos/ajustes/pantalla.json" with { type: "json" }
import { formatearTexto } from "../../../textos/formatear.ts"
import CampoNumerico from "./CampoNumerico.tsx"

export const TEMPERATURA_REGLA_PREDETERMINADA = 3500
const BRILLO_REGLA_PREDETERMINADO = 60

const horaActual = () => {
  const fecha = GLib.DateTime.new_now_local()
  return { h: fecha.get_hour(), m: fecha.get_minute() }
}

const [horaHorario, establecerHoraHorario] = createState(horaActual())
export { horaHorario }
let idReloj: number | null = null
let referenciasReloj = 0

export function adquirirRelojHorario(): void {
  referenciasReloj++
  establecerHoraHorario(horaActual())
  if (idReloj !== null) return
  idReloj = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
    establecerHoraHorario(horaActual())
    return GLib.SOURCE_CONTINUE
  })
}

export function liberarRelojHorario(): void {
  referenciasReloj = Math.max(0, referenciasReloj - 1)
  if (referenciasReloj > 0 || idReloj === null) return
  GLib.source_remove(idReloj)
  idReloj = null
}

const MODOS_LUZ = [
  { label: textos.reglas.modos.noCambiar, value: "keep" },
  { label: textos.reglas.modos.encenderA, value: "on" },
]
const MODOS_BRILLO = [
  { label: textos.reglas.modos.noCambiar, value: "keep" },
  { label: textos.reglas.modos.fijarEn, value: "set" },
]

const CLAVE_REGLA = Symbol("clave-regla")
let siguienteClaveRegla = 1

/** Mantiene la identidad del widget al reemplazar inmutablemente una regla. */
export function claveReglaHorario(regla: NightRule): number {
  const registro = regla as unknown as Record<symbol, number>
  if (!registro[CLAVE_REGLA]) registro[CLAVE_REGLA] = siguienteClaveRegla++
  return registro[CLAVE_REGLA]
}

export default function FilaReglaHorario({
  regla,
  indice,
}: {
  regla: NightRule
  indice: Accessor<number>
}) {
  const actual = createComputed(() => nightRules()[indice()] ?? regla)

  const actualizar = (cambios: Partial<NightRule>) => {
    const posicion = indice.get()
    const reglas = nightRules.get().slice()
    if (!reglas[posicion]) return
    reglas[posicion] = { ...reglas[posicion], ...cambios }
    setNightRulesAndSave(reglas)
  }
  const establecerParteHora = (campo: "start" | "end", parte: 0 | 1, valor: number) => {
    const reglaActual = nightRules.get()[indice.get()]
    if (!reglaActual) return
    const partes = reglaActual[campo].split(":")
    partes[parte] = String(valor).padStart(2, "0")
    actualizar({ [campo]: `${partes[0]}:${partes[1]}` } as Partial<NightRule>)
  }
  const borrar = () => setNightRulesAndSave(
    nightRules.get().filter((_, posicion) => posicion !== indice.get()),
  )

  const memorizar = <T,>(obtener: (regla: NightRule) => T) =>
    createMemo(() => obtener(actual()))
  const horaInicio = memorizar((valor) => Number(valor.start.split(":")[0]))
  const minutoInicio = memorizar((valor) => Number(valor.start.split(":")[1]))
  const horaFin = memorizar((valor) => Number(valor.end.split(":")[0]))
  const minutoFin = memorizar((valor) => Number(valor.end.split(":")[1]))
  const modoLuz = memorizar((valor) => valor.temp == null || valor.temp <= 0 ? "keep" : "on")
  const modoBrillo = memorizar((valor) => valor.brightness == null ? "keep" : "set")
  const temperatura = memorizar((valor) =>
    valor.temp && valor.temp > 0 ? valor.temp : TEMPERATURA_REGLA_PREDETERMINADA)
  const brillo = memorizar((valor) => valor.brightness ?? BRILLO_REGLA_PREDETERMINADO)

  const canalesActivos = createComputed(() => {
    if (!nightRulesEnabled()) return [] as string[]
    const hora = horaHorario()
    const reglas = nightRules()
    const estaRegla = reglas[indice()]
    if (!estaRegla) return [] as string[]
    const canales: string[] = []
    if (activeRuleFor(hora, reglas, "temp") === estaRegla) {
      canales.push(textos.reglas.canales.luzNocturnaBreve)
    }
    if (activeRuleFor(hora, reglas, "brightness") === estaRegla) {
      canales.push(textos.reglas.canales.brilloBreve)
    }
    return canales
  })

  const selectorModo = (
    modos: typeof MODOS_LUZ,
    valor: Accessor<string>,
    alSeleccionar: (modo: string) => void,
  ) => (
    <box
      cssClasses={["sp-rule-select"]}
      valign={Gtk.Align.CENTER}
      hexpand={false}
      halign={Gtk.Align.START}
    >
      <DisplaySelect
        current={valor((actual) => modos.find((modo) => modo.value === actual)!.label)}
        options={valor((actual) => modos.map((modo) => ({
          label: modo.label,
          value: modo.value,
          active: modo.value === actual,
        })))}
        onSelect={alSeleccionar}
      />
    </box>
  )

  return (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      cssClasses={canalesActivos((canales) =>
        canales.length ? ["sp-rule-card", "active"] : ["sp-rule-card"])}
    >
      <box spacing={5} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]}>
        <label cssClasses={["sp-rule-chan", "narrow"]} label={textos.reglas.horario.desde} halign={Gtk.Align.START} />
        <CampoNumerico valor={horaInicio} minimo={0} maximo={23} alConfirmar={(valor) => establecerParteHora("start", 0, valor)} />
        <TextoInformativo label=":" />
        <CampoNumerico valor={minutoInicio} minimo={0} maximo={59} alConfirmar={(valor) => establecerParteHora("start", 1, valor)} />
        <TextoInformativo label={textos.reglas.horario.hasta} />
        <CampoNumerico valor={horaFin} minimo={0} maximo={23} alConfirmar={(valor) => establecerParteHora("end", 0, valor)} />
        <TextoInformativo label=":" />
        <CampoNumerico valor={minutoFin} minimo={0} maximo={59} alConfirmar={(valor) => establecerParteHora("end", 1, valor)} />
        <label
          cssClasses={["sp-rule-active-chip"]}
          label={textos.reglas.horario.vigente}
          visible={canalesActivos((canales) => canales.length > 0)}
          tooltipText={canalesActivos((canales) => formatearTexto(
            textos.reglas.horario.tooltipVigente,
            { canales: canales.join(" · ") },
          ))}
          valign={Gtk.Align.CENTER}
        />
        <box hexpand />
        <button cssClasses={["sp-rule-del"]} onClicked={borrar} valign={Gtk.Align.CENTER} tooltipText={textos.reglas.acciones.borrar}>
          <label label="󰅖" />
        </button>
      </box>

      <box spacing={6} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]}>
        <label cssClasses={["sp-rule-chan"]} label={textos.reglas.canales.luzNocturna} halign={Gtk.Align.START} />
        {selectorModo(MODOS_LUZ, modoLuz, (modo) =>
          actualizar({ temp: modo === "keep" ? null : temperatura.get() }))}
        <box spacing={4} valign={Gtk.Align.CENTER} visible={modoLuz((modo) => modo === "on")}>
          <CampoNumerico valor={temperatura} minimo={1000} maximo={6500} caracteres={4} relleno={0} alConfirmar={(valor) => actualizar({ temp: valor })} />
          <TextoInformativo label="K" />
        </box>
      </box>

      <box spacing={6} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]} visible={brightnessSupported}>
        <label cssClasses={["sp-rule-chan"]} label={textos.reglas.canales.brillo} halign={Gtk.Align.START} />
        {selectorModo(MODOS_BRILLO, modoBrillo, (modo) =>
          actualizar({ brightness: modo === "keep" ? null : brillo.get() }))}
        <box spacing={4} valign={Gtk.Align.CENTER} visible={modoBrillo((modo) => modo === "set")}>
          <CampoNumerico valor={brillo} minimo={1} maximo={100} caracteres={3} relleno={0} alConfirmar={(valor) => actualizar({ brightness: valor })} />
          <TextoInformativo label="%" />
        </box>
      </box>
    </box>
  )
}
