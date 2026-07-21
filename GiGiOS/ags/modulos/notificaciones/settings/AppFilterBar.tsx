// modulos/notificaciones/settings/AppFilterBar.tsx
// Reusable app-filter chip row, mirroring the notification panel's AppFilterChips.
// "Todas" chip + a horizontal-scrolling list of app chips. Reuses the .np-filter-* styles.
import { Gtk } from "ags/gtk4"
import { For, type Accessor } from "ags"
import textos from "../../../textos/ajustes/notificaciones.json" with { type: "json" }

export default function AppFilterBar(props: {
  apps: Accessor<string[]>
  active: Accessor<string>
  onSelect: (app: string) => void
}) {
  return (
    <box cssClasses={["np-filter-row"]} spacing={2}>
      <button
        cssClasses={props.active((f) => f === "all" ? ["np-filter-chip", "active"] : ["np-filter-chip"])}
        onClicked={() => props.onSelect("all")}
      >
        <label label={textos.sinReglas.todas} cssClasses={["np-filter-chip-label"]} />
      </button>

      <Gtk.ScrolledWindow
        cssClasses={["np-filter-scroll"]}
        hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vscrollbarPolicy={Gtk.PolicyType.NEVER}
        kineticScrolling={false}
        propagateNaturalHeight={true}
        hexpand
      >
        <box spacing={2}>
          <For each={props.apps}>
            {(appName: string) => (
              <button
                cssClasses={props.active((f) => f === appName ? ["np-filter-chip", "active"] : ["np-filter-chip"])}
                onClicked={() => props.onSelect(appName)}
              >
                <label label={appName} cssClasses={["np-filter-chip-label"]} />
              </button>
            )}
          </For>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}
