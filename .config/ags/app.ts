import app from "ags/gtk4/app"
import style from "./out.css"
import Bar from "./widget/Bar"
import PowerOptions from "./widget/bar/PowerOptions"
import MicOSD from "./widget/MicOSD"
import PixelVolumeOSD from "./widget/PixelVolumeOSD"
import PixelMicOSD from "./widget/PixelMicOSD"
import QuickSettings from "./widget/QuickSettings"
import NotificationPopup from "./widget/notifications/NotificationPopup"
import NotificationPanel from "./widget/notifications/NotificationPanel"
import SettingsWindow from "./widget/notifications/settings/SettingsWindow"
import CalendarPanel from "./widget/CalendarPanel"
import SettingsPanel from "./widget/SettingsPanel"
import Orion from "./widget/orion/Orion"
import WorkspaceOverview from "./widget/WorkspaceOverview/index"
import { startCleanupEngine } from "./widget/notifications/cleanup/cleanupEngine"
import { runAppSettingsMigration } from "./widget/notifications/settings/runMigration"

app.start({
  css: style,
  main() {
    app.get_monitors().flatMap(Bar)
    app.get_monitors().map(PowerOptions)
    app.get_monitors().map(MicOSD)
    app.get_monitors().map(PixelVolumeOSD)
    app.get_monitors().map(PixelMicOSD)
    app.get_monitors().map(QuickSettings)
    app.get_monitors().map(NotificationPopup)
    app.get_monitors().map(NotificationPanel)
    app.get_monitors().map(SettingsWindow)
    app.get_monitors().map(Orion)
    app.get_monitors().map(WorkspaceOverview)
    try { app.get_monitors().map(CalendarPanel) } catch(e) { console.error("[app] CalendarPanel failed:", e) }
    app.get_monitors().map(SettingsPanel)
    startCleanupEngine()
    runAppSettingsMigration()
  },
})
