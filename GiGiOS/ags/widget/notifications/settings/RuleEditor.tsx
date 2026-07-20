// widget/notifications/settings/RuleEditor.tsx
// Form editor for a single rule. No JSON exposed. Mounted fresh per edit.
import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import type { NotifRule, StringMatch, Lifetime, DedupKeySpec, PopupStyle } from "../rules/types.ts"
import { NOTIF_FIELDS } from "../rules/notifFields.ts"
import { parseDuration, formatDuration } from "../rules/duration.ts"
import { upsertUserRule, removeUserRule, setBuiltinOverride, clearBuiltinOverride } from "../rules/rulesStore.ts"
import { validateRule } from "../rules/validate.ts"
import ColorPicker from "./ColorPicker.tsx"
import textos from "../../../textos/ajustes/notificaciones.json" with { type: "json" }
import { formatearTexto } from "../../../textos/formatear.ts"

const OPS: StringMatch["op"][] = ["contains", "equals", "regex"]
const OP_LABEL: Record<StringMatch["op"], string> = {
  contains: textos.editor.operadores.contiene,
  equals: textos.editor.operadores.igual,
  regex: textos.editor.operadores.expresionRegular,
}
const LIFETIMES: (Lifetime | "none")[] = ["none", "flash", "timed", "persistent"]
const LIFE_LABEL: Record<string, string> = {
  none: textos.editor.ciclos.ninguno,
  flash: textos.editor.ciclos.hastaCondicion,
  timed: textos.editor.ciclos.temporal,
  persistent: textos.editor.ciclos.hastaSieteDias,
}
const DEDUPS: ("app" | "app+summary" | "app+summary+body")[] = ["app", "app+summary", "app+summary+body"]
const DEDUP_LABEL: Record<string, string> = {
  "app": textos.editor.duplicados.app,
  "app+summary": textos.editor.duplicados.appTitulo,
  "app+summary+body": textos.editor.duplicados.appTituloCuerpo,
}
// "none" no es un PopupStyle: es "la regla no opina", y entonces decide el hint
// x-gigios-source de los scripts (sistema → dunst). Fijar "default" NO es lo mismo — eso saca
// del skin incluso a una notificación del sistema.
const STYLES: (PopupStyle | "none")[] = ["none", "default", "dunst"]
const STYLE_LABEL: Record<string, string> = {
  none: textos.editor.estilos.ninguno,
  default: textos.editor.estilos.gigios,
  dunst: textos.editor.estilos.dunst,
}
const CONDITIONS = ["battery-resolved", "superseded"]
const COND_LABEL: Record<string, string> = {
  "battery-resolved": textos.editor.condiciones.bateria,
  "superseded": textos.editor.condiciones.reemplazadaSinEfecto,
}

export default function RuleEditor({ rule, onClose }: { rule: NotifRule; onClose: () => void }) {
  // Working copy held as one state; helpers patch it.
  const [draft, setDraft] = createState<NotifRule>(JSON.parse(JSON.stringify(rule)))
  const [errors, setErrors] = createState<string[]>([])
  const patch = (p: Partial<NotifRule>) => {
    if (errors.get().length) setErrors([]) // clear stale validation errors as the user edits
    setDraft({ ...draft.get(), ...p })
  }
  const patchMatch = (p: Partial<NotifRule["match"]>) => patch({ match: { ...draft.get().match, ...p } })
  const patchEffects = (p: Partial<NotifRule["effects"]>) => patch({ effects: { ...draft.get().effects, ...p } })
  // rewrite per-field state: undefined = leave unchanged, "" = clear/omit, text = replace.
  type RewriteField = "appName" | "summary" | "body"
  const updateRewrite = (which: RewriteField, val: string | undefined) => {
    const cur: { appName?: string; summary?: string; body?: string } = { ...(draft.get().effects.rewrite ?? {}) }
    if (val === undefined) delete cur[which]; else cur[which] = val
    const e = { ...draft.get().effects }
    if (cur.appName === undefined && cur.summary === undefined && cur.body === undefined) delete e.rewrite
    else e.rewrite = cur
    patch({ effects: e })
  }
  const setRewriteText = (which: RewriteField, text: string) => updateRewrite(which, text ? text : undefined)
  const setRewriteClear = (which: RewriteField, clear: boolean) => updateRewrite(which, clear ? "" : undefined)
  const isBuiltin = rule.source === "builtin"
  const isNew = !isBuiltin
    && rule.name === textos.resumen.nuevaRegla
    && Object.keys(rule.match).length === 0
    && Object.keys(rule.effects).length === 0

  // Build a StringMatch field block (operator selector + value entry). Empty value removes the field.
  function MatchField(props: { field: "app" | "summary" | "body" | "source"; title: string }) {
    const cur = (): StringMatch | undefined => draft.get().match[props.field]
    return (
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
        <label cssClasses={["re-field-label"]} label={props.title} halign={Gtk.Align.START} />
        <box spacing={4}>
          {OPS.map(op => (
            <button
              cssClasses={draft((d) => d.match[props.field]?.op === op ? ["re-seg", "active"] : ["re-seg"])}
              onClicked={() => {
                const c = cur()
                patchMatch({ [props.field]: { op, value: c?.value ?? "", ci: c?.ci } } as any)
              }}
            >
              <label label={OP_LABEL[op]} />
            </button>
          ))}
        </box>
        <Gtk.Entry
          cssClasses={["re-entry"]}
          text={cur()?.value ?? ""}
          placeholderText={textos.editor.ayudas.campoVacio}
          onChanged={(self) => {
            const v = self.text
            if (!v) { const m = { ...draft.get().match }; delete (m as any)[props.field]; patch({ match: m }) }
            else { const c = cur(); patchMatch({ [props.field]: { op: c?.op ?? "contains", value: v } } as any) }
          }}
        />
      </box>
    )
  }

  function Toggle(props: { label: string; get: () => boolean; set: (v: boolean) => void }) {
    return (
      <button
        cssClasses={draft((_) => props.get() ? ["re-toggle", "active"] : ["re-toggle"])}
        onClicked={() => props.set(!props.get())}
      >
        <label label={props.label} />
      </button>
    )
  }

  // Wrapper "título + contenido" de un campo del formulario (VERTICAL, spacing
  // 4, clase re-field/re-field-label). No cubre los grupos de toggles sin
  // título (spacing 4, horizontal) ni el bloque de reescritura de texto
  // (varios sub-campos con su propio label inline) — esos se quedan como están.
  function Field({ title, visible, children }: { title: string; visible?: any; children?: any }) {
    return (
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]} visible={visible}>
        <label cssClasses={["re-field-label"]} label={title} halign={Gtk.Align.START} />
        {children}
      </box>
    )
  }

  const [advanced, setAdvanced] = createState(false)

  function save() {
    const d = draft.get()
    const errs = validateRule(d)
    if (errs.length) { setErrors(errs); return } // don't persist an invalid rule
    setErrors([])
    if (isBuiltin) {
      // Persist only the editable fields as an override keyed by builtin id.
      setBuiltinOverride(d.id, { enabled: d.enabled, name: d.name, match: d.match, effects: d.effects, priority: d.priority, stopOnMatch: d.stopOnMatch })
    } else {
      upsertUserRule(d)
    }
    onClose()
  }
  function del() {
    if (isBuiltin) clearBuiltinOverride(rule.id)
    else removeUserRule(rule.id)
    onClose()
  }

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["re-panel"]}>
      <box spacing={6} valign={Gtk.Align.CENTER}>
        <button cssClasses={["ns-back-btn"]} onClicked={onClose}><label label="󰅁" /></button>
        <label
          cssClasses={["ns-title"]}
          label={isBuiltin ? textos.editor.titulos.editarPredefinida : (isNew ? textos.editor.titulos.nueva : textos.editor.titulos.editar)}
          hexpand
          halign={Gtk.Align.START}
        />
        <button cssClasses={draft((d) => d.enabled ? ["re-toggle", "active"] : ["re-toggle"])} onClicked={() => patch({ enabled: !draft.get().enabled })}>
          <label label={draft((d) => d.enabled ? textos.editor.acciones.activa : textos.editor.acciones.inactiva)} />
        </button>
      </box>

      <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vexpand>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={10}>
          {/* Name */}
          <Field title={textos.editor.titulos.nombre}>
            <Gtk.Entry cssClasses={["re-entry"]} text={rule.name} onChanged={(self) => patch({ name: self.text })} />
          </Field>

          <label cssClasses={["re-section"]} label={textos.editor.titulos.cuando} halign={Gtk.Align.START} />
          <label
            cssClasses={["re-hint"]}
            label={textos.editor.ayudas.cuando}
            halign={Gtk.Align.START}
            wrap={true}
          />
          <MatchField field="app" title={textos.editor.titulos.aplicacion} />
          <MatchField field="summary" title={textos.editor.titulos.titulo} />
          <MatchField field="body" title={textos.editor.titulos.cuerpo} />
          {/* «system» = viene de un script de hypr/scripts (hint x-gigios-source). Es lo que casa
              la builtin del skin dunst; sin este campo esa regla no se podría editar desde aquí. */}
          <MatchField field="source" title={textos.editor.titulos.origen} />

          <label cssClasses={["re-section"]} label={textos.editor.titulos.acciones} halign={Gtk.Align.START} />
          {/* lifetime */}
          <Field title={textos.editor.titulos.ciclo}>
            <box spacing={4}>
              {LIFETIMES.map(lt => (
                <button
                  cssClasses={draft((d) => (d.effects.lifetime ?? "none") === lt ? ["re-seg", "active"] : ["re-seg"])}
                  onClicked={() => {
                    const e = { ...draft.get().effects }
                    if (lt === "none") delete e.lifetime; else e.lifetime = lt
                    patch({ effects: e })
                  }}
                >
                  <label label={LIFE_LABEL[lt]} />
                </button>
              ))}
            </box>
            <label
              cssClasses={["re-hint"]}
              label={textos.editor.ayudas.ciclo}
              halign={Gtk.Align.START}
              wrap={true}
            />
          </Field>

          {/* clear on reboot — independent flag; combinable with any lifetime (flash, timed, …) */}
          <box spacing={4} cssClasses={["re-field"]}>
            <Toggle
              label={textos.editor.acciones.limpiarReinicio}
              get={() => !!draft.get().effects.clearOnBoot}
              set={(v) => patchEffects({ clearOnBoot: v })}
            />
          </box>

          {/* ttl (only when timed) */}
          <Field title={textos.editor.titulos.expira} visible={draft((d) => d.effects.lifetime === "timed")}>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.ttlMs ? formatDuration(rule.effects.ttlMs) : ""}
              placeholderText={textos.editor.ayudas.duracion}
              onChanged={(self) => patchEffects({ ttlMs: parseDuration(self.text) ?? undefined })}
            />
          </Field>

          {/* effect toggles */}
          <box spacing={4} cssClasses={["re-field"]}>
            <Toggle label={textos.editor.acciones.descartar} get={() => !!draft.get().effects.suppress} set={(v) => patchEffects({ suppress: v })} />
            <Toggle label={textos.editor.acciones.sinPopup} get={() => !!draft.get().effects.dontShow} set={(v) => patchEffects({ dontShow: v })} />
            <Toggle label={textos.editor.acciones.sinAudio} get={() => !!draft.get().effects.muteAudio} set={(v) => patchEffects({ muteAudio: v })} />
            <Toggle label={textos.editor.acciones.sinHistorial} get={() => !!draft.get().effects.noHistory} set={(v) => patchEffects({ noHistory: v })} />
          </box>
          <label
            cssClasses={["re-hint"]}
            label={textos.editor.ayudas.efectos}
            halign={Gtk.Align.START}
            wrap={true}
          />

          {/* accent color */}
          <Field title={textos.editor.titulos.color}>
            <ColorPicker
              value={rule.effects.color}
              onChange={(hex) => {
                const e = { ...draft.get().effects }
                if (hex) e.color = hex; else delete e.color
                patch({ effects: e })
              }}
            />
          </Field>

          {/* popup skin */}
          <Field title={textos.editor.titulos.estilo}>
            <box spacing={4}>
              {STYLES.map(st => (
                <button
                  cssClasses={draft((d) => (d.effects.style ?? "none") === st ? ["re-seg", "active"] : ["re-seg"])}
                  onClicked={() => {
                    const e = { ...draft.get().effects }
                    if (st === "none") delete e.style; else e.style = st
                    patch({ effects: e })
                  }}
                >
                  <label label={STYLE_LABEL[st]} />
                </button>
              ))}
            </box>
            <label
              cssClasses={["re-hint"]}
              label={textos.editor.ayudas.estilo}
              halign={Gtk.Align.START}
              wrap={true}
            />
          </Field>

          {/* dedup key */}
          <Field title={textos.editor.titulos.duplicadas}>
            <box spacing={4}>
              {DEDUPS.map(dk => (
                <button
                  cssClasses={draft((d) => (typeof d.effects.dedupKey === "string" ? d.effects.dedupKey : "app+summary") === dk ? ["re-seg", "active"] : ["re-seg"])}
                  onClicked={() => patchEffects({ dedupKey: dk as DedupKeySpec })}
                >
                  <label label={DEDUP_LABEL[dk] ?? dk} />
                </button>
              ))}
            </box>
            <label
              cssClasses={["re-hint"]}
              label={textos.editor.ayudas.duplicados}
              halign={Gtk.Align.START}
              wrap={true}
            />
          </Field>

          <label cssClasses={["re-section"]} label={textos.editor.titulos.reescritura} halign={Gtk.Align.START} />
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            {/* nombre de la app */}
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label cssClasses={["re-field-label"]} label={textos.editor.titulos.nombreApp} hexpand halign={Gtk.Align.START} />
              <button
                cssClasses={draft((d) => d.effects.rewrite?.appName === "" ? ["re-toggle", "active"] : ["re-toggle"])}
                onClicked={() => setRewriteClear("appName", draft.get().effects.rewrite?.appName !== "")}
              ><label label={textos.editor.acciones.quitarNombre} /></button>
            </box>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.appName && rule.effects.rewrite.appName !== "" ? rule.effects.rewrite.appName : ""}
              placeholderText={textos.editor.ayudas.sinCambios}
              sensitive={draft((d) => d.effects.rewrite?.appName !== "")}
              onChanged={(self) => { if (draft.get().effects.rewrite?.appName === "") return; setRewriteText("appName", self.text) }}
            />

            {/* título */}
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label cssClasses={["re-field-label"]} label={textos.editor.titulos.nuevoTitulo} hexpand halign={Gtk.Align.START} />
              <button
                cssClasses={draft((d) => d.effects.rewrite?.summary === "" ? ["re-toggle", "active"] : ["re-toggle"])}
                onClicked={() => setRewriteClear("summary", draft.get().effects.rewrite?.summary !== "")}
              ><label label={textos.editor.acciones.vaciar} /></button>
            </box>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.summary && rule.effects.rewrite.summary !== "" ? rule.effects.rewrite.summary : ""}
              placeholderText={textos.editor.ayudas.sinCambios}
              sensitive={draft((d) => d.effects.rewrite?.summary !== "")}
              onChanged={(self) => { if (draft.get().effects.rewrite?.summary === "") return; setRewriteText("summary", self.text) }}
            />

            {/* cuerpo */}
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label cssClasses={["re-field-label"]} label={textos.editor.titulos.nuevoCuerpo} hexpand halign={Gtk.Align.START} />
              <button
                cssClasses={draft((d) => d.effects.rewrite?.body === "" ? ["re-toggle", "active"] : ["re-toggle"])}
                onClicked={() => setRewriteClear("body", draft.get().effects.rewrite?.body !== "")}
              ><label label={textos.editor.acciones.vaciar} /></button>
            </box>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.body && rule.effects.rewrite.body !== "" ? rule.effects.rewrite.body : ""}
              placeholderText={textos.editor.ayudas.sinCambios}
              sensitive={draft((d) => d.effects.rewrite?.body !== "")}
              onChanged={(self) => { if (draft.get().effects.rewrite?.body === "") return; setRewriteText("body", self.text) }}
            />

            <label
              cssClasses={["re-hint"]}
              label={formatearTexto(textos.editor.ayudas.variables, {
                variables: NOTIF_FIELDS.map(f => "{" + f.key + "}").join(", "),
              })}
              halign={Gtk.Align.START}
              wrap={true}
            />
          </box>

          {/* advanced: conditions */}
          <button cssClasses={["re-advanced-toggle"]} onClicked={() => setAdvanced(!advanced.get())}>
            <label label={advanced((a) => `${a ? "󰅀" : "󰅂"} ${textos.editor.titulos.avanzado}`)} halign={Gtk.Align.START} />
          </button>
          <Field title={textos.editor.titulos.condiciones} visible={advanced((a) => a)}>
            <label
              cssClasses={["re-hint"]}
              label={textos.editor.ayudas.condiciones}
              halign={Gtk.Align.START}
              wrap={true}
            />
            <box spacing={4}>
              {CONDITIONS.map(c => (
                <button
                  cssClasses={draft((d) => (d.effects.conditions ?? []).includes(c) ? ["re-toggle", "active"] : ["re-toggle"])}
                  onClicked={() => {
                    const cur = new Set(draft.get().effects.conditions ?? [])
                    if (cur.has(c)) cur.delete(c); else cur.add(c)
                    const arr = [...cur]
                    const e = { ...draft.get().effects }
                    if (arr.length) e.conditions = arr; else delete e.conditions
                    patch({ effects: e })
                  }}
                >
                  <label label={COND_LABEL[c] ?? c} />
                </button>
              ))}
            </box>
          </Field>
        </box>
      </Gtk.ScrolledWindow>

      {/* validation errors (shown when Save is blocked) */}
      <label
        cssClasses={["re-error"]}
        visible={errors((e) => e.length > 0)}
        label={errors((e) => e.join("\n"))}
        wrap={true}
        halign={Gtk.Align.START}
      />

      {/* footer */}
      <box spacing={6}>
        <button cssClasses={["re-save"]} onClicked={save} hexpand><label label={textos.editor.acciones.guardar} /></button>
        <button
          cssClasses={["re-delete"]}
          tooltipText={isBuiltin ? textos.editor.acciones.restaurarAyuda : textos.editor.acciones.borrarAyuda}
          onClicked={del}
        >
          <label label={isBuiltin ? textos.editor.acciones.revertir : textos.editor.acciones.borrar} />
        </button>
      </box>
    </box>
  )
}
