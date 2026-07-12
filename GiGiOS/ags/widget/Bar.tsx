import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, With } from "ags"
import { cpuRamEnabled } from "./bar/functions/state"

import Clock from "./bar/Clock"
import Functions, { FunctionsMenu } from "./bar/Functions"
import Workspaces from "./bar/Workspaces"
import GamesIndicator from "./bar/games/GamesIndicator"
import SystemTray from "./bar/SystemTray"
import Bluetooth from "./bar/Bluetooth"
import Network from "./bar/Network"
import Volume from "./bar/Volume"
import Battery from "./bar/Battery"
import CpuRam from "./bar/CpuRam"
import ScreencastIndicator from "./bar/ScreencastIndicator"
import MicIndicator from "./bar/MicIndicator"
import NotificationButton from "./bar/NotificationButton"
import UpdatesButton from "./bar/UpdatesButton"
import PowerButton from "./bar/PowerButton"
import SpotifyNowPlaying from "./bar/SpotifyNowPlaying"
import { barAutoHideEnabled, batteryBarEnabled, micIndicatorEnabled, networkBarEnabled, notificationBarEnabled, screencastIndicatorEnabled, spotifyBarEnabled, trayBarEnabled, workspacesBarEnabled, updatesMonitorEnabled } from "./settings/preferences"
import { anyPanelVisible, setBarVisible, setWidgetsRefresh, openQuickSettings, quickSettingsVisible, closeAllPanels, isWsDragging, barPinnedByKey, setBarPinnedByKey, barKeyboardActive } from "./state";

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const [visible, setVisible] = createState(true)
  const [isHovered, setIsHovered] = createState(false)
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let shownAt = 0
  let lastY = 0
  const BAR_HEIGHT = 38

  // El bar arranca visible (se auto-oculta a los 2s, más abajo), pero barVisible/
  // widgetsRefresh nacían en false y solo pasan a true dentro de handleShow/showNow,
  // que únicamente corren desde los .subscribe() —que no disparan en el arranque—.
  // Los widgets que congelan su render con barVisible pintaban entonces su caché, y
  // la del reloj está vacía hasta el primer ocultado: salía en blanco. Sincronizamos
  // el estado global con la realidad desde el primer instante.
  setWidgetsRefresh(true)
  setBarVisible(true)
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
      setBarVisible(true)
      setVisible(true)
    }, 200)
  }

  // Muestra el bar YA, sin el delay de handleShow ni los guards de handleHide.
  // Para los casos en que el bar debe quedarse fijo: pin por teclado y
  // auto-ocultado desactivado en Personalización.
  function showNow() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    setWidgetsRefresh(true)
    shownAt = Date.now()
    setBarVisible(true)
    setVisible(true)
  }

  function handleHide() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    if (!visible()) return
    if (!barAutoHideEnabled.get()) return
    if (barPinnedByKey.get()) return
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (barAutoHideEnabled.get() && !isHovered() && !anyPanelVisible.get() && !isWsDragging() && !barPinnedByKey.get()) {
        if (Date.now() - shownAt < SHOW_LOCK_MS) return
        if (lastY <= CLOSE_GUARD_Y) return
        setVisible(false)
        setWidgetsRefresh(false)
        setBarVisible(false)
      }
    }, 300)
  }

  // Unified visibility logic
  const checkVisibility = () => {
    if (!barAutoHideEnabled.get()) {
      showNow()
    } else if (isHovered() || anyPanelVisible.get()) {
      handleShow()
    } else {
      handleHide()
    }
  }

  isHovered.subscribe(checkVisibility)
  anyPanelVisible.subscribe(checkVisibility)
  isWsDragging.subscribe((dragging) => { if (!dragging) checkVisibility() })

  barPinnedByKey.subscribe((pinned) => {
    if (pinned) showNow()
    else checkVisibility()
  })

  // Auto-ocultado desactivado en Personalización → el bar baja al instante y ya
  // no vuelve a ocultarse; al reactivarlo, checkVisibility decide (se retraerá si
  // no hay hover ni paneles abiertos).
  barAutoHideEnabled.subscribe(checkVisibility)

  // Auto-ocultado inicial: el bar arranca visible para que se vea al iniciar
  // sesión, pero checkVisibility() solo corre dentro de los .subscribe(), que no
  // disparan en el arranque. Sin esto, el bar quedaba fijo hasta el primer hover.
  // Tras un breve margen, si no hay hover ni paneles abiertos, se oculta solo.
  // (Hide directo: omite los guards de flicker —lastY/SHOW_LOCK— que no aplican
  // en el arranque, donde lastY=0 los bloquearía.)
  setTimeout(() => {
    if (barAutoHideEnabled.get() && !isHovered() && !anyPanelVisible.get() && !isWsDragging() && !barPinnedByKey.get()) {
      setVisible(false)
      setWidgetsRefresh(false)
      setBarVisible(false)
    }
  }, 2000)

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
    exclusivity={barAutoHideEnabled((on) => on ? Astal.Exclusivity.NORMAL : Astal.Exclusivity.EXCLUSIVE)}
    focusable={true}
    anchor={TOP | LEFT | RIGHT}
    application={app}
    // El bar vive en NONE: como es una capa siempre mapeada, en reposo (y sobre todo
    // al iniciar sesión, cuando es la única superficie) no debe poder recibir el foco
    // de teclado del compositor, o se lo queda y hay que clicar la app recién abierta.
    // Solo elevamos a ON_DEMAND mientras un renumerado de workspaces está activo
    // (Workspaces.tsx pide/suelta vía beginBarKeyboard/endBarKeyboard); ni siquiera el
    // hover normal pide teclado.
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
        <Clock />
        <box spacing={1}>
          <Functions />
          <With value={workspacesBarEnabled}>{(on: boolean) => on && <Workspaces />}</With>
        </box>
        <GamesIndicator />
      </box>

      <box $type="center" halign={Gtk.Align.CENTER} spacing={8}>
        <With value={spotifyBarEnabled}>{(on: boolean) => on && <SpotifyNowPlaying />}</With>
      </box>

      <box $type="end" halign={Gtk.Align.END} spacing={10} cssClasses={["bar-end-box"]}>
        <With value={trayBarEnabled}>{(on: boolean) => on && <SystemTray />}</With>
        <box cssClasses={["bar-status-pair"]} spacing={0}>
          <With value={updatesMonitorEnabled}>{(on: boolean) => on && <UpdatesButton />}</With>
          {/* Mismo motivo que CPU/RAM más abajo: el toggle de Personalización monta
              y desmonta este icono en caliente, y un <With> que se remonta se inserta
              al FINAL de su box (aparecía junto a Power). Su propio contenedor fija el
              hueco aquí, entre Actualizaciones y Notificaciones. */}
          <box valign={Gtk.Align.CENTER}>
            <With value={screencastIndicatorEnabled}>{(on: boolean) => on && <ScreencastIndicator />}</With>
          </box>
          <With value={notificationBarEnabled}>{(on: boolean) => on && <NotificationButton />}</With>
          <button
            cssClasses={["bar-pill-btn"]}
            onClicked={() => quickSettingsVisible.get() ? closeAllPanels() : openQuickSettings()}
          >
            <box cssClasses={["bar-pill", "qs-system-pill"]}>
              <Bluetooth />
              <With value={micIndicatorEnabled}>{(on: boolean) => on && <MicIndicator />}</With>
              <With value={networkBarEnabled}>{(on: boolean) => on && <Network />}</With>
              <Volume />
              <With value={batteryBarEnabled}>{(on: boolean) => on && <Battery />}</With>
            </box>
          </button>
        </box>
        <box spacing={3}>
          {/* CPU/RAM es una "función" del menú del logo Arch: desactivada por
              defecto. Al montarse solo cuando cpuRamEnabled es true, su polling y
              procesos `ps` no existen mientras la función esté apagada. Va dentro
              de su propio contenedor para que, al montarlo <With> dinámicamente,
              quede siempre fijo aquí (inmediatamente a la izquierda de Power) y no
              se inserte al final del box. */}
          <box valign={Gtk.Align.CENTER}>
            <With value={cpuRamEnabled}>{(on: boolean) => on && <CpuRam />}</With>
          </box>
          <PowerButton />
        </box>
      </box>
    </centerbox>
  </window>

  return [hotzone, bar, FunctionsMenu(gdkmonitor)]
}
