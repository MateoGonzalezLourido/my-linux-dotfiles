import AstalTray from "gi://AstalTray"
import { createBinding, For } from "ags"
import { Gtk } from "ags/gtk4"

export default function SystemTray() {
  const tray  = AstalTray.get_default()
  const items = createBinding(tray, "items")

  return (
    <box spacing={2}>
      <For each={items}>
        {(item) => (
          <menubutton cssName="icon-bare">
            <image
              gicon={createBinding(item, "gicon")}
              iconSize={Gtk.IconSize.NORMAL}
            />
            <popover>
              <Gtk.Label label={createBinding(item, "tooltipMarkup")} useMarkup />
            </popover>
          </menubutton>
        )}
      </For>
    </box>
  )
}
