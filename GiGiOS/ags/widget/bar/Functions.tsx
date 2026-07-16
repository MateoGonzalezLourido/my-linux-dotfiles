import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, With } from "ags"
import {
  closeAllPanels,
  functionsMenuVisible,
  panelAutoClose,
  setFunctionsMenuVisible,
} from "../state"
import { BAR_FUNCTIONS, type BarFunction } from "./functions/state"
import { barTopMargin } from "../settings/preferences"

// 150 se quedaba corto desde que el Wake up despliega "Minutos + campo" y
// "Pantalla + ON/OFF" bajo su fila.
const MENU_WIDTH = 185

function toggleFunctionsMenu() {
  if (functionsMenuVisible.get()) {
    setFunctionsMenuVisible(false)
  } else {
    closeAllPanels()
    setFunctionsMenuVisible(true)
  }
}

// Chip derecho: el texto propio de la función (Wake up enseña su cuenta atrás) o
// el ON/OFF de serie.
function StateChip({ item, on }: { item: BarFunction; on: boolean }) {
  if (!item.status) return <label label={on ? "ON" : "OFF"} />
  return <With value={item.status}>{(text: string) => <label label={text} />}</With>
}

function FunctionRow({ item }: { item: BarFunction }) {
  return (
    // Cada <With> dentro de su propio <box>. Un <With> que se remonta se inserta al
    // FINAL de su contenedor, no en su hueco: sin estas cajas, encender una función
    // mandaría su fila al final del menú (y la dejaría por debajo de su propio
    // desplegable). Mismo remedio que CpuRam / ScreencastIndicator en Bar.tsx.
    <box orientation={Gtk.Orientation.VERTICAL}>
      <box>
        <With value={item.enabled}>
          {(on: boolean) => (
            <button
              cssClasses={on ? ["fn-menu-button", "active"] : ["fn-menu-button"]}
              focusable={false}
              hexpand
              onClicked={() => item.toggle(!item.enabled.get())}
            >
              <box cssClasses={["fn-menu-row"]} spacing={6}>
                <label
                  cssClasses={["fn-menu-label"]}
                  label={item.label}
                  xalign={0}
                  hexpand
                />
                <box cssClasses={["fn-menu-state"]}>
                  <StateChip item={item} on={on} />
                </box>
              </box>
            </button>
          )}
        </With>
      </box>
      {item.expand ? (
        <box>
          <With value={item.enabled}>
            {(on: boolean) => on && item.expand!()}
          </With>
        </box>
      ) : null}
    </box>
  )
}

export function FunctionsMenu(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT } = Astal.WindowAnchor
  const autoClose = panelAutoClose(() => setFunctionsMenuVisible(false), 300, functionsMenuVisible)
  const [keyboardActive, setKeyboardActive] = createState(false)

  // No pedir foco al mapear: con el puntero aún sobre el botón del bar,
  // Hyprland no redirige el siguiente clic hasta recibir motion.
  functionsMenuVisible.subscribe(() => setKeyboardActive(false))

  const handleEnter = () => {
    autoClose.onEnter()
    setKeyboardActive(true)
  }

  return (
    <window
      name="functions-menu"
      visible={functionsMenuVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={keyboardActive((active) =>
        active ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
      anchor={TOP | LEFT}
      application={app}
      widthRequest={MENU_WIDTH}
      marginTop={barTopMargin(37)}
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
        <Gtk.EventControllerMotion onEnter={handleEnter} onLeave={autoClose.onLeave} />
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
