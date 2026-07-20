// widget/SettingsPanel.tsx
// General settings window opened from the QuickSettings gear. Same full-screen backdrop + centered
// panel style as the notification settings window, but navigation is a vertical list on the LEFT.
// Content is wrapped in <With> so it is built fresh on open and torn down on close.
import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { With, createState } from "ags"
import { settingsPanelVisible, setSettingsPanelVisible, privilegedPromptActive } from "./state"
import EnergySection from "./power/EnergySection"
import SettingsTabs from "./notifications/settings/SettingsTabs"
import DisplaySection from "./settings/DisplaySection"
import SystemSection from "./settings/SystemSection"
import SecuritySection from "./settings/SecuritySection"
import AccountSection from "./settings/AccountSection"
import DevicesSection from "./settings/DevicesSection"
import DateLanguageSection from "./settings/DateLanguageSection"
import BarraEscritoriosSection from "./settings/BarraEscritoriosSection"
import FuncionesShellSection from "./settings/FuncionesShellSection"
import JuegosSection from "./settings/JuegosSection"
import AccessibilitySection from "./settings/AccessibilitySection"
import textos from "../textos/ajustes/general.json" with { type: "json" }

type SectionId =
  | "account" | "language" | "datetime" | "location"
  | "display" | "accessibility" | "personalization" | "mouse" | "touchpad" | "keyboard" | "printers" | "energy" | "games"
  | "bar" | "workspaces" | "orion" | "clipboard" | "notifications"
  | "monitoring" | "scans" | "supervision" | "system"
type SeccionNavegacion = { id: SectionId; label: string; icon: string }
const SECCIONES_NAVEGACION: SeccionNavegacion[] = [
  { id: "account", label: textos.secciones.cuenta, icon: "󰀄" },
  { id: "language", label: textos.secciones.idiomaRegion, icon: "󰗊" },
  { id: "datetime", label: textos.secciones.fechaHora, icon: "󰃭" },
  { id: "location", label: textos.secciones.ubicacion, icon: "󰍎" },
  { id: "display", label: textos.secciones.pantalla, icon: "󰍹" },
  { id: "accessibility", label: textos.secciones.accesibilidad, icon: "󰦧" },
  { id: "personalization", label: textos.secciones.personalizacion, icon: "󰏘" },
  { id: "mouse", label: textos.secciones.ratonPuntero, icon: "󰍽" },
  { id: "touchpad", label: textos.secciones.touchpad, icon: "󰟸" },
  { id: "keyboard", label: textos.secciones.teclado, icon: "󰌌" },
  { id: "printers", label: textos.secciones.impresoras, icon: "󰐪" },
  { id: "energy", label: textos.secciones.energia, icon: "󰁹" },
  { id: "games", label: textos.secciones.juegos, icon: "󰊴" },
  { id: "bar", label: textos.secciones.barra, icon: "󰍜" },
  { id: "workspaces", label: textos.secciones.workspaces, icon: "󰆾" },
  { id: "orion", label: textos.secciones.orion, icon: "󰆍" },
  { id: "clipboard", label: textos.secciones.portapapeles, icon: "󰅇" },
  { id: "notifications", label: textos.secciones.notificaciones, icon: "󰂚" },
  { id: "monitoring", label: textos.secciones.vigilancia, icon: "󰒃" },
  { id: "scans", label: textos.secciones.escaneos, icon: "󰇚" },
  { id: "supervision", label: textos.secciones.supervision, icon: "󰓅" },
  { id: "system", label: textos.secciones.sistema, icon: "󰌢" },
]

export default function SettingsPanel(gdkmonitor: Gdk.Monitor) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  const [section, setSection] = createState<SectionId>("account")
  let contenidoDesplazable: Gtk.ScrolledWindow

  const panel = (
    <box cssClasses={["sp-panel"]} orientation={Gtk.Orientation.HORIZONTAL} spacing={0} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
      {/* left vertical nav */}
      <box cssClasses={["sp-nav"]} orientation={Gtk.Orientation.VERTICAL} spacing={4}>
        <label cssClasses={["sp-nav-title"]} label={textos.panel.titulo} halign={Gtk.Align.START} />
        <Gtk.ScrolledWindow cssClasses={["sp-nav-scroll"]} vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.NEVER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
            {SECCIONES_NAVEGACION.map(s => (
              <button
                    cssClasses={section((cur) => cur === s.id ? ["sp-nav-item", "active"] : ["sp-nav-item"])}
                    onClicked={() => {
                      setSection(s.id)
                      contenidoDesplazable?.get_vadjustment().set_value(0)
                    }}
                    valign={Gtk.Align.CENTER}
                    overflow={Gtk.Overflow.VISIBLE}
                  >
                    <box cssClasses={["sp-nav-content"]} spacing={10} valign={Gtk.Align.CENTER} heightRequest={24} overflow={Gtk.Overflow.VISIBLE}>
                      <label cssClasses={["sp-nav-icon"]} label={s.icon} valign={Gtk.Align.CENTER} heightRequest={22} overflow={Gtk.Overflow.VISIBLE} />
                      <label cssClasses={["sp-nav-label"]} label={s.label} hexpand halign={Gtk.Align.START} valign={Gtk.Align.CENTER} heightRequest={22} overflow={Gtk.Overflow.VISIBLE} />
                    </box>
              </button>
            ))}
          </box>
        </Gtk.ScrolledWindow>
      </box>

      {/* content (scrollable: algunas secciones —Pantalla— son más altas que el panel) */}
      <Gtk.ScrolledWindow
        cssClasses={["sp-content"]}
        $={(self: Gtk.ScrolledWindow) => { contenidoDesplazable = self }}
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
              if (s === "games") return <JuegosSection />
              if (s === "display") return <DisplaySection />
              if (s === "accessibility") return <AccessibilitySection />
              if (s === "language") return <DateLanguageSection vista="idioma" />
              if (s === "datetime") return <DateLanguageSection vista="fecha" />
              if (s === "location") return <DateLanguageSection vista="ubicacion" />
              if (s === "mouse") return <DevicesSection vista="raton" />
              if (s === "touchpad") return <DevicesSection vista="touchpad" />
              if (s === "keyboard") return <DevicesSection vista="teclado" />
              if (s === "printers") return <DevicesSection vista="impresoras" />
              if (s === "bar") return <BarraEscritoriosSection vista="barra" />
              if (s === "workspaces") return <BarraEscritoriosSection vista="workspaces" />
              if (s === "personalization") return <FuncionesShellSection vista="personalizacion" />
              if (s === "orion") return <FuncionesShellSection vista="orion" />
              if (s === "clipboard") return <FuncionesShellSection vista="portapapeles" />
              if (s === "monitoring") return <SecuritySection vista="vigilancia" />
              if (s === "scans") return <SecuritySection vista="escaneos" />
              if (s === "supervision") return <SystemSection vista="supervision" />
              if (s === "system") return <SystemSection vista="informacion" />
              return <SettingsTabs />
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
      // Mientras polkit pide la contraseña, esta ventana se aparta: una capa
      // OVERLAY tapa SIEMPRE al diálogo (es un toplevel normal) y obligaba a
      // cerrar Ajustes para poder escribir. Ver withPrivilegedPrompt en state.tsx.
      layer={privilegedPromptActive(a => a ? Astal.Layer.BOTTOM : Astal.Layer.OVERLAY)}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      // Y suelta el teclado: con ON_DEMAND la capa puede retener el foco y el
      // diálogo se quedaría sin recibir lo que teclees.
      keymode={privilegedPromptActive(a => a ? Astal.Keymode.NONE : Astal.Keymode.ON_DEMAND)}
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
