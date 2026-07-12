import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { orionVisible, setOrionVisible, rightPanelVisible, hidePanel, preparePanelOpen } from "./state"
import SectionIndex from "./components/SectionIndex"
import SearchBar, { focusSearchAndType } from "./components/SearchBar"
import NavSections from "./components/NavSections"
import { SystemStats } from "./components/sections/HomeSection"
import CornerCurve from "./components/CornerCurve"
import RightPanel from "./components/RightPanel"

export default function Orion(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  // Build panel container imperatively to hold a reference for hit-test
  const panelContainer = new Gtk.Box({
    hexpand: true,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.END,
  })

  // Panel shell: [orion-main][separator?][right?]
  // overflow:hidden clips all columns to shared border-radius.
  // A balance spacer outside the left curve keeps orion-main centred while the
  // contextual panel is visible on the right.
  const panelInner = (
    <box cssClasses={["orion-panel"]}>
      <box cssClasses={["orion-main"]} orientation={Gtk.Orientation.VERTICAL}>
        <box cssClasses={["section-index-container"]}>
          <SectionIndex />
        </box>
        <SearchBar />
        <NavSections />
        <SystemStats />
      </box>
      <box cssClasses={["orion-panel-sep"]} visible={rightPanelVisible(v => v)} />
      <RightPanel />
    </box>
  ) as unknown as Gtk.Widget

  // Mirrors the contextual panel on the opposite side of the main content.
  const balanceL = (<box cssClasses={["orion-balance"]} visible={rightPanelVisible(v => v)} />) as unknown as Gtk.Widget

  panelContainer.append(balanceL)
  panelContainer.append(CornerCurve({ left: true }) as unknown as Gtk.Widget)
  panelContainer.append(panelInner)
  panelContainer.append(CornerCurve({ left: false }) as unknown as Gtk.Widget)

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
  ;(win as any).connect("notify::visible", () => {
    const visible = (win as any).visible
    if (visible && !orionVisible.get()) preparePanelOpen()
    setOrionVisible(visible)
  })

  return win
}
