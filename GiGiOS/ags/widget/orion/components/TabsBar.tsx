import { Gtk } from "ags/gtk4"
import { For } from "ags"
import {
  pinnedTabs, activeTabId, setActiveTab, closeTab, PinnedTab, TabType,
  orionTasks, taskPanelUserEnabled, toggleTaskPanel, setSection,
} from "../state"
import {
  saveProfile, loadProfiles, restoreProfile, deleteProfile, clearSession
} from "../ProfileManager"

const TAB_META: Record<TabType, { icon: string }> = {
  home:    { icon: "go-home-symbolic" },
  image:   { icon: "image-x-generic-symbolic" },
  command: { icon: "utilities-terminal-symbolic" },
  calc:    { icon: "accessories-calculator-symbolic" },
  url:     { icon: "web-browser-symbolic" },
  file:    { icon: "text-x-generic-symbolic" },
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60)    return "ahora"
  if (diff < 3600)  return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  return `hace ${Math.floor(diff / 86400)}d`
}

function ProfileDropdown() {
  // Create entry imperatively — setup prop not supported on GtkEntry in this AGS version
  const nameEntry = new Gtk.Entry()
  nameEntry.set_css_classes(["pd-input"])
  nameEntry.placeholder_text = "nombre del perfil…"
  nameEntry.max_length = 24
  nameEntry.hexpand = true

  // Create profile list box imperatively
  const profileListBox = new Gtk.Box()
  profileListBox.set_orientation(Gtk.Orientation.VERTICAL)

  function refreshList() {
    let child = profileListBox.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      profileListBox.remove(child)
      child = next
    }
    loadProfiles().forEach(profile => {
      const row = (
        <box cssClasses={["pd-profile-item"]} spacing={8}>
          <box cssClasses={["pd-profile-dot"]} />
          <box orientation={Gtk.Orientation.VERTICAL} hexpand>
            <label
              label={profile.name}
              halign={Gtk.Align.START}
              cssClasses={["pd-profile-name"]}
              maxWidthChars={20}
              ellipsize={3}
            />
            <label
              label={`${profile.tabs.length} tabs · ${relativeTime(profile.savedAt)}`}
              halign={Gtk.Align.START}
              cssClasses={["pd-profile-meta"]}
            />
          </box>
          <button
            cssClasses={["pd-pa"]}
            onClicked={() => restoreProfile(profile)}
          >
            <image iconName="document-open-symbolic" />
          </button>
          <button
            cssClasses={["pd-pa", "pd-pa-del"]}
            onClicked={() => {
              deleteProfile(profile.name)
              refreshList()
            }}
          >
            <image iconName="user-trash-symbolic" />
          </button>
        </box>
      ) as unknown as Gtk.Widget
      profileListBox.append(row)
    })
    profileListBox.show()
  }

  refreshList()

  const content = (
    <box cssClasses={["profile-dropdown"]} orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      <label cssClasses={["pd-header"]} label="perfiles de sesión" halign={Gtk.Align.START} />

      <box cssClasses={["pd-save-input"]} spacing={6}>
        {nameEntry}
        <button
          cssClasses={["pd-confirm"]}
          onClicked={() => {
            saveProfile(nameEntry.text || undefined)
            nameEntry.text = ""
            refreshList()
          }}
        >
          <image iconName="object-select-symbolic" />
        </button>
      </box>

      <button cssClasses={["pd-action"]} onClicked={() => nameEntry.grab_focus()}>
        <box spacing={8}>
          <box cssClasses={["pd-action-ico", "pdai-save"]}>
            <image iconName="document-save-symbolic" />
          </box>
          <box orientation={Gtk.Orientation.VERTICAL}>
            <label cssClasses={["pd-action-name"]} label="guardar sesión" halign={Gtk.Align.START} />
            <label cssClasses={["pd-action-sub"]} label="tabs + sección → disco" halign={Gtk.Align.START} />
          </box>
        </box>
      </button>

      <button cssClasses={["pd-action", "pd-action-danger"]} onClicked={() => clearSession()}>
        <box spacing={8}>
          <box cssClasses={["pd-action-ico", "pdai-clear"]}>
            <image iconName="user-trash-symbolic" />
          </box>
          <box orientation={Gtk.Orientation.VERTICAL}>
            <label cssClasses={["pd-action-name"]} label="limpiar sesión" halign={Gtk.Align.START} />
            <label cssClasses={["pd-action-sub"]} label="cierra tabs · libera ram" halign={Gtk.Align.START} />
          </box>
        </box>
      </button>

      <label cssClasses={["pd-profiles-label"]} label="guardados" halign={Gtk.Align.START} />
      {profileListBox}
    </box>
  )

  const popover = new Gtk.Popover()
  // AGS JSX always produces GtkWidget instances; cast needed for TS type checker
  popover.set_child(content as unknown as Gtk.Widget)

  return (
    <menubutton cssClasses={["profile-btn"]} popover={popover}>
      <image iconName="view-list-symbolic" />
    </menubutton>
  )
}

export default function TabsBar() {
  // Tasks panel toggle button — imperative to subscribe to two states
  const tasksImg = new Gtk.Image()
  tasksImg.set_from_icon_name("system-run-symbolic")

  const tasksBtn = new Gtk.Button()
  tasksBtn.set_child(tasksImg)
  tasksBtn.set_css_classes(["j-tab", "j-tasks-btn"])
  tasksBtn.connect("clicked", () => toggleTaskPanel())

  function refreshTasksBtnClasses() {
    const has = orionTasks.get().length > 0
    const open = taskPanelUserEnabled.get()
    const cls = ["j-tab", "j-tasks-btn"]
    if (has) cls.push("has-tasks")
    if (open) cls.push("active")
    tasksBtn.set_css_classes(cls)
  }
  orionTasks.subscribe(refreshTasksBtnClasses)
  taskPanelUserEnabled.subscribe(refreshTasksBtnClasses)

  return (
    <box cssClasses={["tabs-bar"]} hexpand>

      {tasksBtn as unknown as any}

      <button
        cssClasses={activeTabId(id => id === "home" ? ["j-tab", "j-tab-home", "active"] : ["j-tab", "j-tab-home"])}
        onClicked={() => { setActiveTab("home"); setSection("inicio") }}
      >
        <image iconName="go-home-symbolic" />
      </button>

      <scrolledwindow
        hexpand
        vscrollbarPolicy={Gtk.PolicyType.NEVER}
        hscrollbarPolicy={Gtk.PolicyType.EXTERNAL}
      >
        <Gtk.EventControllerScroll
          flags={Gtk.EventControllerScrollFlags.VERTICAL}
          onScroll={(self: any, dx: number, dy: number) => {
            const widget = self.get_widget() as Gtk.ScrolledWindow
            const adj = widget.get_hadjustment()
            adj.set_value(adj.get_value() + dy * 40)
            return true
          }}
        />
        <box>
          <For each={pinnedTabs}>
            {(tab: PinnedTab) => {
              // Close button: imperative box with CAPTURE gesture to stop click propagation
              const closeBox = new Gtk.Box()
              closeBox.set_css_classes(["tab-x"])
              const closeIcon = new Gtk.Image()
              closeIcon.set_from_icon_name("window-close-symbolic")
              closeBox.append(closeIcon)
              const gesture = new Gtk.GestureClick()
              gesture.propagation_phase = Gtk.PropagationPhase.CAPTURE
              gesture.connect("pressed", () => {
                closeTab(tab.id)
                gesture.set_state(Gtk.EventSequenceState.CLAIMED)
              })
              closeBox.add_controller(gesture)

              return (
                <button
                  cssClasses={activeTabId(id => id === tab.id ? ["j-tab", "active"] : ["j-tab"])}
                  onClicked={() => setActiveTab(tab.id)}
                >
                  <box spacing={4}>
                    <image iconName={TAB_META[tab.type].icon} />
                    <label label={tab.label} maxWidthChars={18} ellipsize={3} />
                    {closeBox}
                  </box>
                </button>
              )
            }}
          </For>
        </box>
      </scrolledwindow>

      <ProfileDropdown />

    </box>
  )
}
