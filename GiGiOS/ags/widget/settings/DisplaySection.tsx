// widget/settings/DisplaySection.tsx
// Sección "Pantalla" del panel de Ajustes: TODOS los ajustes de pantalla
// (copiados de QuickSettings + avanzados) sobre el service compartido
// (widget/display/service.ts). Patrón visual sp-section/sp-field como
// PersonalizationSection.
import { Gtk } from "ags/gtk4"
import { createState, createComputed, For } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { DisplaySelect } from "../display/controls"
import {
  monitors, monitorPrefs, monitorCaps, applyPatch, acquirePoll, releasePoll,
  globalVrrMode, applyGlobalVrr, allowTearing, applyAllowTearing,
  nightRules, setNightRulesAndSave, nightRulesEnabled, setNightRulesEnabled,
  setNightLightManual, setManualTemp, saveDisplayConfig,
} from "../display/service"
import type { NightRule } from "../display/schedule"
import {
  resolutionOptions, refreshOptions, matchScalePreset, SCALE_PRESETS,
  TRANSFORMS, CM_MODES, computeRelativePosition,
} from "../display/modes"
import { parseHypridle, writeHypridle } from "../display/hypridle"
import type { HypridleConfig, ListenerKind } from "../display/hypridle"
import {
  settingsPanelVisible,
  brightness, setBrightness,
  nightLightActive, nightLightTemp,
} from "../state"

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
  scale.connect("change-value", (_s, _scroll, val) => { setValue(clamp(val)); return false })
  return scale
}

// Input numérico que se escribe a mano. Valida y acota [min, max] al pulsar Enter
// o al salir del campo; reescribe con `pad` dígitos.
function NumberField({ initial, min, max, chars = 2, pad = 2, onCommit }: {
  initial: number, min: number, max: number, chars?: number, pad?: number, onCommit: (n: number) => void,
}) {
  let ref: Gtk.Entry
  const commit = () => {
    if (!ref) return
    const raw = parseInt(ref.get_text().trim(), 10)
    const v = isNaN(raw) ? min : Math.max(min, Math.min(max, raw))
    ref.set_text(String(v).padStart(pad, "0"))
    onCommit(v)
  }
  return (
    <entry
      cssClasses={["sp-num-input"]}
      maxLength={chars}
      widthChars={chars}
      xalign={0.5}
      $={(self: Gtk.Entry) => { ref = self; self.set_text(String(initial).padStart(pad, "0")) }}
      onActivate={commit}
    >
      <Gtk.EventControllerFocus onLeave={commit} />
    </entry>
  )
}

// Fila de una regla de luz nocturna: HH : MM → NNNN K + borrar. Edita la regla en
// su índice actual dentro de la lista (index es un accessor de gnim For).
function RuleRow({ rule, index }: { rule: NightRule, index: any }) {
  const [h0, m0] = rule.time.split(":").map(Number)
  const setTimePart = (idx: 0 | 1, val: number) => {
    const i = index.get()
    const rules = nightRules.get().slice()
    if (!rules[i]) return
    const p = rules[i].time.split(":")
    p[idx] = String(val).padStart(2, "0")
    rules[i] = { ...rules[i], time: `${p[0]}:${p[1]}` }
    setNightRulesAndSave(rules)
  }
  const setTemp = (val: number) => {
    const i = index.get()
    const rules = nightRules.get().slice()
    if (!rules[i]) return
    rules[i] = { ...rules[i], temp: val }
    setNightRulesAndSave(rules)
  }
  const remove = () => setNightRulesAndSave(nightRules.get().filter((_, idx) => idx !== index.get()))
  const isOn = rule.temp > 0   // temp 0 = apagar desde esa hora
  return (
    <box spacing={5} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]}>
      <NumberField initial={h0} min={0} max={23} onCommit={(v) => setTimePart(0, v)} />
      <label cssClasses={["sp-field-hint"]} label=":" />
      <NumberField initial={m0} min={0} max={59} onCommit={(v) => setTimePart(1, v)} />
      <label cssClasses={["sp-field-hint"]} label="→" />
      {isOn
        ? <box spacing={5} valign={Gtk.Align.CENTER}>
            <NumberField initial={rule.temp} min={1000} max={6500} chars={4} pad={0} onCommit={setTemp} />
            <label cssClasses={["sp-field-hint"]} label="K" />
          </box>
        : <label cssClasses={["sp-field-hint"]} label="Apagada" />}
      <box hexpand />
      <button
        cssClasses={isOn ? ["qs-toggle", "on"] : ["qs-toggle"]}
        onClicked={() => setTemp(isOn ? 0 : 3500)}
        valign={Gtk.Align.CENTER}
        tooltipText={isOn ? "Apagar en esta franja" : "Encender con temperatura"}
      >
        <box cssClasses={["qs-toggle-track"]}>
          <box cssClasses={isOn ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"]} />
        </box>
      </button>
      <button cssClasses={["sp-rule-del"]} onClicked={remove} valign={Gtk.Align.CENTER}>
        <label label="󰅖" />
      </button>
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

export default function DisplaySection() {
  const [selectedName, setSelectedName] = createState<string>("")
  const [editingBrightness, setEditingBrightness] = createState(false)
  const [editingTemp, setEditingTemp] = createState(false)
  let brightnessEntry: Gtk.Entry
  let tempEntry: Gtk.Entry

  const commitBrightness = () => {
    const parsed = Number.parseInt(brightnessEntry?.text.trim() ?? "", 10)
    const value = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : Math.round(brightness.get() * 100)
    setBrightness(value / 100)
    saveDisplayConfig()
    execAsync(["bash", "-c", `brightnessctl -n2 s ${value}%`]).catch(() => {})
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
    if (typeof unsub === "function") unsub()
    if (typeof unsubMon === "function") unsubMon()
  }

  const selected = createComputed(() => monitors().find((m: any) => m.name === selectedName()) || null)

  // ── Brillo ──
  const brightScale = makeScale(
    ["qs-slider", "brightness"],
    () => brightness.get(),
    (v) => { setBrightness(v); saveDisplayConfig(); execAsync(["bash", "-c", `brightnessctl -n2 s ${Math.round(v * 100)}%`]).catch(() => {}) },
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
  const [dpmsMin, setDpmsMin] = createState(Math.round(hypr.dpms.timeout / 60))
  const [lockMin, setLockMin] = createState(Math.round(hypr.lock.timeout / 60))
  const [suspMin, setSuspMin] = createState(Math.round(hypr.suspend.timeout / 60))
  const commitHypridle = () => saveHypridle({
    dpms: { timeout: dpmsMin.get() * 60, enabled: true },
    lock: { timeout: lockMin.get() * 60, enabled: true },
    suspend: { timeout: suspMin.get() * 60, enabled: true },
  })
  const stepper = (st: any, setter: (v: number) => void) => (
    <MinuteStepper value={st} onChange={(v) => { setter(v); commitHypridle() }} />
  )

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
      <label cssClasses={["sp-section-title"]} label="✦ Pantalla" halign={Gtk.Align.START} />

      {/* Selector de monitor */}
      <label cssClasses={["sp-field-hint", "sp-display-detected-title"]} label="PANTALLAS DETECTADAS" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="Resolución" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="Frecuencia" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="Escala" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="Rotación" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="Profundidad de color" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="Gestión de color" halign={Gtk.Align.START} />
          <DisplaySelect
            current={createComputed(() => { const cm = curCm(selected()); return (CM_MODES.find(c => c.value === cm) || CM_MODES[0]).label })}
            options={createComputed(() => { const cm = curCm(selected()); return CM_MODES.map(c => ({ label: c.label, value: c.value, active: c.value === cm })) })}
            onSelect={(value) => { const s = selected(); if (s) applyPatch(s, { cm: value }) }}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}
          visible={createComputed(() => monitors().length > 1)}>
          <label cssClasses={["sp-field-label"]} label="Posición (relativa a otro)" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="VRR / FreeSync" hexpand halign={Gtk.Align.START} />
          <button
            cssClasses={createComputed(() => { const s = selected(); return s && s.vrr ? ["qs-toggle", "on"] : ["qs-toggle"] })}
            onClicked={() => { const s = selected(); if (s) applyPatch(s, { vrr: !s.vrr }) }}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={createComputed(() => { const s = selected(); return s && s.vrr ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"] })} />
            </box>
          </button>
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}
          visible={createComputed(() => monitors().length > 1)}>
          <label cssClasses={["sp-field-label"]} label="Duplicar en" halign={Gtk.Align.START} />
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

      {/* ── Brillo ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["sp-field"]}>
        <box spacing={6}>
          <label cssClasses={["sp-field-label"]} label="Brillo" hexpand halign={Gtk.Align.START} />
          <button cssClasses={["qs-inline-value-btn"]} visible={editingBrightness((v) => !v)} onClicked={editBrightness}>
            <label cssClasses={["sp-field-hint"]} label={brightness((v: number) => `${Math.round(v * 100)}`)} />
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
          <label cssClasses={["sp-field-label"]} label="Luz nocturna" hexpand halign={Gtk.Align.START} />
          <button cssClasses={["qs-inline-value-btn"]} visible={editingTemp((v) => !v)} onClicked={editTemp}>
            <label cssClasses={["sp-field-hint"]} label={nightLightTemp((t: number) => `${t}K`)} />
          </button>
          <Gtk.Entry
            cssClasses={["qs-inline-number-input"]} visible={editingTemp}
            maxLength={4} widthChars={4} widthRequest={34} heightRequest={16}
            xalign={1} inputPurpose={Gtk.InputPurpose.DIGITS}
            $={(self: Gtk.Entry) => { tempEntry = self; self.text = String(nightLightTemp.get()) }}
            onActivate={commitTemp}
          ><Gtk.EventControllerFocus onLeave={commitTemp} /></Gtk.Entry>
          <button
            cssClasses={nightLightActive((n) => n ? ["qs-toggle", "on"] : ["qs-toggle"])}
            onClicked={() => setNightLightManual(!nightLightActive.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={nightLightActive((n) => n ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
        {tempScale}
      </box>

      {/* ── Luz nocturna: programación por horas (independiente del manual) ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["sp-field"]}>
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <label cssClasses={["sp-field-label"]} label="Programar por horas" hexpand halign={Gtk.Align.START} />
          <button
            cssClasses={nightRulesEnabled((n) => n ? ["qs-toggle", "on"] : ["qs-toggle"])}
            onClicked={() => setNightRulesEnabled(!nightRulesEnabled.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={nightRulesEnabled((n) => n ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
        <label
          cssClasses={["sp-field-hint"]}
          label={"A cada hora se aplica su temperatura hasta la siguiente regla (prioridad sobre el manual).\nUsa el interruptor de cada regla para apagar la luz en esa franja. Menos K = más cálido (3500 ≈ cálido)."}
          halign={Gtk.Align.START} wrap maxWidthChars={62} xalign={0}
        />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={6} visible={nightRulesEnabled}>
          <For each={nightRules}>
            {(rule: NightRule, index: any) => <RuleRow rule={rule} index={index} />}
          </For>
          <button
            cssClasses={["sp-add-rule"]}
            halign={Gtk.Align.START}
            onClicked={() => setNightRulesAndSave([...nightRules.get(), { time: "22:00", temp: 4000 }])}
          >
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label label="󰐕" />
              <label label="Añadir regla" />
            </box>
          </button>
        </box>
      </box>

      {/* ── Globales ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-field"]}>
        <label cssClasses={["sp-subsection-title"]} label="✦ Ajustes globales" halign={Gtk.Align.START} />

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} visible={anyVrr}>
          <label cssClasses={["sp-field-hint"]} label="Modo VRR global (misc:vrr)" halign={Gtk.Align.START} />
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
          <label cssClasses={["sp-field-label"]} label="Permitir tearing (juegos)" hexpand halign={Gtk.Align.START} />
          <button
            cssClasses={allowTearing((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
            onClicked={() => applyAllowTearing(!allowTearing.get())}
          >
            <box cssClasses={["qs-toggle-track"]}>
              <box cssClasses={allowTearing((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
            </box>
          </button>
        </box>
      </box>

      {/* ── Suspensión de pantalla (hypridle) ── */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-field"]}>
        <label cssClasses={["sp-subsection-title"]} label="✦ Suspensión de pantalla" halign={Gtk.Align.START} />
        <label cssClasses={["sp-field-hint"]} label="Tiempos de inactividad. Se guardan en hypridle.conf y reinician hypridle." halign={Gtk.Align.START} wrap maxWidthChars={62} xalign={0} />
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <label cssClasses={["sp-field-label"]} label="Apagar pantalla" hexpand halign={Gtk.Align.START} />
          {stepper(dpmsMin, setDpmsMin)}
        </box>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <label cssClasses={["sp-field-label"]} label="Bloquear" hexpand halign={Gtk.Align.START} />
          {stepper(lockMin, setLockMin)}
        </box>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <label cssClasses={["sp-field-label"]} label="Suspender" hexpand halign={Gtk.Align.START} />
          {stepper(suspMin, setSuspMin)}
        </box>
      </box>

    </box>
    </overlay>
  )
}
