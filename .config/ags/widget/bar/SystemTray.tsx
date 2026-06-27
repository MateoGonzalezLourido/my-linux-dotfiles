import AstalTray from "gi://AstalTray"
import { createBinding, For } from "ags"
import { Gtk } from "ags/gtk4"
import { openBarMenu, closeBarMenu } from "../state"

export default function SystemTray() {
  const tray  = AstalTray.get_default()
  const items = createBinding(tray, "items")

  return (
    <box spacing={2}>
      <For each={items}>
        {(item) => (
          <box
            $={(self) => {
              createBinding(item, "actionGroup").subscribe((ag) => {
                if (ag) {
                  self.insert_action_group("dbusmenu", ag)
                  self.insert_action_group("tray", ag)
                  self.insert_action_group("indicator", ag)
                  self.insert_action_group("item", ag)
                  self.insert_action_group("app", ag)
                  self.insert_action_group("unity", ag)
                }
              })
            }}
          >
            <menubutton
              cssName="icon-bare"
              cssClasses={["tray-item"]}
              focusable={true}
              menuModel={createBinding(item, "menuModel").as(mm => mm || null)}
              tooltipMarkup={createBinding(item, "tooltipMarkup")}
              onNotifyActive={(self) => self.active ? openBarMenu() : closeBarMenu()}
            >
              <image
                gicon={createBinding(item, "gicon")}
                pixelSize={17}
              />
            </menubutton>
          </box>
        )}
      </For>
    </box>
  )
}
