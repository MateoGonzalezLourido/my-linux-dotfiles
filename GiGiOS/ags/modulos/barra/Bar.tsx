import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createComputed, createState, onCleanup } from "ags"
import AstalHyprland from "gi://AstalHyprland"
import { cpuRamEnabled } from "./functions/state"

import Clock from "./Clock"
import Functions, { FunctionsMenu } from "./Functions"
import Workspaces from "./Workspaces"
import GamesIndicator from "./games/GamesIndicator"
import SystemTray from "./SystemTray"
import Bluetooth from "./Bluetooth"
import Network from "./Network"
import Volume from "./Volume"
import Battery from "./Battery"
import CpuRam from "./CpuRam"
import ScreencastIndicator from "./ScreencastIndicator"
import WakeUpIndicator from "./WakeUpIndicator"
import MicIndicator from "./MicIndicator"
import NotificationButton from "./NotificationButton"
import UpdatesButton from "./UpdatesButton"
import PowerButton from "./PowerButton"
import SpotifyNowPlaying from "./SpotifyNowPlaying"
import RanuraCondicionalBarra from "./componentes/RanuraCondicionalBarra"
import { obtenerControlVisibilidadBarra } from "./visibilidad"
import { spotifyBarSuspended } from "../../servicios/energia/powerState"
import { barAutoHideEnabled, batteryBarEnabled, micIndicatorEnabled, networkBarEnabled, notificationBarEnabled, screencastIndicatorEnabled, spotifyBarEnabled, trayBarEnabled, workspacesBarEnabled, updatesMonitorEnabled } from "../ajustes/preferences"
import { anyPanelVisible, alternarQuickSettings, solicitudAlternarBar } from "../../estado/shell"

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const visibilidad = obtenerControlVisibilidadBarra(gdkmonitor)
  const mostrarSpotify = createComputed(() => spotifyBarEnabled() && !spotifyBarSuspended())
  const { visible, fijarVisible: setVisible, fijarRefrescar: setWidgetsRefresh } = visibilidad
  const [isHovered, setIsHovered] = createState(false)
  const [isWsDragging, setIsWsDragging] = createState(false)
  const [isWsPreview, setIsWsPreview] = createState(false)
  const [barKeyboardActive, setBarKeyboardActive] = createState(false)
  const [barPinnedByKey, setBarPinnedByKey] = createState(false)
  const [barOcultaPorTecla, setBarOcultaPorTecla] = createState(false)
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let startupTimer: ReturnType<typeof setTimeout> | null = null
  let keyboardCount = 0
  let shownAt = 0
  let lastY = 0
  const BAR_HEIGHT = 38

  // La barra arranca visible y con refresco activo. Las suscripciones no ejecutan
  // su callback al registrarse, así que este estado inicial debe ser explícito para
  // que widgets como el reloj no pinten una caché vacía hasta el primer hover.
  setWidgetsRefresh(true)
  setVisible(true)
  // Cubre la animación CSS (300ms) para que lastY no tenga valores del bar oculto
  const SHOW_LOCK_MS = 320
  const CLOSE_GUARD_Y = 8

  function trackMotion(x: number, y: number) {
    setIsHovered(true)
    if (visible()) lastY = y
  }

  function trackEnter(x: number, y: number) {
    setIsHovered(true)
    if (visible()) lastY = y
  }

  function handleShow() {
    if (showTimer) clearTimeout(showTimer)
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    if (!visible()) lastY = 0  // limpiar coordenada del bar oculto (y=38 relativo)
    setWidgetsRefresh(true)
    showTimer = setTimeout(() => {
      shownAt = Date.now()
      setVisible(true)
      showTimer = null
    }, 200)
  }

  // Muestra el bar YA, sin el delay de handleShow ni los guards de handleHide.
  // Para los casos en que el bar debe quedarse fijo: pin por teclado y
  // auto-ocultado desactivado en Barra y escritorios.
  function showNow() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    setWidgetsRefresh(true)
    shownAt = Date.now()
    setVisible(true)
  }

  // Ocultado explícito por teclado: no depende del auto-ocultado, del hover ni
  // de los guards de salida, porque debe prevalecer sobre la preferencia de bar fijo.
  function hideNow() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    setVisible(false)
    setWidgetsRefresh(false)
  }

  function handleHide() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    if (!visible()) return
    if (!barAutoHideEnabled.get()) return
    if (barPinnedByKey.get()) return
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (barAutoHideEnabled.get() && !isHovered() && !anyPanelVisible.get() && !visibilidad.menuAbierto.get() && !isWsPreview.get() && !isWsDragging() && !barPinnedByKey.get()) {
        if (Date.now() - shownAt < SHOW_LOCK_MS) return
        if (lastY <= CLOSE_GUARD_Y) return
        setVisible(false)
        setWidgetsRefresh(false)
      }
    }, 300)
  }

  // Una sola ruta decide la visibilidad local de esta salida.
  const checkVisibility = () => {
    if (barOcultaPorTecla.get()) {
      hideNow()
    } else if (!barAutoHideEnabled.get()) {
      showNow()
    } else if (isHovered() || anyPanelVisible.get() || visibilidad.menuAbierto.get() || isWsPreview.get()) {
      handleShow()
    } else {
      handleHide()
    }
  }

  const bajas = [
    isHovered.subscribe(checkVisibility),
    anyPanelVisible.subscribe(checkVisibility),
    visibilidad.menuAbierto.subscribe(checkVisibility),
    isWsPreview.subscribe(checkVisibility),
    isWsDragging.subscribe(() => { if (!isWsDragging.get()) checkVisibility() }),
  ]

  bajas.push(barPinnedByKey.subscribe(() => {
    if (barPinnedByKey.get()) showNow()
    else checkVisibility()
  }))
  bajas.push(barOcultaPorTecla.subscribe(checkVisibility))

  // Auto-ocultado desactivado en Barra y escritorios → el bar baja al instante y ya
  // no vuelve a ocultarse; al reactivarlo, checkVisibility decide (se retraerá si
  // no hay hover ni paneles abiertos).
  bajas.push(barAutoHideEnabled.subscribe(checkVisibility))

  const hyprland = AstalHyprland.get_default()
  const nombreMonitor = gdkmonitor.get_connector() ?? ""
  const esMonitorEnfocado = () => {
    const enfocado = (hyprland as any).focusedMonitor ?? (hyprland as any).get_focused_monitor?.()
    if (nombreMonitor && enfocado?.name) return enfocado.name === nombreMonitor
    const geometria = gdkmonitor.get_geometry()
    return enfocado?.x === geometria.x && enfocado?.y === geometria.y
  }
  bajas.push(solicitudAlternarBar.subscribe(() => {
    if (!esMonitorEnfocado()) return
    const ocultar = visible.get()
    setBarPinnedByKey(!ocultar)
    setBarOcultaPorTecla(ocultar)
  }))

  // Auto-ocultado inicial: el bar arranca visible para que se vea al iniciar
  // sesión, pero checkVisibility() solo corre dentro de los .subscribe(), que no
  // disparan en el arranque. Sin esto, el bar quedaba fijo hasta el primer hover.
  // Tras un breve margen, si no hay hover ni paneles abiertos, se oculta solo.
  // (Hide directo: omite los guards de flicker —lastY/SHOW_LOCK— que no aplican
  // en el arranque, donde lastY=0 los bloquearía.)
  startupTimer = setTimeout(() => {
    startupTimer = null
    if (barAutoHideEnabled.get() && !isHovered() && !anyPanelVisible.get() && !visibilidad.menuAbierto.get() && !isWsPreview.get() && !isWsDragging() && !barPinnedByKey.get()) {
      setVisible(false)
      setWidgetsRefresh(false)
    }
  }, 2000)

  const interaccionWorkspaces = {
    cambiarArrastre: setIsWsDragging,
    cambiarVistaPrevia: setIsWsPreview,
    adquirirTeclado: () => {
      keyboardCount++
      if (keyboardCount === 1) setBarKeyboardActive(true)
    },
    liberarTeclado: () => {
      keyboardCount = Math.max(0, keyboardCount - 1)
      if (keyboardCount === 0) setBarKeyboardActive(false)
    },
  }

  onCleanup(() => {
    if (hideTimer) clearTimeout(hideTimer)
    if (showTimer) clearTimeout(showTimer)
    if (startupTimer) clearTimeout(startupTimer)
    bajas.forEach((baja) => { if (typeof baja === "function") baja() })
  })

  const hotzone = <window
    name="bar-hotzone"
    visible={visible((v) => !v)}
    gdkmonitor={gdkmonitor}
    layer={Astal.Layer.TOP}
    exclusivity={Astal.Exclusivity.NORMAL}
    anchor={TOP | LEFT | RIGHT}
    application={app}
    heightRequest={1}
    marginTop={0}
  >
    <box hexpand vexpand>
      <Gtk.EventControllerMotion
        onEnter={() => setIsHovered(true)}
        onLeave={() => setIsHovered(false)}
        onMotion={() => setIsHovered(true)} />
    </box>
  </window>

  const bar = <window
    name="bar"
    visible={true}
    gdkmonitor={gdkmonitor}
    layer={Astal.Layer.TOP}
    // Con auto-ocultado el bar flota sobre las ventanas (NORMAL): reservar zona
    // exclusiva para una superficie que se retrae dejaría un hueco muerto de 38px.
    // Sin auto-ocultado es un bar fijo clásico, así que pasa a EXCLUSIVE y Hyprland
    // le reserva su altura en vez de taparles el borde superior a las ventanas.
    exclusivity={createComputed(
      [barAutoHideEnabled, barOcultaPorTecla],
      (autoOcultar, ocultaPorTecla) => autoOcultar || ocultaPorTecla
        ? Astal.Exclusivity.NORMAL
        : Astal.Exclusivity.EXCLUSIVE,
    )}
    focusable={true}
    anchor={TOP | LEFT | RIGHT}
    application={app}
    // El bar vive en NONE: como es una capa siempre mapeada, en reposo (y sobre todo
    // al iniciar sesión, cuando es la única superficie) no debe poder recibir el foco
    // de teclado del compositor, o se lo queda y hay que clicar la app recién abierta.
    // Solo elevamos a ON_DEMAND mientras un renumerado de escritorios está activo;
    // la vista de escritorios adquiere y libera el teclado durante esa interacción.
    // El hover normal no pide teclado.
    keymode={barKeyboardActive((on) => on ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
    marginTop={visible((v) => v ? 0 : -BAR_HEIGHT)}
    cssClasses={visible((v) => v ? ["Bar", "bar-visible"] : ["Bar", "bar-hidden"])}
  >
    <Gtk.EventControllerMotion
      onEnter={trackEnter}
      onLeave={() => {
        if (barPinnedByKey.get()) setBarPinnedByKey(false)
        setIsHovered(false)
      }}
      onMotion={trackMotion}
    />
    <Gtk.GestureClick
      onPressed={() => setIsHovered(true)}
    />
    <centerbox>
      <box $type="start" halign={Gtk.Align.START} spacing={6}>
        <Clock visibilidad={visibilidad} />
        <box spacing={1}>
          <Functions />
          <RanuraCondicionalBarra
            estado={workspacesBarEnabled}
            construir={() => Workspaces(gdkmonitor, visibilidad, interaccionWorkspaces)}
          />
        </box>
        <GamesIndicator visibilidad={visibilidad} />
      </box>

      <box $type="center" halign={Gtk.Align.CENTER} spacing={8}>
        {/* La ranura desmonta el contenido cuando la preferencia o el ahorro lo
            desactivan. OndaSpotify libera su reloj de frames mediante onCleanup. */}
        <RanuraCondicionalBarra
          estado={mostrarSpotify}
          construir={() => <SpotifyNowPlaying visibilidad={visibilidad} />}
        />
      </box>

      <box $type="end" halign={Gtk.Align.END} spacing={10} cssClasses={["bar-end-box"]}>
        <RanuraCondicionalBarra
          estado={trayBarEnabled}
          construir={() => <SystemTray visibilidad={visibilidad} />}
        />
        <box cssClasses={["bar-status-pair"]} spacing={0}>
          <RanuraCondicionalBarra
            estado={updatesMonitorEnabled}
            construir={() => <UpdatesButton visibilidad={visibilidad} />}
          />
          {/* La ranura conserva esta posición al montar y desmontar el indicador
              desde Ajustes, entre Actualizaciones y Notificaciones. */}
          <RanuraCondicionalBarra
            estado={screencastIndicatorEnabled}
            construir={() => <ScreencastIndicator />}
          />
          {/* Wake up: montado siempre y escondido con `visible`, no con un <With>.
              No es una preferencia que se pueda apagar, así que no hay remontaje en
              caliente del que protegerse con una caja propia. */}
          <WakeUpIndicator />
          <RanuraCondicionalBarra
            estado={notificationBarEnabled}
            construir={() => <NotificationButton />}
          />
          <button
            cssClasses={["bar-pill-btn"]}
            onClicked={alternarQuickSettings}
          >
            <box cssClasses={["bar-pill", "qs-system-pill"]}>
              <Bluetooth />
              <RanuraCondicionalBarra estado={micIndicatorEnabled} construir={() => <MicIndicator />} />
              <RanuraCondicionalBarra
                estado={networkBarEnabled}
                construir={() => <Network visibilidad={visibilidad} />}
              />
              <Volume visibilidad={visibilidad} />
              <RanuraCondicionalBarra
                estado={batteryBarEnabled}
                construir={() => <Battery visibilidad={visibilidad} />}
              />
            </box>
          </button>
        </box>
        <box spacing={3}>
          {/* CPU/RAM es una "función" del menú del logo Arch: desactivada por
              defecto. La ranura la desmonta cuando se apaga y conserva su posición
              inmediatamente a la izquierda de Power al volver a activarla. */}
          <RanuraCondicionalBarra
            estado={cpuRamEnabled}
            construir={() => <CpuRam visibilidad={visibilidad} />}
          />
          <PowerButton />
        </box>
      </box>
    </centerbox>
  </window>

  return [hotzone, bar, FunctionsMenu(gdkmonitor)]
}
