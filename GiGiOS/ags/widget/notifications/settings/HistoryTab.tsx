// widget/notifications/settings/HistoryTab.tsx
import { Gtk } from "ags/gtk4"
import { createState, For, With } from "ags"
import type { NotifRule } from "../rules/types.ts"
import { historyEntries } from "../history/historyStore.ts"
import type { HistoryEntry } from "../history/historyLogic.ts"
import { ruleFromHistoryEntry } from "./ruleFactory.ts"
import RuleEditor from "./RuleEditor.tsx"
import AppFilterBar from "./AppFilterBar.tsx"

export default function HistoryTab() {
  const [editing, setEditing] = createState<NotifRule | null>(null)
  const empty = historyEntries((e) => (e?.length ?? 0) === 0)
  const [filter, setFilter] = createState<string>("all")
  const apps = historyEntries((es) => Array.from(new Set((es ?? []).map(e => e.app))).sort((a, b) => a.localeCompare(b)))

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      <With value={editing}>
        {(e: NotifRule | null) => e
          ? <RuleEditor rule={e} onClose={() => setEditing(null)} />
          : <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
              <label cssClasses={["st-tab-hint"]} label="Tipos sin regla — crea una para gestionarlos" halign={Gtk.Align.START} />

              <With value={empty}>
                {(isEmpty: boolean) => isEmpty
                  ? <box orientation={Gtk.Orientation.VERTICAL} spacing={8} valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER} vexpand css="padding: 32px 0;">
                      <label cssClasses={["ns-empty-icon"]} label="󰂚" />
                      <label cssClasses={["ns-empty-label"]} label="Historial vacío" />
                    </box>
                  : <box orientation={Gtk.Orientation.VERTICAL} spacing={6} vexpand>
                      <AppFilterBar apps={apps} active={filter} onSelect={setFilter} />
                      <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vexpand>
                        <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                          <For each={historyEntries}>
                            {(entry: HistoryEntry) => (
                              <box cssClasses={["re-row"]} spacing={8} valign={Gtk.Align.CENTER} visible={filter((f) => f === "all" || f === entry.app)}>
                                <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
                                  <label cssClasses={["re-row-name"]} label={entry.app} halign={Gtk.Align.START} ellipsize={3} />
                                  <label cssClasses={["re-row-summary"]} label={entry.summary || "(sin título)"} halign={Gtk.Align.START} ellipsize={3} />
                                  {entry.sampleBody && <label cssClasses={["re-row-body"]} label={entry.sampleBody} halign={Gtk.Align.START} ellipsize={3} />}
                                </box>
                                <button cssClasses={["st-add-btn"]} onClicked={() => setEditing(ruleFromHistoryEntry(`user.${Date.now()}`, entry))}>
                                  <label label="󰐕 Regla" />
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
