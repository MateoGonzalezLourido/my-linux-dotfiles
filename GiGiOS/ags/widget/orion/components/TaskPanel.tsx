import { Gtk } from "ags/gtk4"
import { For } from "ags"
import { orionTasks, groupedTasks, taskPanelVisible, type GroupedTask } from "../state"

export default function TaskPanel() {
  return (
    <box
      cssClasses={["task-panel"]}
      orientation={Gtk.Orientation.VERTICAL}
      visible={taskPanelVisible(v => v)}
    >
      <box cssClasses={["tp-header"]} spacing={6}>
        <label
          cssClasses={["tp-title"]}
          label="tareas"
          hexpand
          halign={Gtk.Align.START}
        />
        <label
          cssClasses={["tp-count"]}
          label={orionTasks(tasks => `${tasks.length}`)}
        />
      </box>

      <box cssClasses={["tp-list"]} orientation={Gtk.Orientation.VERTICAL}>
        <For each={groupedTasks}>
          {(g: GroupedTask) => (
            <box cssClasses={["tp-item"]} spacing={9}>
              <box cssClasses={["tp-spinner"]} />
              <image iconName={g.icon} cssClasses={["tp-icon"]} pixelSize={14} />
              <label
                label={g.message}
                cssClasses={["tp-msg"]}
                hexpand
                halign={Gtk.Align.START}
                ellipsize={3}
                maxWidthChars={18}
              />
              <label
                visible={g.count > 1}
                label={`${g.count}`}
                cssClasses={["tp-badge"]}
              />
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
