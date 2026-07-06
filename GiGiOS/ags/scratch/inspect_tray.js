import AstalTray from "gi://AstalTray"
const tray = AstalTray.get_default()
console.log("Tray items properties:")
tray.items.forEach(item => {
    console.log(`Item: ${item.id}`)
    console.log(`- menuModel: ${item.menuModel}`)
    console.log(`- actionGroup: ${item.actionGroup}`)
})
process.exit(0)
