// widget/notifications/settings/SettingsTabs.tsx
import { Gtk } from "ags/gtk4"
import { createState, With } from "ags"
import AppsTab from "./AppsTab.tsx"
import HistoryTab from "./HistoryTab.tsx"
import RulesTab from "./RulesTab.tsx"

type TabId = "apps" | "history" | "rules"
const TABS: { id: TabId; label: string }[] = [
  { id: "apps", label: "Apps" },
  { id: "history", label: "Historial" },
  { id: "rules", label: "Reglas" },
]

export default function SettingsTabs() {
  const [tab, setTab] = createState<TabId>("apps")
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box cssClasses={["st-tabbar"]} spacing={4}>
        {TABS.map(t => (
          <button
            cssClasses={tab((cur) => cur === t.id ? ["st-tab", "active"] : ["st-tab"])}
            hexpand
            onClicked={() => setTab(t.id)}
          >
            <label label={t.label} />
          </button>
        ))}
      </box>
      <With value={tab}>
        {(current: TabId) => {
          if (current === "apps") return <AppsTab />
          if (current === "history") return <HistoryTab />
          return <RulesTab />
        }}
      </With>
    </box>
  )
}
