import AstalTray from "gi://AstalTray"
import Gio from "gi://Gio"

const tray = AstalTray.get_default()
const items = tray.get_items()

if (items.length > 0) {
    const item = items[0]
    const model = item.menu_model
    if (model) {
        console.log("Menu Model structure:")
        for (let i = 0; i < model.get_n_items(); i++) {
            const attr = model.get_item_attribute_value(i, "action", null)
            console.log(`Item ${i} action:`, attr ? attr.print(true) : "none")
        }
    }
}
