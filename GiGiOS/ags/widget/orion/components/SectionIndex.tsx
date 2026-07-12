import { Gtk } from "ags/gtk4"
import { activeSection, setSection, type SectionId } from "../state"

interface SectionIndexItem {
  id: string
  label: string
  icon: string
  target: SectionId
}

// Índice único de Orion. Los antiguos accesos de Inicio viven aquí; los alias
// que apuntaban a una misma página (como SSH → workflows) no se duplican.
const SECTIONS: SectionIndexItem[] = [
  { id: "inicio",    label: "Inicio",    icon: "go-home-symbolic",                       target: "inicio" },
  { id: "apps",      label: "Apps",      icon: "view-app-grid-symbolic",                  target: "apps" },
  { id: "workflows", label: "Workflows", icon: "view-grid-symbolic",                      target: "workflows" },
  { id: "rice",      label: "Temas",     icon: "preferences-desktop-theme-symbolic",      target: "rice" },
  { id: "env",       label: "Env",       icon: "preferences-system-symbolic",             target: "env" },
  { id: "watcher",   label: "Watcher",   icon: "camera-photo-symbolic",                   target: "watcher" },
  { id: "keybinds",  label: "Keybinds",  icon: "input-keyboard-symbolic",                 target: "keybinds" },
  { id: "ai",        label: "AI Hub",    icon: "applications-science-symbolic",           target: "ai" },
  { id: "git",       label: "Git",       icon: "vcs-branch-symbolic",                     target: "git" },
]

export default function SectionIndex() {
  return (
    <box cssClasses={["section-index"]} hexpand>
      <scrolledwindow
        cssClasses={["section-index-scroll"]}
        hexpand
        vscrollbarPolicy={Gtk.PolicyType.NEVER}
        hscrollbarPolicy={Gtk.PolicyType.EXTERNAL}
      >
        <Gtk.EventControllerScroll
          flags={Gtk.EventControllerScrollFlags.VERTICAL}
          onScroll={(self: Gtk.EventControllerScroll, _dx: number, dy: number) => {
            const widget = self.get_widget() as Gtk.ScrolledWindow
            const adjustment = widget.get_hadjustment()
            adjustment.set_value(adjustment.get_value() + dy * 40)
            return true
          }}
        />
        <box cssClasses={["section-index-row"]} spacing={2}>
          {SECTIONS.map(section => (
            <button
              cssClasses={activeSection(current => current === section.target
                ? ["section-index-btn", "active"]
                : ["section-index-btn"])}
              tooltipText={section.label}
              onClicked={() => setSection(section.target)}
            >
              <box spacing={5}>
                <image iconName={section.icon} />
                <label label={section.label} />
              </box>
            </button>
          ))}
        </box>
      </scrolledwindow>
    </box>
  )
}
