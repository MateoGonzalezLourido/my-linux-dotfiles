// modulos/notificaciones/settings/RuleEditor.tsx
// Form editor for a single rule. No JSON exposed. Mounted fresh per edit.
import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import type { NotifRule, Lifetime, DedupKeySpec, PopupStyle } from "../rules/types.ts"
import { NOTIF_FIELDS } from "../rules/notifFields.ts"
import { parseDuration, formatDuration } from "../rules/duration.ts"
import { upsertUserRule, removeUserRule, setBuiltinOverride, clearBuiltinOverride } from "../rules/rulesStore.ts"
import { validateRule } from "../rules/validate.ts"
import ColorPicker from "./ColorPicker.tsx"
import CampoCoincidencia from "./CampoCoincidencia.tsx"
import CamposReescritura, { type CampoReescrituraId } from "./CamposReescritura.tsx"
import { AlternadorEditor, CampoEditor } from "./ControlesEditor.tsx"
import textos from "../../../textos/ajustes/notificaciones.json" with { type: "json" }
import { formatearTexto } from "../../../textos/formatear.ts"

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
  const updateRewrite = (which: CampoReescrituraId, val: string | undefined) => {
    const cur: { appName?: string; summary?: string; body?: string } = { ...(draft.get().effects.rewrite ?? {}) }
    if (val === undefined) delete cur[which]; else cur[which] = val
    const e = { ...draft.get().effects }
    if (cur.appName === undefined && cur.summary === undefined && cur.body === undefined) delete e.rewrite
    else e.rewrite = cur
    patch({ effects: e })
  }
  const setRewriteText = (which: CampoReescrituraId, text: string) => updateRewrite(which, text ? text : undefined)
  const setRewriteClear = (which: CampoReescrituraId, clear: boolean) => updateRewrite(which, clear ? "" : undefined)
  const isBuiltin = rule.source === "builtin"
  const isNew = !isBuiltin
    && rule.name === textos.resumen.nuevaRegla
    && Object.keys(rule.match).length === 0
    && Object.keys(rule.effects).length === 0

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
          <CampoEditor titulo={textos.editor.titulos.nombre}>
            <Gtk.Entry cssClasses={["re-entry"]} text={rule.name} onChanged={(self) => patch({ name: self.text })} />
          </CampoEditor>

          <label cssClasses={["re-section"]} label={textos.editor.titulos.cuando} halign={Gtk.Align.START} />
          <label
            cssClasses={["re-hint"]}
            label={textos.editor.ayudas.cuando}
            halign={Gtk.Align.START}
            wrap={true}
          />
          <CampoCoincidencia campo="app" titulo={textos.editor.titulos.aplicacion} borrador={draft} actualizarMatch={patchMatch} reemplazarMatch={(match) => patch({ match })} />
          <CampoCoincidencia campo="summary" titulo={textos.editor.titulos.titulo} borrador={draft} actualizarMatch={patchMatch} reemplazarMatch={(match) => patch({ match })} />
          <CampoCoincidencia campo="body" titulo={textos.editor.titulos.cuerpo} borrador={draft} actualizarMatch={patchMatch} reemplazarMatch={(match) => patch({ match })} />
          {/* «system» = viene de un script de hypr/scripts (hint x-gigios-source). Es lo que casa
              la builtin del skin dunst; sin este campo esa regla no se podría editar desde aquí. */}
          <CampoCoincidencia campo="source" titulo={textos.editor.titulos.origen} borrador={draft} actualizarMatch={patchMatch} reemplazarMatch={(match) => patch({ match })} />

          <label cssClasses={["re-section"]} label={textos.editor.titulos.acciones} halign={Gtk.Align.START} />
          {/* lifetime */}
          <CampoEditor titulo={textos.editor.titulos.ciclo}>
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
          </CampoEditor>

          {/* clear on reboot — independent flag; combinable with any lifetime (flash, timed, …) */}
          <box spacing={4} cssClasses={["re-field"]}>
            <AlternadorEditor
              label={textos.editor.acciones.limpiarReinicio}
              estado={draft}
              activo={() => !!draft.get().effects.clearOnBoot}
              onChange={(v) => patchEffects({ clearOnBoot: v })}
            />
          </box>

          {/* ttl (only when timed) */}
          <CampoEditor titulo={textos.editor.titulos.expira} visible={draft((d) => d.effects.lifetime === "timed")}>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.ttlMs ? formatDuration(rule.effects.ttlMs) : ""}
              placeholderText={textos.editor.ayudas.duracion}
              onChanged={(self) => patchEffects({ ttlMs: parseDuration(self.text) ?? undefined })}
            />
          </CampoEditor>

          {/* effect toggles */}
          <box spacing={4} cssClasses={["re-field"]}>
            <AlternadorEditor label={textos.editor.acciones.descartar} estado={draft} activo={() => !!draft.get().effects.suppress} onChange={(v) => patchEffects({ suppress: v })} />
            <AlternadorEditor label={textos.editor.acciones.sinPopup} estado={draft} activo={() => !!draft.get().effects.dontShow} onChange={(v) => patchEffects({ dontShow: v })} />
            <AlternadorEditor label={textos.editor.acciones.sinAudio} estado={draft} activo={() => !!draft.get().effects.muteAudio} onChange={(v) => patchEffects({ muteAudio: v })} />
            <AlternadorEditor label={textos.editor.acciones.sinHistorial} estado={draft} activo={() => !!draft.get().effects.noHistory} onChange={(v) => patchEffects({ noHistory: v })} />
          </box>
          <label
            cssClasses={["re-hint"]}
            label={textos.editor.ayudas.efectos}
            halign={Gtk.Align.START}
            wrap={true}
          />

          {/* accent color */}
          <CampoEditor titulo={textos.editor.titulos.color}>
            <ColorPicker
              value={rule.effects.color}
              onChange={(hex) => {
                const e = { ...draft.get().effects }
                if (hex) e.color = hex; else delete e.color
                patch({ effects: e })
              }}
            />
          </CampoEditor>

          {/* popup skin */}
          <CampoEditor titulo={textos.editor.titulos.estilo}>
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
          </CampoEditor>

          {/* dedup key */}
          <CampoEditor titulo={textos.editor.titulos.duplicadas}>
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
          </CampoEditor>

          <label cssClasses={["re-section"]} label={textos.editor.titulos.reescritura} halign={Gtk.Align.START} />
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            <CamposReescritura
              reglaInicial={rule}
              borrador={draft}
              cambiarTexto={setRewriteText}
              cambiarVaciado={setRewriteClear}
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
          <CampoEditor titulo={textos.editor.titulos.condiciones} visible={advanced((a) => a)}>
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
          </CampoEditor>
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
