// widget/settings/DisplaySection.tsx
// Sección "Pantalla" del panel de Ajustes: TODOS los ajustes de pantalla
// (copiados de QuickSettings + avanzados) sobre el service compartido
// (widget/display/service.ts). Patrón visual sp-section/sp-field como
// PersonalizationSection.
import { Gtk } from "ags/gtk4"
import { createState, createComputed, createMemo, For, onCleanup, Accessor } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { DisplaySelect } from "../display/controls"
import { conectarCambioDeslizador } from "../deslizador"
import Interruptor from "../Interruptor"
import { TextoInformativo, TituloAjuste, TituloSeccion, TituloSubseccion } from "./componentes"
import {
  monitors, monitorPrefs, monitorCaps, applyPatch, acquirePoll, releasePoll,
  globalVrrMode, applyGlobalVrr, allowTearing, applyAllowTearing,
  nightRules, setNightRulesAndSave, nightRulesEnabled, setNightRulesEnabled,
  setNightLightManual, setManualTemp, saveDisplayConfig,
} from "../display/service"
import type { NightRule } from "../display/schedule"
import { activeRuleFor, activeSetpoint } from "../display/schedule"
import {
  resolutionOptions, refreshOptions, matchScalePreset, SCALE_PRESETS,
  TRANSFORMS, CM_MODES, computeRelativePosition,
} from "../display/modes"
import { parseHypridle, writeHypridle } from "../display/hypridle"
import type { HypridleConfig, ListenerKind } from "../display/hypridle"
import {
  settingsPanelVisible,
  brightness,
  nightLightActive, nightLightTemp,
} from "../state"
import { applyBrightness, brightnessSupported } from "../display/brightness"

const HYPRIDLE_FILE = `${GLib.get_user_config_dir()}/hypr/hypridle.conf`

function readHypridle(): HypridleConfig | null {
  try {
    const [ok, content] = GLib.file_get_contents(HYPRIDLE_FILE)
    if (ok) return parseHypridle(new TextDecoder().decode(content))
  } catch (e) { /* */ }
  return null
}

function saveHypridle(values: Partial<Record<ListenerKind, { timeout: number; enabled: boolean }>>) {
  try {
    const [ok, content] = GLib.file_get_contents(HYPRIDLE_FILE)
    if (!ok) return
    const out = writeHypridle(new TextDecoder().decode(content), values)
    GLib.file_set_contents(HYPRIDLE_FILE, out)
    execAsync(["bash", "-c", "pkill hypridle; hypridle &"]).catch(() => {})
  } catch (e) { /* */ }
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

function makeScale(classes: string[], getValue: () => number, setValue: (v: number) => void, subscribe?: (cb: () => void) => void): Gtk.Scale {
  const adj = new Gtk.Adjustment({ lower: 0, upper: 1, stepIncrement: 0.01 })
  adj.value = clamp(getValue())
  if (subscribe) subscribe(() => { adj.value = clamp(getValue()) })
  const scale = new Gtk.Scale({ orientation: Gtk.Orientation.HORIZONTAL, adjustment: adj, drawValue: false, hexpand: true, valign: Gtk.Align.CENTER })
  scale.cssClasses = classes
  conectarCambioDeslizador(scale, (val) => setValue(clamp(val)))
  return scale
}

// Input numérico que se escribe a mano. Valida y acota [min, max] al pulsar Enter
// o al salir del campo; reescribe con `pad` dígitos.
//
// `value` es REACTIVO, y tiene que serlo: la fila ya no se reconstruye al editar (ver
// `ruleKey`), así que un cambio que no venga de teclear aquí no se vería nunca. Pasa de
// verdad: pon la temp en 4000, cambia el canal a "No cambiar" y vuelve a "Encender a" — la
// regla vuelve al valor por defecto (3500, porque `temp` ya era null) y sin esto el campo
// seguiría enseñando 4000, o sea que la UI mentiría sobre lo que hace la franja (medido con
// un A/B, no supuesto). El texto NO se pisa mientras el campo tiene el foco: ahí estás
// escribiendo tú, y manda lo tecleado hasta que `commit` lo valide.
function NumberField({ value, min, max, chars = 2, pad = 2, onCommit }: {
  value: Accessor<number>, min: number, max: number, chars?: number, pad?: number, onCommit: (n: number) => void,
}) {
  let ref: Gtk.Entry
  const render = (n: number) => String(n).padStart(pad, "0")
  const commit = () => {
    if (!ref) return
    const raw = parseInt(ref.get_text().trim(), 10)
    const v = isNaN(raw) ? min : Math.max(min, Math.min(max, raw))
    ref.set_text(render(v))
    onCommit(v)
  }
  return (
    <entry
      cssClasses={["sp-num-input"]}
      maxLength={chars}
      widthChars={chars}
      xalign={0.5}
      $={(self: Gtk.Entry) => {
        ref = self
        self.set_text(render(value.get()))
        onCleanup(value.subscribe(() => {
          if (!self.has_focus) self.set_text(render(value.get()))
        }))
      }}
      onActivate={commit}
    >
      <Gtk.EventControllerFocus onLeave={commit} />
    </entry>
  )
}

const DEFAULT_RULE_TEMP = 3500
const DEFAULT_RULE_BRIGHTNESS = 60

// Reloj compartido de la sección: sin él, "vigente ahora" solo sería cierto en el instante
// en que se abrió el panel. Ref-contado y solo vivo mientras haya una sección montada (el
// panel se construye por monitor y `<With>` lo levanta y lo tira en cada apertura).
const hmNow = () => { const d = GLib.DateTime.new_now_local(); return { h: d.get_hour(), m: d.get_minute() } }
const [scheduleNow, setScheduleNow] = createState(hmNow())
let clockId: number | null = null
let clockRefs = 0
function acquireClock() {
  clockRefs++
  setScheduleNow(hmNow())
  if (clockId === null) {
    clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => { setScheduleNow(hmNow()); return GLib.SOURCE_CONTINUE })
  }
}
function releaseClock() {
  clockRefs = Math.max(0, clockRefs - 1)
  if (clockRefs === 0 && clockId !== null) { GLib.source_remove(clockId); clockId = null }
}

// Los dos canales de una regla, cada uno con su "No cambiar" (= la franja no lo toca).
// La luz nocturna no necesita un "Apagar": fuera de la franja ya vuelve sola al manual.
const NIGHT_MODES = [
  { label: "No cambiar", value: "keep" },
  { label: "Encender a", value: "on" },
]
const BRIGHT_MODES = [
  { label: "No cambiar", value: "keep" },
  { label: "Fijar en", value: "set" },
]

// Identidad estable de una regla, para el `id` de `<For>`. NO es cosmética: sin ella
// **editar una franja mataba todo AGS**, y de la peor manera posible.
//
// Editar REEMPLAZA el objeto de la regla (`patch` hace `{...rule, ...cambio}`, porque el
// estado es inmutable) y `<For>` indexa por identidad de objeto: objeto nuevo = clave
// nueva = tira la fila y construye otra. O sea que cada edición destruía **el editor que
// estabas usando**. Con `commit` colgando del `leave` de un campo (que es como se edita de
// verdad: tecleas la hora y pasas al minuto), eso destruía el `Gtk.Entry` que tenía el foco
// DESDE DENTRO de su propio handler de foco, con GTK a mitad del cambio: el método de
// entrada de Wayland se quedaba apuntando al widget ya liberado y el siguiente evento
// reventaba en `wl_proxy_get_version` (SIGSEGV, se cae el shell entero).
//
// El crash es una CARRERA con el evento de text-input del compositor, así que no era
// determinista y por eso parecía caprichoso: medido sobre el código viejo, salir del campo
// petaba 2 de cada 3 veces y pulsar Enter 1 de cada 3 — menos, pero petaba. No busques una
// ruta "segura": la destrucción de la fila al editar es el fallo, y la cura es no destruirla.
//
// La clave va en un `Symbol` a propósito: el spread de `patch` lo copia (la fila sobrevive
// a la edición, que es justo lo que hace falta) pero `JSON.stringify` lo ignora, así que no
// se cuela en `display.json` ni obliga a tocar la lógica pura de `schedule.ts`. Es identidad
// de sesión: al recargar se reparte de nuevo, y no hace falta que sea estable en disco.
const RULE_KEY = Symbol("rule-key")
let nextRuleKey = 1
function ruleKey(rule: NightRule): number {
  const r = rule as unknown as Record<symbol, number>
  if (!r[RULE_KEY]) r[RULE_KEY] = nextRuleKey++
  return r[RULE_KEY]
}

// Tarjeta de una regla: la FRANJA (de HH:MM a HH:MM) y, debajo, sus DOS canales
// independientes (luz nocturna y brillo). Cada canal puede quedarse en "No cambiar", así
// que una regla puede tocar solo uno, solo el otro o los dos — y fuera de la franja no
// toca nada.
//
// La fila SOBREVIVE a sus propias ediciones (ver `ruleKey`), así que el `rule` que nos pasó
// `<For>` queda obsoleto en cuanto tocas algo: la regla vigente se lee del estado por el
// índice (que `<For>` sí mantiene al día), y todo lo que se enseña cuelga de `cur`. Leerlo
// de `rule` sería leer el pasado.
function RuleRow({ rule, index }: { rule: NightRule, index: any }) {
  const cur = createComputed(() => nightRules()[index()] ?? rule)

  const patch = (p: Partial<NightRule>) => {
    const i = index.get()
    const rules = nightRules.get().slice()
    if (!rules[i]) return
    rules[i] = { ...rules[i], ...p }
    setNightRulesAndSave(rules)
  }
  const setTimePart = (field: "start" | "end", idx: 0 | 1, val: number) => {
    const r = nightRules.get()[index.get()]
    if (!r) return
    const p = r[field].split(":")
    p[idx] = String(val).padStart(2, "0")
    patch({ [field]: `${p[0]}:${p[1]}` } as Partial<NightRule>)
  }
  const remove = () => setNightRulesAndSave(nightRules.get().filter((_, idx) => idx !== index.get()))

  // Los derivados salen por `createMemo`, y NO por `cur((r) => …)`: `createComputed` no
  // compara nada y reemite en CADA cambio de la lista (y `cur` produce un objeto nuevo en
  // cada edición, así que "cambia" siempre). Sin memo, tocar la hora reemitía `nightMode`
  // con el mismo "on" de antes, y eso **reconstruye las opciones del desplegable** — su
  // `<For>` también va por identidad —: destrucción de widgets gratis en cada tecleo, que
  // es justo la clase de churn que traía el crash. `createMemo` solo avisa si el valor
  // cambia de verdad (`Object.is`).
  const memo = <T,>(f: (r: NightRule) => T) => createMemo(() => f(cur()))
  const startH = memo((r) => Number(r.start.split(":")[0]))
  const startM = memo((r) => Number(r.start.split(":")[1]))
  const endH = memo((r) => Number(r.end.split(":")[0]))
  const endM = memo((r) => Number(r.end.split(":")[1]))

  const nightMode = memo((r) => (r.temp == null || r.temp <= 0 ? "keep" : "on"))
  const brightMode = memo((r) => (r.brightness == null ? "keep" : "set"))
  const temp = memo((r) => (r.temp && r.temp > 0 ? r.temp : DEFAULT_RULE_TEMP))
  const bright = memo((r) => r.brightness ?? DEFAULT_RULE_BRIGHTNESS)

  // Canales que ESTA regla rige ahora mismo (dentro de su franja). Se compara por
  // identidad contra el objeto VIVO de la lista (`rules[index()]`), no contra el `rule` que
  // nos pasaron al construir: ese se queda atrás en la primera edición. Es la prueba visible
  // de que la franja empieza y acaba.
  const activeChannels = createComputed(() => {
    if (!nightRulesEnabled()) return [] as string[]
    const t = scheduleNow(), rules = nightRules()
    const self = rules[index()]
    if (!self) return [] as string[]
    const out: string[] = []
    if (activeRuleFor(t, rules, "temp") === self) out.push("luz nocturna")
    if (activeRuleFor(t, rules, "brightness") === self) out.push("brillo")
    return out
  })

  // hexpand={false} explícito: el disparador de DisplaySelect es hexpand y, sin cortarle la
  // propagación aquí, el desplegable se comería toda la fila y mandaría el campo K/% al borde.
  const modeSelect = (modes: typeof NIGHT_MODES, current: Accessor<string>, onSelect: (v: string) => void) => (
    <box cssClasses={["sp-rule-select"]} valign={Gtk.Align.CENTER} hexpand={false} halign={Gtk.Align.START}>
      <DisplaySelect
        current={current((c) => modes.find((x) => x.value === c)!.label)}
        options={current((c) => modes.map((x) => ({ label: x.label, value: x.value, active: x.value === c })))}
        onSelect={onSelect}
      />
    </box>
  )

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={4}
      cssClasses={activeChannels((c) => c.length ? ["sp-rule-card", "active"] : ["sp-rule-card"])}>
      <box spacing={5} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]}>
        <label cssClasses={["sp-rule-chan", "narrow"]} label="de" halign={Gtk.Align.START} />
        <NumberField value={startH} min={0} max={23} onCommit={(v) => setTimePart("start", 0, v)} />
        <TextoInformativo label=":" />
        <NumberField value={startM} min={0} max={59} onCommit={(v) => setTimePart("start", 1, v)} />
        <TextoInformativo label="a" />
        <NumberField value={endH} min={0} max={23} onCommit={(v) => setTimePart("end", 0, v)} />
        <TextoInformativo label=":" />
        <NumberField value={endM} min={0} max={59} onCommit={(v) => setTimePart("end", 1, v)} />
        <label
          cssClasses={["sp-rule-active-chip"]}
          label="vigente"
          visible={activeChannels((c) => c.length > 0)}
          tooltipText={activeChannels((c) => `Rige ahora mismo: ${c.join(" · ")}`)}
          valign={Gtk.Align.CENTER}
        />
        <box hexpand />
        <button cssClasses={["sp-rule-del"]} onClicked={remove} valign={Gtk.Align.CENTER} tooltipText="Borrar regla">
          <label label="󰅖" />
        </button>
      </box>

      <box spacing={6} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]}>
        <label cssClasses={["sp-rule-chan"]} label="Luz nocturna" halign={Gtk.Align.START} />
        {modeSelect(NIGHT_MODES, nightMode, (v) =>
          patch({ temp: v === "keep" ? null : temp.get() }))}
        <box spacing={4} valign={Gtk.Align.CENTER} visible={nightMode((m) => m === "on")}>
          <NumberField value={temp} min={1000} max={6500} chars={4} pad={0} onCommit={(v) => patch({ temp: v })} />
          <TextoInformativo label="K" />
        </box>
      </box>

      {/* Brillo: solo si hay backend (ver `display/brightness.ts`) */}
      <box spacing={6} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]} visible={brightnessSupported}>
        <label cssClasses={["sp-rule-chan"]} label="Brillo" halign={Gtk.Align.START} />
        {modeSelect(BRIGHT_MODES, brightMode, (v) =>
          patch({ brightness: v === "keep" ? null : bright.get() }))}
        <box spacing={4} valign={Gtk.Align.CENTER} visible={brightMode((m) => m === "set")}>
          <NumberField value={bright} min={1} max={100} chars={3} pad={0} onCommit={(v) => patch({ brightness: v })} />
          <TextoInformativo label="%" />
        </box>
      </box>
    </box>
  )
}

// Campo numérico en minutos con − / valor / + (para los timeouts de hypridle).
function MinuteStepper({ value, onChange }: { value: any, onChange: (mins: number) => void }) {
  return (
    <box spacing={6} valign={Gtk.Align.CENTER}>
      <button cssClasses={["sp-step-btn"]} onClicked={() => onChange(Math.max(1, value.get() - 1))}><label label="−" /></button>
      <label cssClasses={["sp-step-val"]} label={value((v: number) => `${v} min`)} />
      <button cssClasses={["sp-step-btn"]} onClicked={() => onChange(value.get() + 1)}><label label="+" /></button>
    </box>
  )
}

// Una fila de tiempo de inactividad: interruptor + stepper (o "Nunca" al apagarlo).
//
// El interruptor NO desactiva poniendo el timeout a 0, y eso no es preferencia de
// estilo: hypridle acepta `timeout = 0` como listener válido y lo dispara AL
// INSTANTE (medido: "Registered timeout rule for 0s" y la acción ejecutada ya).
// En la fila "Suspender" eso apagaría el PC nada más guardar. Desactivar es
// comentar la línea con el sentinel `# GIGIOS-OFF` (writeHypridle): hypridle
// registra "Category has a missing timeout setting", ignora ESE listener y sigue
// con los demás. De regalo, el valor sobrevive comentado, así que al reencender
// vuelve tu número en vez de un valor por defecto.
function IdleRow({ label, mins, setMins, on, setOn, commit }: {
  label: string
  mins: Accessor<number>
  setMins: (v: number) => void
  on: Accessor<boolean>
  setOn: (v: boolean) => void
  commit: () => void
}) {
  return (
    <box spacing={8} valign={Gtk.Align.CENTER}>
      <TituloAjuste label={label} hexpand halign={Gtk.Align.START} />
      <label cssClasses={["sp-step-val", "off"]} label="Nunca" visible={on((v) => !v)} />
      {/* `visible` y no `<With>`: un With se remonta al final de su caja y mandaría
          el stepper detrás del interruptor cada vez que se enciende la fila. */}
      <box visible={on}>
        <MinuteStepper value={mins} onChange={(v) => { setMins(v); commit() }} />
      </box>
      <Interruptor activo={on} alAlternar={() => { setOn(!on.get()); commit() }} />
    </box>
  )
}

export default function DisplaySection() {
  const [selectedName, setSelectedName] = createState<string>("")
  const [editingBrightness, setEditingBrightness] = createState(false)
  const [editingTemp, setEditingTemp] = createState(false)
  let brightnessEntry: Gtk.Entry
  let tempEntry: Gtk.Entry

  const commitBrightness = () => {
    const parsed = Number.parseInt(brightnessEntry?.text.trim() ?? "", 10)
    const value = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : Math.round(brightness.get() * 100)
    applyBrightness(value / 100)
    saveDisplayConfig()
    if (brightnessEntry) brightnessEntry.text = String(value)
    setEditingBrightness(false)
  }
  const editBrightness = () => {
    brightnessEntry.text = String(Math.round(brightness.get() * 100))
    setEditingBrightness(true)
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      brightnessEntry.grab_focus(); brightnessEntry.select_region(0, -1)
      return GLib.SOURCE_REMOVE
    })
  }
  const commitTemp = () => {
    const parsed = Number.parseInt(tempEntry?.text.trim() ?? "", 10)
    const value = Number.isFinite(parsed) ? Math.max(1500, Math.min(6000, parsed)) : nightLightTemp.get()
    setManualTemp(value)
    if (tempEntry) tempEntry.text = String(value)
    setEditingTemp(false)
  }
  const editTemp = () => {
    tempEntry.text = String(nightLightTemp.get())
    setEditingTemp(true)
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      tempEntry.grab_focus(); tempEntry.select_region(0, -1)
      return GLib.SOURCE_REMOVE
    })
  }

  // Poller ref-counted: adquirir mientras el panel de Ajustes esté visible;
  // liberar al ocultarse y al destruirse la sección (evita fugas y timers vivos).
  let holding = false
  const evalPoll = () => {
    const want = settingsPanelVisible.get()
    if (want && !holding) { acquirePoll(); holding = true }
    else if (!want && holding) { releasePoll(); holding = false }
  }
  const unsub = settingsPanelVisible.subscribe(evalPoll)
  evalPoll()

  // Reloj de la sección (para "vigente" y el resumen): vive mientras viva la sección.
  acquireClock()

  // Qué está aplicando el horario AHORA. Es la respuesta visible a "¿por qué se ha
  // encendido?": si una franja rige, se ve aquí y su tarjeta sale marcada.
  const scheduleSummary = createComputed(() => {
    const t = scheduleNow()
    const hh = `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`
    if (!nightRulesEnabled() || nightRules().length === 0) return `Ahora (${hh}) · sin franjas: manda el ajuste manual de arriba`
    const temp = activeSetpoint(t, nightRules(), "temp")
    const bright = activeSetpoint(t, nightRules(), "brightness")
    const luz = temp != null && temp > 0 ? `${temp} K` : "—"
    const bri = bright != null ? `${bright} %` : "—"
    return `Ahora (${hh}) · luz nocturna: ${luz} · brillo: ${bri}`
  })

  const fixSelection = () => {
    const list = monitors.get()
    if (list.length && !list.some((m: any) => m.name === selectedName.get())) {
      const f = list.find((m: any) => m.focused) || list[0]
      setSelectedName(f ? f.name : "")
    }
  }
  const unsubMon = monitors.subscribe(fixSelection)
  fixSelection()

  const cleanup = () => {
    if (holding) { releasePoll(); holding = false }
    releaseClock()
    if (typeof unsub === "function") unsub()
    if (typeof unsubMon === "function") unsubMon()
  }

  const selected = createComputed(() => monitors().find((m: any) => m.name === selectedName()) || null)

  // ── Brillo ──
  const brightScale = makeScale(
    ["qs-slider", "brightness"],
    () => brightness.get(),
    (v) => { applyBrightness(v); saveDisplayConfig() },
    (cb) => brightness.subscribe(cb),
  )

  // ── Temperatura manual de luz nocturna (slider 1500–6000K) ──
  const tempScale = makeScale(
    ["qs-slider", "temperature"],
    () => (nightLightTemp.get() - 1500) / 4500,
    (v) => setManualTemp(Math.round(v * 4500 + 1500)),
    (cb) => nightLightTemp.subscribe(cb),
  )

  // ── hypridle (suspensión) ──
  const hypr = readHypridle() || { dpms: { timeout: 600, enabled: true }, lock: { timeout: 630, enabled: true }, suspend: { timeout: 660, enabled: true } }
  // Suelo de 1 min: un listener ausente del .conf parsea a `{timeout: 0}`, y ese 0
  // llegaría al fichero al encender la fila — que es justo el disparo instantáneo
  // que el sentinel evita. El stepper ya no baja de 1; esto cubre la entrada.
  const toMin = (secs: number) => Math.max(1, Math.round(secs / 60))
  const [dpmsMin, setDpmsMin] = createState(toMin(hypr.dpms.timeout))
  const [lockMin, setLockMin] = createState(toMin(hypr.lock.timeout))
  const [suspMin, setSuspMin] = createState(toMin(hypr.suspend.timeout))
  // El estado de encendido sale del fichero, NO de `true` fijo: con `true` cualquier
  // edición (mover un stepper de otra fila) reescribía los tres listeners como
  // activos y resucitaba en silencio un GIGIOS-OFF ya puesto.
  const [dpmsOn, setDpmsOn] = createState(hypr.dpms.enabled)
  const [lockOn, setLockOn] = createState(hypr.lock.enabled)
  const [suspOn, setSuspOn] = createState(hypr.suspend.enabled)
  const commitHypridle = () => saveHypridle({
    dpms: { timeout: dpmsMin.get() * 60, enabled: dpmsOn.get() },
    lock: { timeout: lockMin.get() * 60, enabled: lockOn.get() },
    suspend: { timeout: suspMin.get() * 60, enabled: suspOn.get() },
  })

  // Bit depth / gestión de color: reflejan la PREFERENCIA guardada (monitorPrefs),
  // no solo el formato reportado — así la elección "se queda" aunque el panel no
  // cambie el formato de salida (p.ej. eDP sin 10-bit real).
  const curBitdepth = (s: any): number => {
    const pref = s ? monitorPrefs[s.description] : null
    if (pref?.bitdepth != null) return pref.bitdepth
    return s && s.currentFormat && /2101010/.test(String(s.currentFormat)) ? 10 : 8
  }
  const curCm = (s: any): string => {
    const pref = s ? monitorPrefs[s.description] : null
    return pref?.cm ?? "auto"
  }

  // Capacidad del monitor seleccionado (para ocultar lo no soportado). Mientras no
  // se hayan detectado (arranque), los ajustes inciertos quedan ocultos.
  const capOf = (key: "vrr" | "bitdepth10" | "hdr") =>
    createComputed(() => { const s = selected(); return !!s && !!(monitorCaps()[s.name]?.[key]) })
  const anyVrr = createComputed(() => Object.values(monitorCaps()).some((c) => c.vrr))

  return (
    <overlay cssClasses={["display-select-host"]}>
    <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-section"]} hexpand
      $={(self: any) => self.connect("destroy", cleanup)}>
      <TituloSeccion titulo="Pantalla" />

      {/* Selector de monitor */}
      <TextoInformativo cssClasses={["sp-display-detected-title"]} label="PANTALLAS DETECTADAS" halign={Gtk.Align.START} />
      <box cssClasses={["qs-display-monitor-tabs"]} spacing={6}>
        <For each={monitors}>
          {(m: any) => (
            <button
              cssClasses={selectedName((n) => n === m.name ? ["qs-display-monitor-pill", "active"] : ["qs-display-monitor-pill"])}
              onClicked={() => setSelectedName(m.name)}
            >
              <box spacing={5} valign={Gtk.Align.CENTER}>
                <label cssClasses={["qs-display-monitor-dot"]} label="●" visible={m.focused} />
                <label label={m.name} ellipsize={3} maxWidthChars={14} />
              </box>
            </button>
          )}
        </For>
      </box>

      {/* ── Por monitor ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={5} cssClasses={["sp-field", "sp-display-monitor-fields"]}
        visible={createComputed(() => { const s = selected(); return !!s && !s.disabled })}>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
          <TituloAjuste label="Resolución" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => { const s = selected(); return s ? `${s.width}×${s.height}` : "—" })}
            options={createComputed(() => {
              const s = selected(); if (!s) return []
              return resolutionOptions(s.availableModes).map(o => ({ label: o.label, value: o.key, active: s.width === o.w && s.height === o.h }))
            })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { mode: `${value}@${s.refreshRate.toFixed(2)}Hz` }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
          <TituloAjuste label="Frecuencia" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => { const s = selected(); return s ? `${Math.round(s.refreshRate)} Hz` : "—" })}
            options={createComputed(() => {
              const s = selected(); if (!s) return []
              return refreshOptions(s.availableModes).map(o => ({ label: `${o.hz} Hz`, value: o.raw, active: Math.round(s.refreshRate) === o.hz }))
            })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { mode: `${s.width}x${s.height}@${value}Hz` }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
          <TituloAjuste label="Escala" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => { const s = selected(); return s ? matchScalePreset(s.scale).toFixed(2) : "—" })}
            options={createComputed(() => {
              const s = selected(); if (!s) return []
              const cur = matchScalePreset(s.scale)
              return SCALE_PRESETS.map(sc => ({ label: sc.toFixed(2), value: String(sc), active: sc === cur }))
            })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { scale: Number(value) }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
          <TituloAjuste label="Rotación" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => { const s = selected(); const t = s ? (s.transform ?? 0) : 0; return (TRANSFORMS.find(x => x.value === t) || TRANSFORMS[0]).label })}
            options={createComputed(() => {
              const s = selected(); const cur = s ? (s.transform ?? 0) : 0
              return TRANSFORMS.map(t => ({ label: t.label, value: String(t.value), active: t.value === cur }))
            })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { transform: Number(value) }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0} visible={capOf("bitdepth10")}>
          <TituloAjuste label="Profundidad de color" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => `${curBitdepth(selected())}-bit`)}
            options={createComputed(() => { const bd = curBitdepth(selected()); return [
              { label: "8-bit", value: "8", active: bd === 8 },
              { label: "10-bit", value: "10", active: bd === 10 },
            ] })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { bitdepth: Number(value) }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0} visible={capOf("hdr")}>
          <TituloAjuste label="Gestión de color" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => { const cm = curCm(selected()); return (CM_MODES.find(c => c.value === cm) || CM_MODES[0]).label })}
            options={createComputed(() => { const cm = curCm(selected()); return CM_MODES.map(c => ({ label: c.label, value: c.value, active: c.value === cm })) })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { cm: value }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}
          visible={createComputed(() => monitors().length > 1)}>
          <TituloAjuste label="Posición (relativa a otro)" halign={Gtk.Align.START} />
          <DisplaySelect
            current="Colocar…"
            options={createComputed(() => {
              const s = selected(); if (!s) return []
              const opts: any[] = []
              for (const m of monitors()) {
                if (m.name === s.name) continue
                for (const [side, es] of [["right", "a la derecha de"], ["left", "a la izquierda de"], ["down", "debajo de"], ["up", "encima de"]] as const) {
                  opts.push({ label: `${es} ${m.name}`, value: `${side}|${m.name}`, active: false })
                }
              }
              return opts
            })}
            onSelect={(value) => {
              const s = selected(); if (!s) return
              const [side, refName] = value.split("|")
              const ref = monitors().find((m: any) => m.name === refName)
              if (!ref) return
              const pos = computeRelativePosition(
                { x: ref.x, y: ref.y, width: ref.width, height: ref.height, scale: ref.scale },
                { width: s.width, height: s.height, scale: s.scale },
                side as any,
              )
              applyPatch(s, { position: pos })
            }}
          />
        </box>

        <box spacing={8} valign={Gtk.Align.CENTER} visible={capOf("vrr")}>
          <TituloAjuste label="VRR / FreeSync" hexpand halign={Gtk.Align.START} />
          <Interruptor
            activo={createComputed(() => Boolean(selected()?.vrr))}
            alAlternar={() => { const s = selected(); if (s) applyPatch(s, { vrr: !s.vrr }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}
          visible={createComputed(() => monitors().length > 1)}>
          <TituloAjuste label="Duplicar en" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => { const s = selected(); return s && s.mirrorOf && s.mirrorOf !== "none" ? s.mirrorOf : "Ninguno" })}
            options={createComputed(() => {
              const s = selected(); if (!s) return []
              const noMirror = !s.mirrorOf || s.mirrorOf === "none"
              const opts = [{ label: "Ninguno", value: "none", active: noMirror }]
              for (const m of monitors()) { if (m.name !== s.name) opts.push({ label: m.name, value: m.name, active: s.mirrorOf === m.name }) }
              return opts
            })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { mirrorOf: value }) }}
          />
        </box>
      </box>

      {/* ── Brillo ── (solo si hay backend: ver `display/brightness.ts`) */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["sp-field"]} visible={brightnessSupported}>
        <box spacing={6}>
          <TituloAjuste label="Brillo" hexpand halign={Gtk.Align.START} />
          <button cssClasses={["qs-inline-value-btn"]} visible={editingBrightness((v) => !v)} onClicked={editBrightness}>
            <TextoInformativo label={brightness((v: number) => `${Math.round(v * 100)}`)} />
          </button>
          <Gtk.Entry
            cssClasses={["qs-inline-number-input"]} visible={editingBrightness}
            maxLength={3} widthChars={3} widthRequest={28} heightRequest={16}
            xalign={1} inputPurpose={Gtk.InputPurpose.DIGITS}
            $={(self: Gtk.Entry) => { brightnessEntry = self; self.text = String(Math.round(brightness.get() * 100)) }}
            onActivate={commitBrightness}
          ><Gtk.EventControllerFocus onLeave={commitBrightness} /></Gtk.Entry>
        </box>
        {brightScale}
      </box>

      {/* ── Luz nocturna: manual (ahora) ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["sp-field"]}>
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <TituloAjuste label="Luz nocturna" hexpand halign={Gtk.Align.START} />
          <button cssClasses={["qs-inline-value-btn"]} visible={editingTemp((v) => !v)} onClicked={editTemp}>
            <TextoInformativo label={nightLightTemp((t: number) => `${t}K`)} />
          </button>
          <Gtk.Entry
            cssClasses={["qs-inline-number-input"]} visible={editingTemp}
            maxLength={4} widthChars={4} widthRequest={34} heightRequest={16}
            xalign={1} inputPurpose={Gtk.InputPurpose.DIGITS}
            $={(self: Gtk.Entry) => { tempEntry = self; self.text = String(nightLightTemp.get()) }}
            onActivate={commitTemp}
          ><Gtk.EventControllerFocus onLeave={commitTemp} /></Gtk.Entry>
          <Interruptor
            activo={nightLightActive}
            alAlternar={() => setNightLightManual(!nightLightActive.get())}
          />
        </box>
        {tempScale}
      </box>

      {/* ── Franjas horarias: luz nocturna y/o brillo (independiente del manual) ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["sp-field"]}>
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <TituloAjuste label="Programar por franjas horarias" hexpand halign={Gtk.Align.START} />
          <Interruptor
            activo={nightRulesEnabled}
            alAlternar={() => setNightRulesEnabled(!nightRulesEnabled.get())}
          />
        </box>
        <TextoInformativo
          label={"Cada regla vale SOLO dentro de su franja: al terminar, la luz nocturna vuelve al ajuste manual y el brillo, al valor que tenía antes de entrar. Una franja puede cruzar la medianoche (22:00 → 07:00).\nLos dos canales son independientes: lo que dejes en «No cambiar» no lo toca esa franja. Menos K = más cálido (3500 ≈ cálido).\nEl brillo se fija al entrar: dentro de la franja puedes seguir ajustándolo a mano sin que te lo pise."}
          halign={Gtk.Align.START} wrap maxWidthChars={62} xalign={0}
        />
        <label
          cssClasses={["sp-schedule-now"]}
          label={scheduleSummary}
          visible={nightRulesEnabled}
          halign={Gtk.Align.START} xalign={0}
        />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={6} visible={nightRulesEnabled}>
          <For each={nightRules} id={ruleKey}>
            {(rule: NightRule, index: any) => <RuleRow rule={rule} index={index} />}
          </For>
          <button
            cssClasses={["sp-add-rule"]}
            halign={Gtk.Align.START}
            onClicked={() => setNightRulesAndSave([...nightRules.get(), { start: "22:00", end: "07:00", temp: DEFAULT_RULE_TEMP, brightness: null }])}
          >
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label label="󰐕" />
              <label label="Añadir franja" />
            </box>
          </button>
        </box>
      </box>

      {/* ── Globales ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-field"]}>
        <TituloSubseccion label="✦ Ajustes globales" halign={Gtk.Align.START} />

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} visible={anyVrr}>
          <TextoInformativo label="Modo VRR global (misc:vrr)" halign={Gtk.Align.START} />
          <DisplaySelect
            current={globalVrrMode((v: number) => v === 0 ? "Desactivado" : v === 1 ? "Activado" : "Solo pantalla completa")}
            options={globalVrrMode((v: number) => [
              { label: "Desactivado", value: "0", active: v === 0 },
              { label: "Activado", value: "1", active: v === 1 },
              { label: "Solo pantalla completa", value: "2", active: v === 2 },
            ])}
            onSelect={(value) => applyGlobalVrr(Number(value))}
          />
        </box>

        <box spacing={8} valign={Gtk.Align.CENTER}>
          <TituloAjuste label="Permitir tearing (juegos)" hexpand halign={Gtk.Align.START} />
          <Interruptor
            activo={allowTearing}
            alAlternar={() => applyAllowTearing(!allowTearing.get())}
          />
        </box>
      </box>

      {/* ── Suspensión de pantalla (hypridle) ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-field"]}>
        <TituloSubseccion label="✦ Suspensión de pantalla" halign={Gtk.Align.START} />
        <TextoInformativo label="Tiempos de inactividad. Apaga el interruptor para que algo no ocurra nunca; se conserva el tiempo por si lo vuelves a encender. Se guardan en hypridle.conf y reinician hypridle." halign={Gtk.Align.START} wrap maxWidthChars={62} xalign={0} />
        <IdleRow label="Apagar pantalla" mins={dpmsMin} setMins={setDpmsMin} on={dpmsOn} setOn={setDpmsOn} commit={commitHypridle} />
        <IdleRow label="Bloquear" mins={lockMin} setMins={setLockMin} on={lockOn} setOn={setLockOn} commit={commitHypridle} />
        <IdleRow label="Suspender" mins={suspMin} setMins={setSuspMin} on={suspOn} setOn={setSuspOn} commit={commitHypridle} />
      </box>

    </box>
    </overlay>
  )
}
