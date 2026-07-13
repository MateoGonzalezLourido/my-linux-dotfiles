import app from "ags/gtk4/app"
import style from "./out.css"
import Bar from "./widget/Bar"
import PowerOptions from "./widget/bar/PowerOptions"
import OSD, { showOSD } from "./widget/OSD"
import MicOSD, { showMicOSD } from "./widget/MicOSD"
import QuickSettings from "./widget/QuickSettings"
import NotificationPopup from "./widget/notifications/NotificationPopup"
import NotificationPanel from "./widget/notifications/NotificationPanel"
import SettingsWindow from "./widget/notifications/settings/SettingsWindow"
import CalendarPanel from "./widget/CalendarPanel"
import SettingsPanel from "./widget/SettingsPanel"
import Orion from "./widget/orion/Orion"
import { orionEnabled } from "./widget/settings/preferences"
import { startCleanupEngine } from "./widget/notifications/cleanup/cleanupEngine"
import { runAppSettingsMigration } from "./widget/notifications/settings/runMigration"
import { initAutoDnd } from "./widget/notifications/autoDnd/watcher"
import { initNotifDaemonCheck } from "./widget/notifications/daemonCheck"
import { initTrayApps } from "./widget/settings/trayApps"
import { initGamingState } from "./widget/power/gamingState"
import { showBrightnessOSD } from "./widget/state"

app.start({
  css: style,
  requestHandler(argv, response) {
    if (argv.includes("volume-osd")) {
      showOSD()
      response("ok")
      return
    }
    if (argv.includes("mic-osd")) {
      showMicOSD()
      response("ok")
      return
    }
    if (argv.includes("brightness-osd")) {
      showBrightnessOSD()
      response("ok")
      return
    }
    response("unknown request")
  },
  main() {
    app.get_monitors().flatMap(Bar)
    app.get_monitors().map(PowerOptions)
    app.get_monitors().map(OSD)
    app.get_monitors().map(MicOSD)
    // Resumen inicial simultáneo: cada tarjeta aplica su propia condición (el
    // volumen se omite si arranca silenciado o a cero, y el brillo si ya está al
    // máximo), pero las que procedan aparecen juntas.
    setTimeout(() => showOSD(true), 1200)
    setTimeout(() => showBrightnessOSD(true), 1200)
    app.get_monitors().map(QuickSettings)
    app.get_monitors().map(NotificationPopup)
    app.get_monitors().map(NotificationPanel)
    app.get_monitors().map(SettingsWindow)
    // La construcción debe ocurrir dentro del contexto reactivo de main(). Si
    // está desactivado no se crea la ventana, por lo que tampoco puede arrancar
    // el polling ni ningún proceso auxiliar de Orion.
    if (orionEnabled.get()) {
      app.get_monitors().map(Orion)
    }
    try { app.get_monitors().map(CalendarPanel) } catch(e) { console.error("[app] CalendarPanel failed:", e) }
    app.get_monitors().map(SettingsPanel)
    startCleanupEngine()
    runAppSettingsMigration()
    initAutoDnd()
    initTrayApps()
    initGamingState()
    // Después de NotificationPopup: es quien construye el AstalNotifd que reclama el nombre.
    initNotifDaemonCheck()
  },
})
