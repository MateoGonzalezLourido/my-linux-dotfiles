import app from "ags/gtk4/app"
import style from "./out.css"
import Barra from "./modulos/barra/Barra"
import MenuEnergia from "./modulos/menu-energia/MenuEnergia"
import OSD, { showOSD } from "./modulos/osd/OSD"
import { showMicOSD } from "./modulos/osd/MicOSD"
import QuickSettings from "./modulos/ajustes-rapidos/QuickSettings"
import NotificationPopup from "./modulos/notificaciones/NotificationPopup"
import NotificationPanel from "./modulos/notificaciones/NotificationPanel"
import SettingsWindow from "./modulos/notificaciones/settings/SettingsWindow"
import PanelCalendario from "./modulos/calendario/PanelCalendario"
import SettingsPanel from "./modulos/ajustes/SettingsPanel"
import Orion from "./modulos/orion/Orion"
import { togglePanel as alternarPanelOrion } from "./modulos/orion/state"
import { orionEnabled } from "./modulos/ajustes/preferences"
import { startCleanupEngine } from "./modulos/notificaciones/cleanup/cleanupEngine"
import { runAppSettingsMigration } from "./modulos/notificaciones/settings/runMigration"
import { initAutoDnd } from "./modulos/notificaciones/autoDnd/watcher"
import { initNotifDaemonCheck } from "./modulos/notificaciones/daemon/comprobacion"
import { initTrayApps } from "./modulos/ajustes/trayApps"
import { initGamingState } from "./servicios/energia/gamingState"
import { inicializarMantenerDespierto } from "./servicios/energia/mantenerDespierto"
import { initGamemode, toggleGamemode } from "./servicios/energia/gamemode"
import { inicializarReloj } from "./modulos/calendario/reloj/estadoReloj"
import { alternarBarPorTecla, alternarPanelAjustes, alternarPanelNotificaciones, alternarQuickSettings, showBrightnessOSD, stepBrightness, toggleCalendar } from "./estado/shell"

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
    // Las teclas de brillo pasan por aquí en vez de llamar a `brightnessctl` desde el
    // keybind: así funcionan con los dos backends (panel interno o DDC/CI) y el estado
    // del shell no se desincroniza del monitor. Ver `servicios/pantalla/brightness.ts`.
    if (argv.includes("brightness-up")) {
      stepBrightness(0.1)
      response("ok")
      return
    }
    if (argv.includes("brightness-down")) {
      stepBrightness(-0.1)
      response("ok")
      return
    }
    // Mismo interruptor que el botón de mando de Quick Settings, por si algún día
    // se quiere una tecla. La respuesta dice en qué estado queda.
    if (argv.includes("toggle-gamemode")) {
      response(toggleGamemode() ? "on" : "off")
      return
    }
    if (argv.includes("toggle-orion")) {
      alternarPanelOrion()
      response("ok")
      return
    }
    if (argv.includes("toggle-bar")) {
      alternarBarPorTecla()
      response("ok")
      return
    }
    if (argv.includes("toggle-quicksettings")) {
      alternarQuickSettings()
      response("ok")
      return
    }
    if (argv.includes("toggle-settings")) {
      alternarPanelAjustes()
      response("ok")
      return
    }
    if (argv.includes("toggle-notifications")) {
      alternarPanelNotificaciones()
      response("ok")
      return
    }
    // El calendario era el único panel sin `request`: solo se abría pinchando el reloj de la barra.
    // Con la barra autoocultada eso obliga a ir a buscarla, y no había forma de atarlo a una tecla.
    if (argv.includes("toggle-calendar")) {
      toggleCalendar()
      response("ok")
      return
    }
    response("unknown request")
  },
  main() {
    app.get_monitors().flatMap(Barra)
    app.get_monitors().map(MenuEnergia)
    app.get_monitors().map(OSD)
    // Resumen inicial simultáneo: cada tarjeta aplica su propia condición (el
    // volumen se omite si arranca silenciado o a cero, y el brillo si ya está al
    // máximo), pero las que procedan aparecen juntas.
    setTimeout(() => {
      showOSD(true)
      showBrightnessOSD(true)
    }, 1200)
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
    try { app.get_monitors().map(PanelCalendario) } catch(e) { console.error("[app] PanelCalendario failed:", e) }
    app.get_monitors().map(SettingsPanel)
    // Deja el Wake up apagado: es por sesión, y un wakeup.json heredado seguiría
    // vetando la suspensión sin que ninguna UI lo enseñe. NO se aparta con los
    // demás (abajo): su único trabajo es limpiar estado heredado peligroso, y es
    // un borrado de fichero — retrasar justo eso no tiene sentido.
    inicializarMantenerDespierto()
    // Misma razón, mismo sitio: un registro de GameMode huérfano de un AGS muerto
    // dejaría el gobernador de CPU en `performance` sin UI donde apagarlo. Es un
    // `pkill` acotado a nuestro argv0, así que tampoco tiene sentido apartarlo.
    initGamemode()

    // ── Trabajo de fondo, apartado del pintado inicial ────────────────────────
    // Nada de esto se ve: son vigilantes y un barrido de limpieza. Corriendo aquí
    // competían con la construcción de las ventanas (una por monitor) justo cuando
    // el escritorio se está pintando, y alguno no es gratis — initAutoDnd e
    // initGamingState consultan `isGameClient`, que puede acabar parseando los ~161
    // .desktop del sistema (Gio.AppInfo.get_all) para decidir si una ventana es un
    // juego. Es el mismo gesto que el resumen de OSD de arriba.
    //
    // Apartarlos es seguro porque NINGUNO depende de eventos ocurridos mientras
    // esperan: initTrayApps e initGamingState SIEMBRAN de lo que haya vivo al
    // arrancar (`tray.get_items()` / `hypr.get_clients()`) antes de suscribirse, así
    // que a los 4 s ven un superconjunto de lo que verían ahora; initAutoDnd adopta
    // el estado del DND al empezar; e initNotifDaemonCheck va suscrito a
    // NameOwnerChanged (y de hecho gana fiabilidad: a los pocos ms del arranque el
    // dueño del nombre de notificaciones aún se está resolviendo).
    //
    // Sobre initGamingState: escribe runtime-state.json para que bash lo lea. Su
    // único consumidor es la pausa del escáner de descargas de oom-monitor.sh, que
    // ahora ni siquiera barre hasta el segundo 60 — el flag lleva ahí mucho antes.
    setTimeout(() => {
      startCleanupEngine()
      runAppSettingsMigration()
      initAutoDnd()
      initTrayApps()
      initGamingState()
      // Después de NotificationPopup: es quien construye el AstalNotifd que reclama el nombre.
      initNotifDaemonCheck()
      // Arma el temporizador de la próxima alarma. Va aquí y no a t=0 porque NO siembra de
      // eventos: lee la lista del disco, que no cambia mientras espera, y las alarmas puntuales
      // vencidas ya se desactivaron al cargar el módulo. Cuatro segundos de margen no pueden
      // hacer que se pierda un vencimiento: el planificador se arma contra el reloj de pared.
      inicializarReloj()
    }, 4000)
  },
})
