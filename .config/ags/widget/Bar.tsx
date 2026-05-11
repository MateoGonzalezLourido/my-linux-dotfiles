import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"

import Clock from "./bar/Clock"
import Functions from "./bar/Functions"
import Workspaces from "./bar/Workspaces"
import MediaPlayer from "./bar/MediaPlayer"
import SystemTray from "./bar/SystemTray"
import Bluetooth from "./bar/Bluetooth"
import Network from "./bar/Network"
import Volume from "./bar/Volume"
import Battery from "./bar/Battery"
import CpuRam from "./bar/CpuRam"
import Recording from "./bar/Recording"
import Notifications from "./bar/Notifications"
import PowerButton from "./bar/PowerButton"
import { anyPanelVisible, setBarVisible, setWidgetsRefresh, openQuickSettings, quickSettingsVisible, closeAllPanels } from "./state";

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const [visible, setVisible] = createState(false)
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let showTimer: ReturnType<typeof setTimeout> | null = null
  const BAR_HEIGHT = 38

  function show() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    if (showTimer) clearTimeout(showTimer)
    setWidgetsRefresh(true)
    showTimer = setTimeout(() => {
      setBarVisible(true)
      setVisible(true)
    }, 200)
  }

  function scheduleHide() {
    if (anyPanelVisible.get()) return; 

    if (showTimer) { clearTimeout(showTimer); showTimer = null }
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      setVisible(false)
      setWidgetsRefresh(false)
      setBarVisible(false)
    }, 300)
  }

  anyPanelVisible.subscribe((v) => {
    if (v) show();
    else if (!visible.get()) scheduleHide();
  })

  const hotzone = <window
    name="bar-hotzone"
    visible={true}
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
        onEnter={show}
        onLeave={scheduleHide} />
    </box>
  </window>

  const bar = <window
    name="bar"
    visible={true}
    gdkmonitor={gdkmonitor}
    layer={Astal.Layer.TOP}
    exclusivity={Astal.Exclusivity.NORMAL}
    anchor={TOP | LEFT | RIGHT}
    application={app}
    marginTop={visible((v) => v ? 0 : -BAR_HEIGHT)}
    cssClasses={visible((v) => v ? ["Bar", "bar-visible"] : ["Bar", "bar-hidden"])}
  >
    <Gtk.EventControllerMotion
      onEnter={show}
      onLeave={scheduleHide}
    />
    <centerbox css="margin-left: 9px; margin-right: 10px;">
      <box $type="start" halign={Gtk.Align.START} spacing={6}>
        <Clock />
        <Functions />
        <Workspaces />
      </box>
      
      <box $type="center" halign={Gtk.Align.CENTER}>
        <MediaPlayer />
      </box>
      
      <box $type="end" halign={Gtk.Align.END} spacing={6} css="margin-left: 20px;">
        <SystemTray />
        <Bluetooth />
        <button
          cssClasses={["bar-pill-btn"]}
          onClicked={() => quickSettingsVisible.get() ? closeAllPanels() : openQuickSettings()}
        >
          <box cssClasses={["bar-pill"]}>
            <Notifications />
            <Network />
            <Volume />
            <Battery />
          </box>
        </button>
        <CpuRam />
        <Recording />
        <PowerButton />
      </box>
    </centerbox>
  </window>

  return [hotzone, bar]
}
