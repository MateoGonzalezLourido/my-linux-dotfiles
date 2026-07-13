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

const OPS: StringMatch["op"][] = ["contains", "equals", "regex"]
const OP_LABEL: Record<StringMatch["op"], string> = { contains: "contiene", equals: "es igual a", regex: "regex" }
const LIFETIMES: (Lifetime | "none")[] = ["none", "flash", "timed", "persistent"]
const LIFE_LABEL: Record<string, string> = { none: "—", flash: "flash", timed: "temporal", "clear-on-boot": "borrar al reinicio", persistent: "persistente" }
const DEDUPS: ("app" | "app+summary" | "app+summary+body")[] = ["app", "app+summary", "app+summary+body"]
const DEDUP_LABEL: Record<string, string> = { "app": "por app", "app+summary": "por app + título", "app+summary+body": "por app + título + cuerpo" }
// "none" no es un PopupStyle: es "la regla no opina", y entonces decide el hint
// x-gigios-source de los scripts (sistema → dunst). Fijar "default" NO es lo mismo — eso saca
// del skin incluso a una notificación del sistema.
const STYLES: (PopupStyle | "none")[] = ["none", "default", "dunst"]
const STYLE_LABEL: Record<string, string> = { none: "—", default: "shell", dunst: "dunst" }
const CONDITIONS = ["battery-resolved", "superseded"]
const COND_LABEL: Record<string, string> = { "battery-resolved": "al cargar la batería", "superseded": "reemplazada por otra" }

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
          placeholderText="(vacío = ignorar este campo)"
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
        <label cssClasses={["ns-title"]} label={isBuiltin ? "Editar regla (del sistema)" : "Editar regla"} hexpand halign={Gtk.Align.START} />
        <button cssClasses={draft((d) => d.enabled ? ["re-toggle", "active"] : ["re-toggle"])} onClicked={() => patch({ enabled: !draft.get().enabled })}>
          <label label={draft((d) => d.enabled ? "Activa" : "Inactiva")} />
        </button>
      </box>

      <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vexpand>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={10}>
          {/* Name */}
          <Field title="Nombre">
            <Gtk.Entry cssClasses={["re-entry"]} text={rule.name} onChanged={(self) => patch({ name: self.text })} />
          </Field>

          <label cssClasses={["re-section"]} label="Cuándo aplica" halign={Gtk.Align.START} />
          <MatchField field="app" title="Aplicación" />
          <MatchField field="summary" title="Título" />
          <MatchField field="body" title="Cuerpo" />
          {/* «system» = viene de un script de hypr/scripts (hint x-gigios-source). Es lo que casa
              la builtin del skin dunst; sin este campo esa regla no se podría editar desde aquí. */}
          <MatchField field="source" title="Origen (system = scripts del sistema)" />

          <label cssClasses={["re-section"]} label="Qué hacer" halign={Gtk.Align.START} />
          {/* lifetime */}
          <Field title="Ciclo de vida">
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
          </Field>

          {/* clear on reboot — independent flag; combinable with any lifetime (flash, timed, …) */}
          <box spacing={4} cssClasses={["re-field"]}>
            <Toggle
              label="Limpiar tras reinicio del SO"
              get={() => !!draft.get().effects.clearOnBoot}
              set={(v) => patchEffects({ clearOnBoot: v })}
            />
          </box>

          {/* ttl (only when timed) */}
          <Field title="Expira tras" visible={draft((d) => d.effects.lifetime === "timed")}>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.ttlMs ? formatDuration(rule.effects.ttlMs) : ""}
              placeholderText="ej: 2d 4h 5min  ·  15min  ·  3h"
              onChanged={(self) => patchEffects({ ttlMs: parseDuration(self.text) ?? undefined })}
            />
          </Field>

          {/* effect toggles */}
          <box spacing={4} cssClasses={["re-field"]}>
            <Toggle label="Ocultar" get={() => !!draft.get().effects.suppress} set={(v) => patchEffects({ suppress: v })} />
            <Toggle label="Sin popup" get={() => !!draft.get().effects.dontShow} set={(v) => patchEffects({ dontShow: v })} />
            <Toggle label="Sin audio" get={() => !!draft.get().effects.muteAudio} set={(v) => patchEffects({ muteAudio: v })} />
            <Toggle label="Sin historial" get={() => !!draft.get().effects.noHistory} set={(v) => patchEffects({ noHistory: v })} />
          </box>

          {/* accent color */}
          <Field title="Color de acento">
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
          <Field title="Estilo del popup">
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
          </Field>

          {/* dedup key */}
          <Field title="Agrupar duplicados por">
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
          </Field>

          <label cssClasses={["re-section"]} label="Reescribir texto (opcional)" halign={Gtk.Align.START} />
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4} cssClasses={["re-field"]}>
            {/* nombre de la app */}
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label cssClasses={["re-field-label"]} label="Nombre de la app" hexpand halign={Gtk.Align.START} />
              <button
                cssClasses={draft((d) => d.effects.rewrite?.appName === "" ? ["re-toggle", "active"] : ["re-toggle"])}
                onClicked={() => setRewriteClear("appName", draft.get().effects.rewrite?.appName !== "")}
              ><label label="Ocultar" /></button>
            </box>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.appName && rule.effects.rewrite.appName !== "" ? rule.effects.rewrite.appName : ""}
              placeholderText="(vacío = sin cambios)"
              sensitive={draft((d) => d.effects.rewrite?.appName !== "")}
              onChanged={(self) => { if (draft.get().effects.rewrite?.appName === "") return; setRewriteText("appName", self.text) }}
            />

            {/* título */}
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label cssClasses={["re-field-label"]} label="Nuevo título" hexpand halign={Gtk.Align.START} />
              <button
                cssClasses={draft((d) => d.effects.rewrite?.summary === "" ? ["re-toggle", "active"] : ["re-toggle"])}
                onClicked={() => setRewriteClear("summary", draft.get().effects.rewrite?.summary !== "")}
              ><label label="Vaciar" /></button>
            </box>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.summary && rule.effects.rewrite.summary !== "" ? rule.effects.rewrite.summary : ""}
              placeholderText="(vacío = sin cambios)"
              sensitive={draft((d) => d.effects.rewrite?.summary !== "")}
              onChanged={(self) => { if (draft.get().effects.rewrite?.summary === "") return; setRewriteText("summary", self.text) }}
            />

            {/* cuerpo */}
            <box spacing={6} valign={Gtk.Align.CENTER}>
              <label cssClasses={["re-field-label"]} label="Nuevo cuerpo" hexpand halign={Gtk.Align.START} />
              <button
                cssClasses={draft((d) => d.effects.rewrite?.body === "" ? ["re-toggle", "active"] : ["re-toggle"])}
                onClicked={() => setRewriteClear("body", draft.get().effects.rewrite?.body !== "")}
              ><label label="Vaciar" /></button>
            </box>
            <Gtk.Entry
              cssClasses={["re-entry"]}
              text={rule.effects.rewrite?.body && rule.effects.rewrite.body !== "" ? rule.effects.rewrite.body : ""}
              placeholderText="(vacío = sin cambios)"
              sensitive={draft((d) => d.effects.rewrite?.body !== "")}
              onChanged={(self) => { if (draft.get().effects.rewrite?.body === "") return; setRewriteText("body", self.text) }}
            />

            <label
              cssClasses={["re-hint"]}
              label={`Campos: ${NOTIF_FIELDS.map(f => "{" + f.key + "}").join("  ")}  ·  y cualquier dato extra de la notificación como {clave}`}
              halign={Gtk.Align.START}
              wrap={true}
            />
          </box>

          {/* advanced: conditions */}
          <button cssClasses={["re-advanced-toggle"]} onClicked={() => setAdvanced(!advanced.get())}>
            <label label={advanced((a) => a ? "󰅀 Avanzado" : "󰅂 Avanzado")} halign={Gtk.Align.START} />
          </button>
          <Field title="Condiciones dinámicas" visible={advanced((a) => a)}>
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
        <button cssClasses={["re-save"]} onClicked={save} hexpand><label label="Guardar" /></button>
        <button cssClasses={["re-delete"]} onClicked={del}>
          <label label={isBuiltin ? "Revertir" : "Borrar"} />
        </button>
      </box>
    </box>
  )
}
