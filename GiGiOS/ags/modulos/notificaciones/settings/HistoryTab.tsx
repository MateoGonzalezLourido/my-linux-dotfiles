// modulos/notificaciones/settings/HistoryTab.tsx
import { Gtk } from "ags/gtk4"
import { createState, For, With } from "ags"
import type { NotifRule } from "../rules/types.ts"
import { historyEntries } from "../history/historyStore.ts"
import type { HistoryEntry } from "../history/historyLogic.ts"
import { ruleFromHistoryEntry } from "./ruleFactory.ts"
import RuleEditor from "./RuleEditor.tsx"
import AppFilterBar from "./AppFilterBar.tsx"
import EmptyState from "../../../componentes/EmptyState.tsx"
import { notifDaemonConflict, type DaemonConflict } from "../daemon/comprobacion.ts"
import BannerConflicto from "../daemon/BannerConflicto.tsx"
import textos from "../../../textos/ajustes/notificaciones.json" with { type: "json" }

export default function HistoryTab() {
  const [editing, setEditing] = createState<NotifRule | null>(null)
  const empty = historyEntries((e) => (e?.length ?? 0) === 0)
  const [filter, setFilter] = createState<string>("all")
  const apps = historyEntries((es) => Array.from(new Set((es ?? []).map(e => e.app))).sort((a, b) => a.localeCompare(b)))

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} hexpand vexpand>
      <With value={editing}>
        {(e: NotifRule | null) => e
          ? <RuleEditor rule={e} onClose={() => setEditing(null)} />
          : <box orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand vexpand>
              <label cssClasses={["st-tab-hint"]} label={textos.sinReglas.cabecera} halign={Gtk.Align.START} />

              <With value={empty}>
                {(isEmpty: boolean) => isEmpty
                  // Vacío tiene dos causas MUY distintas: no ha pasado nada, o no somos el
                  // servidor de notificaciones y no llega nada que guardar. Distinguirlas aquí
                  // es el punto: es en esta pantalla donde se mira cuando "no guarda nada".
                  ? <With value={notifDaemonConflict}>
                      {(c: DaemonConflict | null) => c
                        ? BannerConflicto({
                            conflict: c,
                            wrapClass: "ns-empty-state",
                            iconClass: "ns-empty-icon",
                            titleClass: "ns-empty-label",
                            subClass: "ns-empty-sub",
                            vexpand: true,
                          })
                        : <EmptyState
                            icon="󰂚"
                            title={textos.sinReglas.vacio}
                            wrapClass="ns-empty-state"
                            iconClass="ns-empty-icon"
                            titleClass="ns-empty-label"
                            vexpand
                          />
                      }
                    </With>
                  : <box orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand vexpand>
                      <AppFilterBar apps={apps} active={filter} onSelect={setFilter} />
                      <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} hexpand vexpand>
                        <box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
                          <For each={historyEntries}>
                            {(entry: HistoryEntry) => (
                              <box cssClasses={["re-row"]} spacing={8} valign={Gtk.Align.CENTER} visible={filter((f) => f === "all" || f === entry.app)} hexpand>
                                <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
                                  <label cssClasses={["re-row-name"]} label={entry.app} halign={Gtk.Align.START} ellipsize={3} />
                                  <label cssClasses={["re-row-summary"]} label={entry.summary || textos.sinReglas.sinTitulo} halign={Gtk.Align.START} ellipsize={3} />
                                  {entry.sampleBody && <label cssClasses={["re-row-body"]} label={entry.sampleBody} halign={Gtk.Align.START} ellipsize={3} />}
                                </box>
                                <button cssClasses={["st-add-btn"]} onClicked={() => setEditing(ruleFromHistoryEntry(`user.${Date.now()}`, entry))}>
                                  <label label={textos.sinReglas.crearRegla} />
                                </button>
                              </box>
                            )}
                          </For>
                        </box>
                      </Gtk.ScrolledWindow>
                    </box>
                }
              </With>
            </box>
        }
      </With>
    </box>
  )
}
