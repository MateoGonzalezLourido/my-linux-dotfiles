// modulos/notificaciones/settings/SettingsTabs.tsx
import { Gtk } from "ags/gtk4"
import { createState, With } from "ags"
import AppsTab from "./AppsTab.tsx"
import HistoryTab from "./HistoryTab.tsx"
import RulesTab from "./RulesTab.tsx"
import SistemaTab from "./SistemaTab.tsx"
import GeneralTab from "./GeneralTab.tsx"
import { TituloSeccion } from "../../ajustes/componentes"
import textos from "../../../textos/ajustes/notificaciones.json" with { type: "json" }

type TabId = "general" | "apps" | "sistema" | "history" | "rules"
// «Sistema» va antes que «Detectadas» y «Reglas» porque es la lista cerrada y conocida —los
// avisos que trae el propio equipo—, mientras que las otras dos dependen de lo que hayan
// mandado las apps.
const TABS: { id: TabId; label: string }[] = [
  { id: "general", label: textos.pestanas.general },
  { id: "apps", label: textos.pestanas.apps },
  { id: "sistema", label: textos.pestanas.sistema },
  { id: "history", label: textos.pestanas.sinReglas },
  { id: "rules", label: textos.pestanas.reglas },
]

/** `mostrarTitulo` existe porque estas pestañas se montan en DOS sitios con cabeceras distintas:
 *  en Ajustes > Notificaciones, donde el «✦ Notificaciones» es el título de la sección igual que
 *  en el resto de secciones; y en la ventana propia (`SettingsWindow`), que ya rotula
 *  «Ajustes de notificaciones» encima y ahí el título repetido sobra. */
export default function SettingsTabs({ mostrarTitulo = true }: { mostrarTitulo?: boolean } = {}) {
  const [tab, setTab] = createState<TabId>("general")
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={10} cssClasses={["sp-section"]} hexpand vexpand>
      {mostrarTitulo && <TituloSeccion titulo={textos.seccion.titulo} />}
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
          if (current === "sistema") return <SistemaTab />
          if (current === "history") return <HistoryTab />
          return <RulesTab />
        }}
      </With>
    </box>
  )
}
