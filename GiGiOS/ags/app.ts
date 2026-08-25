import app from "ags/gtk4/app"
import style from "./estilos/out.css"
import Barra from "./modulos/barra/Barra"
import Lagarto from "./modulos/mascotas/Lagarto"
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
import { initBrilloAhorro } from "./servicios/energia/brilloAhorro"
import { initTlpAuto } from "./servicios/energia/tlpAuto"
import { initInactividadAhorro } from "./servicios/pantalla/inactividadAhorro"
import { inicializarMantenerDespierto } from "./servicios/energia/mantenerDespierto"
import { initGamemode, toggleGamemode } from "./servicios/energia/gamemode"
import { initOpacidadAhorro } from "./servicios/energia/opacidadAhorro"
import { iniciarCierreAjustesAlCambiarEscritorio } from "./servicios/escritorios/cierreAlCambiarEscritorio"
import { inicializarReloj } from "./modulos/calendario/reloj/estadoReloj"
import { initPlanificadorFondos } from "./servicios/fondos/planificador"
import { initAcentoAdaptativo } from "./servicios/fondos/acento"
import { initPresetsApps } from "./servicios/multimedia/presetsApps"
import { alternarBarPorTecla, alternarMenuEnergia, alternarPanelAjustes, alternarPanelNotificaciones, alternarQuickSettings, showBrightnessOSD, stepBrightness, toggleCalendar } from "./estado/shell"

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
    // Lo usa GiGiOS.boton_apagado() (hypr/gigios/boton-apagado.lua) cuando el botón físico
    // está configurado para abrir el menú en vez de ejecutar una acción directa.
    if (argv.includes("toggle-power-menu")) {
      alternarMenuEnergia()
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
    // Mascota puramente cosmética: se monta siempre (ventana barata, oculta por
    // `visible`) para que el toggle de Ajustes se aplique en caliente, igual
    // que spotifyBarEnabled. El try/catch la aísla de las demás ventanas por
    // si el sprite no carga en una máquina nueva.
    try { app.get_monitors().map(Lagarto) } catch (e) { console.error("[app] Lagarto failed:", e) }
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
    // Las dos ventanas de ajustes tapan la pantalla entera y no viven en ningún
    // escritorio: se cierran al cambiar de workspace. Va a t=0 (una conexión de
    // señal, coste nulo) para que no queden abiertas si el cambio ocurre pronto.
    iniciarCierreAjustesAlCambiarEscritorio()
    // Deja el Wake up apagado: es por sesión, y un wakeup.json heredado seguiría
    // vetando la suspensión sin que ninguna UI lo enseñe. NO se aparta con los
    // demás (abajo): su único trabajo es limpiar estado heredado peligroso, y es
    // un borrado de fichero — retrasar justo eso no tiene sentido.
    inicializarMantenerDespierto()
    // Misma razón, mismo sitio: un registro de GameMode huérfano de un AGS muerto
    // dejaría el gobernador de CPU en `performance` sin UI donde apagarlo. Es un
    // `pkill` acotado a nuestro argv0, así que tampoco tiene sentido apartarlo.
    initGamemode()
    // Quita la transparencia de los paneles si el ahorro ya está activo al arrancar.
    // A t=0 y no con los init* de abajo porque SE VE: apartarlo cuatro segundos serían
    // cuatro segundos de paneles translúcidos que luego cambian solos a la vista. Es un
    // CssProvider y una suscripción, así que no compite con nada.
    initOpacidadAhorro()

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
      // Mismo criterio: el fondo del arranque ya lo puso `wallpaper.sh` desde el
      // autostart de Hyprland, y este solo vigila el próximo cambio de franja
      // contra el reloj de pared — cuatro segundos no pueden perderle ninguno.
      initPlanificadorFondos()
      // Mismo apartado y mismo criterio: el shell ya está pintado con el azul de
      // reserva del tema —un tema completo, no un estado a medias— y esto solo lo
      // tiñe cuando el extractor conteste. Además lanza un `python3`, que es justo
      // lo que no debe competir con la construcción de las ventanas.
      initAcentoAdaptativo()
      // Las tres medidas de ahorro que actúan sobre el SISTEMA (brillo del panel, perfil
      // de TLP y tiempos de hypridle). Van aquí por el mismo criterio: siembran del
      // ESTADO —`powerSaveActive` ya está resuelto y sus apuntes están en disco—, no de
      // eventos ocurridos mientras esperan, así que cuatro segundos no les pierden nada.
      // Su primera pasada es además la recuperación de un apunte huérfano que pudiera
      // haber dejado un AGS muerto con el ahorro puesto (brillo bajo, tiempos cortos).
      initBrilloAhorro()
      initTlpAuto()
      initInactividadAhorro()
      // Vigilante del volumen por aplicación. Aplica los presets de `audioPresets.json`
      // a los streams que aparecen, que hasta ahora SOLO ocurría con el submenú
      // "Aplicaciones" de Quick Settings abierto: una app lanzada con el panel cerrado
      // sonaba al volumen que ella quisiera. Mismo criterio de apartado que el resto —
      // su barrido inicial atiende a lo que ya estuviera sonando, así que cuatro
      // segundos no le pierden ningún stream, solo lo atienden un poco más tarde.
      initPresetsApps()
    }, 4000)
  },
})
