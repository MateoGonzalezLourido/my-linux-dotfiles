import AstalTray from "gi://AstalTray"

const tray = AstalTray.get_default()
const items = tray.get_items()

if (items.length > 0) {
    const item = items[0]
    console.log("Item ID:", item.item_id)
    console.log("Action Group:", item.action_group)
    console.log("Menu Model:", item.menu_model)
} else {
    console.log("No tray items found")
}
