import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { With } from "ags"
import {
  closeAllPanels,
  functionsMenuVisible,
  panelAutoClose,
  setFunctionsMenuVisible,
} from "../state"
import { BAR_FUNCTIONS, type BarFunction } from "./functions/state"

function toggleFunctionsMenu() {
  if (functionsMenuVisible.get()) {
    setFunctionsMenuVisible(false)
  } else {
    closeAllPanels()
    setFunctionsMenuVisible(true)
  }
}

function FunctionRow({ item }: { item: BarFunction }) {
  return (
    <With value={item.enabled}>
      {(on: boolean) => (
        <button
          cssClasses={on ? ["fn-menu-button", "active"] : ["fn-menu-button"]}
          focusable={false}
          onClicked={() => item.toggle(!item.enabled.get())}
        >
          <box cssClasses={["fn-menu-row"]} spacing={8}>
            <label cssClasses={["fn-menu-ic"]} label={item.icon} />
            <label
              cssClasses={["fn-menu-label"]}
              label={item.label}
              xalign={0}
              hexpand
            />
            <box cssClasses={["fn-menu-state"]}>
              <label label={on ? "ON" : "OFF"} />
            </box>
          </box>
        </button>
      )}
    </With>
  )
}

export function FunctionsMenu(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT } = Astal.WindowAnchor
  const autoClose = panelAutoClose(() => setFunctionsMenuVisible(false), 300, functionsMenuVisible)

  return (
    <window
      name="functions-menu"
      visible={functionsMenuVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={TOP | LEFT}
      application={app}
      widthRequest={220}
      marginTop={37}
      marginLeft={47}
      decorated={false}
      cssClasses={["fn-menu-window"]}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            setFunctionsMenuVisible(false)
            return true
          }
          return false
        }}
      />
      <box cssClasses={["fn-menu"]} orientation={Gtk.Orientation.VERTICAL}>
        <Gtk.EventControllerMotion onEnter={autoClose.onEnter} onLeave={autoClose.onLeave} />
        <label cssClasses={["fn-menu-header"]} label="Funciones" xalign={0} />
        {BAR_FUNCTIONS.map((item) => <FunctionRow item={item} />)}
      </box>
    </window>
  )
}

export default function Functions() {
  return (
    <button
      cssClasses={["bar-pill-btn", "own-functions-button"]}
      focusable={false}
      onClicked={toggleFunctionsMenu}
    >
      <box cssClasses={["bar-pill", "own-functions"]} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
        <label label="󰣇" halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} hexpand />
      </box>
    </button>
  )
}
