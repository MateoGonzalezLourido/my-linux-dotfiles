import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import {
  closeAllPanels,
  functionsMenuVisible,
  panelAutoClose,
  setFunctionsMenuVisible,
} from "../../estado/shell"
import { BAR_FUNCTIONS } from "./functions/state"
import FilaFuncion from "./functions/FilaFuncion"
import { barTopMargin } from "../ajustes/preferences"
import { crearCicloVida } from "../../utilidades/cicloVida"

// 150 se quedaba corto desde que el Wake up despliega "Minutos + campo" y
// "Pantalla + ON/OFF" bajo su fila.
const ANCHO_MENU = 185

function alternarMenuFunciones() {
  if (functionsMenuVisible.get()) {
    setFunctionsMenuVisible(false)
  } else {
    closeAllPanels()
    setFunctionsMenuVisible(true)
  }
}

export function FunctionsMenu(gdkmonitor: Gdk.Monitor) {
  const cicloVida = crearCicloVida()
  const { TOP, LEFT } = Astal.WindowAnchor
  const autoCierre = panelAutoClose(() => setFunctionsMenuVisible(false), 300, functionsMenuVisible)
  const [tecladoActivo, establecerTecladoActivo] = createState(false)

  // No pedir foco al mapear: con el puntero aún sobre el botón del bar,
  // Hyprland no redirige el siguiente clic hasta recibir motion.
  cicloVida.suscribir(functionsMenuVisible, () => establecerTecladoActivo(false))

  const manejarEntrada = () => {
    autoCierre.onEnter()
    establecerTecladoActivo(true)
  }

  return (
    <window
      name="functions-menu"
      visible={functionsMenuVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={tecladoActivo((activo) =>
        activo ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
      anchor={TOP | LEFT}
      application={app}
      widthRequest={ANCHO_MENU}
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
        <Gtk.EventControllerMotion onEnter={manejarEntrada} onLeave={autoCierre.onLeave} />
        {BAR_FUNCTIONS.map((funcion) => <FilaFuncion funcion={funcion} />)}
      </box>
    </window>
  )
}

export default function Functions() {
  return (
    <button
      cssClasses={["bar-pill-btn", "own-functions-button"]}
      focusable={false}
      onClicked={alternarMenuFunciones}
    >
      <box cssClasses={["bar-pill", "own-functions"]} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
        <label label="󰣇" halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} hexpand />
      </box>
    </button>
  )
}
