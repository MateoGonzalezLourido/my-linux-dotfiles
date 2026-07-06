import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { orionVisible, setOrionVisible, taskPanelVisible, rightPanelVisible, hidePanel } from "./state"
import TabsBar from "./components/TabsBar"
import SearchBar, { focusSearchAndType } from "./components/SearchBar"
import NavSections from "./components/NavSections"
import CornerCurve from "./components/CornerCurve"
import TaskPanel from "./components/TaskPanel"
import RightPanel from "./components/RightPanel"

export default function Orion(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  // Build panel container imperatively to hold a reference for hit-test
  const panelContainer = new Gtk.Box({
    hexpand: true,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.END,
  })

  // Three-panel shell: [task?][sep?][orion-main][sep?][right?]
  // overflow:hidden clips all columns to shared border-radius.
  // Symmetric balance spacers outside the CornerCurves keep orion-main centred.
  const panelInner = (
    <box cssClasses={["orion-panel"]}>
      <TaskPanel />
      <box cssClasses={["tp-sep"]} visible={taskPanelVisible(v => v)} />
      <box cssClasses={["orion-main"]} orientation={Gtk.Orientation.VERTICAL}>
        <box cssClasses={["orion-handle"]} halign={Gtk.Align.CENTER}>
          <box cssClasses={["handle-bar"]} />
        </box>
        <box cssClasses={["tabs-bar-container"]}>
          <TabsBar />
        </box>
        <SearchBar />
        <NavSections />
      </box>
      <box cssClasses={["tp-sep"]} visible={rightPanelVisible(v => v)} />
      <RightPanel />
    </box>
  ) as unknown as Gtk.Widget

  // balanceL: mirrors right panel (goes on LEFT of CornerCurveL)
  // balanceR: mirrors task panel (goes on RIGHT of CornerCurveR)
  const balanceL = (<box cssClasses={["orion-balance"]} visible={rightPanelVisible(v => v)} />) as unknown as Gtk.Widget
  const balanceR = (<box cssClasses={["orion-balance"]} visible={taskPanelVisible(v => v)}  />) as unknown as Gtk.Widget

  panelContainer.append(balanceL)
  panelContainer.append(CornerCurve({ left: true }) as unknown as Gtk.Widget)
  panelContainer.append(panelInner)
  panelContainer.append(CornerCurve({ left: false }) as unknown as Gtk.Widget)
  panelContainer.append(balanceR)

  const win = (
    <window
      name="orion"
      visible={orionVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      anchor={BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      application={app}
      decorated={false}
      deletable={false}
      marginTop={40}
      cssClasses={["Orion"]}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval, _keycode, state) => {
          if (keyval === Gdk.KEY_Escape) { hidePanel(); return true }
          const s = state as unknown as number
          const CTRL = 4, ALT = 8, SUPER = 0x4000000
          if (!(s & CTRL) && !(s & ALT) && !(s & SUPER)) {
            const cp = Gdk.keyval_to_unicode(keyval)
            if (cp >= 0x20) { focusSearchAndType(String.fromCodePoint(cp)); return true }
          }
          return false
        }}
      />

      <box hexpand>
        <Gtk.GestureClick onPressed={(self: Gtk.GestureClick, _n: number, x: number, y: number) => {
          const outerBox = self.get_widget() as Gtk.Widget
          const hit = outerBox.pick(x, y, 0)
          let w: Gtk.Widget | null = hit
          while (w && w !== outerBox) {
            if (w === panelContainer) return
            w = w.get_parent()
          }
          hidePanel()
        }} />
        {panelContainer as unknown as any}
      </box>
    </window>
  ) as unknown as Gtk.Widget

  // El atajo abre Jarvis con `ags toggle orion`, que alterna la ventana a nivel
  // GTK sin pasar por el estado. Sincronizamos el estado con la visibilidad real
  // para que orionVisible siga siendo la fuente de verdad (poll de stats,
  // anyPanelVisible del bar, foco de búsqueda, etc.).
  ;(win as any).connect("notify::visible", () => setOrionVisible((win as any).visible))

  return win
}
