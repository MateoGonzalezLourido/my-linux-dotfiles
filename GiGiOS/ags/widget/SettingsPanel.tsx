// widget/SettingsPanel.tsx
// General settings window opened from the QuickSettings gear. Same full-screen backdrop + centered
// panel style as the notification settings window, but navigation is a vertical list on the LEFT.
// Content is wrapped in <With> so it is built fresh on open and torn down on close.
import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { With, createState } from "ags"
import { settingsPanelVisible, setSettingsPanelVisible } from "./state"
import EnergySection from "./power/EnergySection"
import SettingsTabs from "./notifications/settings/SettingsTabs"
import PersonalizationSection from "./settings/PersonalizationSection"
import DisplaySection from "./settings/DisplaySection"
import SystemSection from "./settings/SystemSection"
import SecuritySection from "./settings/SecuritySection"
import AccountSection from "./settings/AccountSection"
import DevicesSection from "./settings/DevicesSection"
import DateLanguageSection from "./settings/DateLanguageSection"
import AppsSection from "./settings/AppsSection"

type SectionId = "account" | "energy" | "display" | "devices" | "datetime" | "apps" | "system" | "security" | "notifications" | "personalization"
const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "account", label: "Cuenta", icon: "󰀄" },
  { id: "energy", label: "Energía", icon: "󰁹" },
  { id: "display", label: "Pantalla", icon: "󰍹" },
  { id: "devices", label: "Dispositivos", icon: "󰓢" },
  { id: "datetime", label: "Fecha e idioma", icon: "󰃭" },
  { id: "apps", label: "Apps", icon: "󰀻" },
  { id: "system", label: "Sistema", icon: "󰌢" },
  { id: "security", label: "Seguridad", icon: "󰒃" },
  { id: "notifications", label: "Notificaciones", icon: "󰂚" },
  { id: "personalization", label: "Personalización", icon: "󰏘" },
]

export default function SettingsPanel(gdkmonitor: Gdk.Monitor) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  const [section, setSection] = createState<SectionId>("account")

  const panel = (
    <box cssClasses={["sp-panel"]} orientation={Gtk.Orientation.HORIZONTAL} spacing={0} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
      {/* left vertical nav */}
      <box cssClasses={["sp-nav"]} orientation={Gtk.Orientation.VERTICAL} spacing={4}>
        <label cssClasses={["sp-nav-title"]} label="Ajustes" halign={Gtk.Align.START} />
        {SECTIONS.map(s => (
          <button
            cssClasses={section((cur) => cur === s.id ? ["sp-nav-item", "active"] : ["sp-nav-item"])}
            onClicked={() => setSection(s.id)}
          >
            <box spacing={10} valign={Gtk.Align.CENTER}>
              <label cssClasses={["sp-nav-icon"]} label={s.icon} />
              <label label={s.label} hexpand halign={Gtk.Align.START} />
            </box>
          </button>
        ))}
      </box>

      {/* content (scrollable: algunas secciones —Pantalla— son más altas que el panel) */}
      <Gtk.ScrolledWindow
        cssClasses={["sp-content"]}
        hexpand
        vexpand
        heightRequest={700}
        propagateNaturalHeight={false}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.EXTERNAL}
      >
        <box orientation={Gtk.Orientation.VERTICAL} hexpand>
          <With value={section}>
            {(s: SectionId) => {
              if (s === "account") return <AccountSection />
              if (s === "energy") return <EnergySection />
              if (s === "display") return <DisplaySection />
              if (s === "devices") return <DevicesSection />
              if (s === "datetime") return <DateLanguageSection />
              if (s === "apps") return <AppsSection />
              if (s === "system") return <SystemSection />
              if (s === "security") return <SecuritySection />
              if (s === "notifications") return <SettingsTabs />
              return <PersonalizationSection />
            }}
          </With>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  ) as unknown as Gtk.Widget

  return (
    <window
      name="settings-panel"
      visible={settingsPanelVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      application={app}
      cssClasses={["sp-window"]}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) { setSettingsPanelVisible(false); return true }
          return false
        }}
      />
      <box cssClasses={["sp-backdrop"]} hexpand vexpand>
        <Gtk.GestureClick
          onPressed={(self: Gtk.GestureClick, _n: number, x: number, y: number) => {
            const backdrop = self.get_widget() as Gtk.Widget
            const hit = backdrop.pick(x, y, 0)
            let w: Gtk.Widget | null = hit
            while (w && w !== backdrop) {
              if (w === panel) return
              w = w.get_parent()
            }
            setSettingsPanelVisible(false)
          }}
        />
        {panel as unknown as any}
      </box>
    </window>
  )
}
