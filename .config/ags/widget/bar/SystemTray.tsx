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
          <menubutton
            cssName="icon-bare"
            tooltipMarkup={createBinding(item, "tooltipMarkup")}
            menuModel={createBinding(item, "menuModel")}
            $={(self) => {
              createBinding(item, "actionGroup").subscribe((ag) => {
                if (ag) self.insert_action_group("dbusmenu", ag)
              })
            }}
          >
            <image
              gicon={createBinding(item, "gicon")}
              iconSize={Gtk.IconSize.NORMAL}
            />
          </menubutton>
        )}
      </For>
    </box>
  )
}
