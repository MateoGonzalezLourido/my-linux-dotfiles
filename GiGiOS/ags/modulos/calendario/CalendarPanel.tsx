import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { calendarVisible, setCalendarVisible, panelAutoClose } from "../../estado/shell"
import { MonthView } from "./MonthView"
import { AgendaView } from "./AgendaView"
import { EventDialog } from "./EventDialog"
import { currentView, setCurrentView } from "./store"
import { barTopMargin } from "../ajustes/preferences"

export default function CalendarPanel(gdkmonitor: Gdk.Monitor) {
  const { LEFT, TOP, BOTTOM } = Astal.WindowAnchor

  // ── View stack (Mes / Agenda) ─────────────────────────────────────────────
  const stack = new Gtk.Stack()
  const monthWidget  = MonthView()
  const agendaWidget = AgendaView()
  stack.add_named(monthWidget, "month")
  stack.add_named(agendaWidget, "agenda")
  stack.set_visible_child_name(currentView.get())
  currentView.subscribe((v) => stack.set_visible_child_name(v))

  // ── View tab buttons ──────────────────────────────────────────────────────
  const monthTabBtn = new Gtk.Button()
  monthTabBtn.set_label("Mes")
  monthTabBtn.set_css_classes(
    currentView.get() === "month"
      ? ["cal-view-tab", "active"]
      : ["cal-view-tab"]
  )
  monthTabBtn.connect("clicked", () => setCurrentView("month"))

  const agendaTabBtn = new Gtk.Button()
  agendaTabBtn.set_label("Agenda")
  agendaTabBtn.set_css_classes(
    currentView.get() === "agenda"
      ? ["cal-view-tab", "active"]
      : ["cal-view-tab"]
  )
  agendaTabBtn.connect("clicked", () => setCurrentView("agenda"))

  currentView.subscribe((v) => {
    monthTabBtn.set_css_classes(v === "month" ? ["cal-view-tab", "active"] : ["cal-view-tab"])
    agendaTabBtn.set_css_classes(v === "agenda" ? ["cal-view-tab", "active"] : ["cal-view-tab"])
  })

  const tabsBox = new Gtk.Box({ spacing: 2 })
  tabsBox.set_css_classes(["cal-view-tabs"])
  tabsBox.append(monthTabBtn)
  tabsBox.append(agendaTabBtn)

  // ── Event dialog (always rendered, shows/hides internally) ────────────────
  const eventDialog = EventDialog()

  // ── Overlay (dialog over content) ─────────────────────────────────────────
  const overlay = new Gtk.Overlay()
  overlay.set_child(stack)
  overlay.add_overlay(eventDialog)

  // Auto-cierre al salir el ratón (consistente con el resto de paneles del bar).
  const calAutoClose = panelAutoClose(() => setCalendarVisible(false), 300, calendarVisible)
  const [keyboardActive, setKeyboardActive] = createState(false)

  calendarVisible.subscribe(() => setKeyboardActive(false))

  const handlePointerEnter = () => {
    calAutoClose.onEnter()
    setKeyboardActive(true)
  }

  return <window
    name="calendar-panel"
    gdkmonitor={gdkmonitor}
    application={app}
    visible={calendarVisible((v) => v)}
    anchor={LEFT | TOP | BOTTOM}
    layer={Astal.Layer.TOP}
    exclusivity={Astal.Exclusivity.IGNORE}
    keymode={keyboardActive((active) =>
      active ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
    marginTop={barTopMargin(37)}
    widthRequest={720}
    cssClasses={["cal-panel"]}
  >
    <Gtk.EventControllerKey
      onKeyPressed={(_self, keyval) => {
        if (keyval === Gdk.KEY_Escape) {
          setCalendarVisible(false)
          return true
        }
        return false
      }}
    />
    <box orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.EventControllerMotion onEnter={handlePointerEnter} onLeave={calAutoClose.onLeave} />
      {/* Titlebar */}
      <box cssClasses={["cal-titlebar"]}>
        <label
          label="Calendario"
          hexpand
          halign={Gtk.Align.START}
          cssClasses={["cal-panel-title"]}
        />
        {tabsBox}
        <button
          cssClasses={["cal-icon-btn"]}
          onClicked={() => setCalendarVisible(false)}
        >
          <label label="✕" />
        </button>
      </box>

      {/* Main content: stack with overlay for dialog */}
      <box hexpand vexpand>
        {overlay}
      </box>
    </box>
  </window>
}
