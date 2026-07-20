// widget/notifications/settings/SettingsTabs.tsx
import { Gtk } from "ags/gtk4"
import { createState, With } from "ags"
import AppsTab from "./AppsTab.tsx"
import HistoryTab from "./HistoryTab.tsx"
import RulesTab from "./RulesTab.tsx"
import GeneralTab from "./GeneralTab.tsx"
import { TituloSeccion } from "../../settings/componentes"
import textos from "../../../textos/ajustes/notificaciones.json" with { type: "json" }

type TabId = "general" | "apps" | "history" | "rules"
const TABS: { id: TabId; label: string }[] = [
  { id: "general", label: textos.pestanas.general },
  { id: "apps", label: textos.pestanas.apps },
  { id: "history", label: textos.pestanas.sinReglas },
  { id: "rules", label: textos.pestanas.reglas },
]

export default function SettingsTabs() {
  const [tab, setTab] = createState<TabId>("general")
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-section"]} hexpand vexpand>
      <TituloSeccion titulo={textos.seccion.titulo} />
      <box cssClasses={["st-tabbar"]} spacing={4} hexpand>
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
          if (current === "general") return <GeneralTab />
          if (current === "apps") return <AppsTab />
          if (current === "history") return <HistoryTab />
          return <RulesTab />
        }}
      </With>
    </box>
  )
}
