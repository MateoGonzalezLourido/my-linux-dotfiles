import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, With } from "ags"
import { cpuRamEnabled } from "./bar/functions/state"

import Clock from "./bar/Clock"
import Functions, { FunctionsMenu } from "./bar/Functions"
import Workspaces from "./bar/Workspaces"
import GameIndicator from "./bar/GameIndicator"
import SystemTray from "./bar/SystemTray"
import Bluetooth from "./bar/Bluetooth"
import Network from "./bar/Network"
import Volume from "./bar/Volume"
import Battery from "./bar/Battery"
import CpuRam from "./bar/CpuRam"
import Recording from "./bar/Recording"
import MicIndicator from "./bar/MicIndicator"
import NotificationButton from "./bar/NotificationButton"
import PowerButton from "./bar/PowerButton"
import { anyPanelVisible, setBarVisible, setWidgetsRefresh, openQuickSettings, quickSettingsVisible, closeAllPanels, isWsDragging, barPinnedByKey, setBarPinnedByKey } from "./state";

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const [visible, setVisible] = createState(true)
  const [isHovered, setIsHovered] = createState(false)
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let shownAt = 0
  let lastY = 0
  const BAR_HEIGHT = 38
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

  function handleHide() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    if (!visible()) return
    if (barPinnedByKey.get()) return
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!isHovered() && !anyPanelVisible.get() && !isWsDragging() && !barPinnedByKey.get()) {
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
    if (isHovered() || anyPanelVisible.get()) {
      handleShow()
    } else {
      handleHide()
    }
  }

  isHovered.subscribe(checkVisibility)
  anyPanelVisible.subscribe(checkVisibility)
  isWsDragging.subscribe((dragging) => { if (!dragging) checkVisibility() })

  barPinnedByKey.subscribe((pinned) => {
    if (pinned) {
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      setWidgetsRefresh(true)
      shownAt = Date.now()
      setBarVisible(true)
      setVisible(true)
    } else {
      checkVisibility()
    }
  })

  // Auto-ocultado inicial: el bar arranca visible para que se vea al iniciar
  // sesión, pero checkVisibility() solo corre dentro de los .subscribe(), que no
  // disparan en el arranque. Sin esto, el bar quedaba fijo hasta el primer hover.
  // Tras un breve margen, si no hay hover ni paneles abiertos, se oculta solo.
  // (Hide directo: omite los guards de flicker —lastY/SHOW_LOCK— que no aplican
  // en el arranque, donde lastY=0 los bloquearía.)
  setTimeout(() => {
    if (!isHovered() && !anyPanelVisible.get() && !isWsDragging() && !barPinnedByKey.get()) {
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
    exclusivity={Astal.Exclusivity.NORMAL}
    focusable={true}
    anchor={TOP | LEFT | RIGHT}
    application={app}
    keymode={Astal.Keymode.ON_DEMAND}
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
    <centerbox css="margin-left: 9px; margin-right: 10px;">
      <box $type="start" halign={Gtk.Align.START} spacing={6}>
        <Clock />
        <box spacing={1}>
          <Functions />
          <Workspaces />
        </box>
      </box>

      <box $type="center" halign={Gtk.Align.CENTER} spacing={8}>
        <GameIndicator />
      </box>

      <box $type="end" halign={Gtk.Align.END} spacing={2} css="margin-left: 20px;">
        <SystemTray />
        <box cssClasses={["bar-status-pair"]} spacing={0}>
          <NotificationButton />
          <button
            cssClasses={["bar-pill-btn"]}
            onClicked={() => quickSettingsVisible.get() ? closeAllPanels() : openQuickSettings()}
          >
            <box cssClasses={["bar-pill", "qs-system-pill"]}>
              <Bluetooth />
              <MicIndicator />
              <Network />
              <Volume />
              <Battery />
            </box>
          </button>
        </box>
        <box spacing={3}>
          <Recording />
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
