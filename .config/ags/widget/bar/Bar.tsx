import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"

import Clock         from "./bar/Clock"
import Functions     from "./bar/Functions"
import Workspaces    from "./bar/Workspaces"
import MediaPlayer   from "./bar/MediaPlayer"
import SystemTray    from "./bar/SystemTray"
import Bluetooth     from "./bar/Bluetooth"
import Network       from "./bar/Network"
import Volume        from "./bar/Volume"
import Battery       from "./bar/Battery"
import CpuRam        from "./bar/CpuRam"
import Recording     from "./bar/Recording"
import Notifications from "./bar/Notifications"
import PowerButton   from "./bar/PowerButton"

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const [visible, setVisible] = createState(true)

  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function show() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    setVisible(true)
  }

  function scheduleHide() {
    hideTimer = setTimeout(() => setVisible(false), 500)
  }

  return (
    <window
      visible
      name="bar"
      cssName="Bar"
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.NORMAL}
      anchor={TOP | LEFT | RIGHT}
      application={app}
      cssClasses={visible((v) => v ? ["bar-visible"] : ["bar-hidden"])}
      css="background-color: rgba(8,8,12,0.92); border-radius: 0 0 12px 12px; padding: 0 14px; min-height: 38px;"
    >
      <centerbox>
        {/* IZQUIERDA */}
        <box $type="start" halign={Gtk.Align.START} spacing={6}>
          <Clock />
          <Functions />
          <Workspaces />
        </box>

        {/* CENTRO */}
        <box $type="center" halign={Gtk.Align.CENTER}>
          <MediaPlayer />
        </box>

        {/* DERECHA */}
        <box $type="end" halign={Gtk.Align.END} spacing={6}>
          <SystemTray />
          <Bluetooth />
          {/* Grupo: notifs | wifi | volumen | batería */}
          <box
            css="background-color: rgba(255,255,255,0.07); border-radius: 8px; border: 1px solid rgba(255,255,255,0.09); padding: 2px 6px; margin: 0 2px;"
            spacing={4}
          >
            <Notifications />
            <label css="color: rgba(255,255,255,0.12); font-size: 11px;" label="|" />
            <Network />
            <Volume />
            <Battery />
          </box>
          {/* CPU | RAM */}
          <CpuRam />
          <Recording />
          <PowerButton />
        </box>
      </centerbox>

      <Gtk.EventControllerMotion
        onEnter={show}
        onLeave={scheduleHide}
      />
    </window>
  )
}
