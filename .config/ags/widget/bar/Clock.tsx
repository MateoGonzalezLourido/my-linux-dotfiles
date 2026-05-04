import GLib from "gi://GLib"
import { createState, createEffect } from "ags"
import { Gtk } from "ags/gtk4"
import { barVisible, widgetsRefresh } from "../state.tsx";

let cacheLastTimeRendered = ""
/*NOTA: EL RELOJ NO SE PARA PORQUE SU INTERVAL ES DE 1 MINUTO, EL COSTE ES NULO, SOLO PARAMOS EL RENDER */
export default function Clock() {
  const now = GLib.DateTime.new_now_local()
  const [time, setTime] = createState(now.format("%H:%M") ?? "")
  const [stopwatch, setStopwatch] = createState(0)
  const [running, setRunning] = createState(false)
  let swInterval: number | null = null
  let startTime = 0
  //formato del reloj
  const string_clock = () => {
    const string = GLib.DateTime.new_now_local().format("%H:%M") ?? ""
    if (barVisible()) cacheLastTimeRendered = string
    return string
  }
  //logica de timers para actualizar el reloj
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, (60 - now.get_second()) * 1000, () => {
    setTime(string_clock())

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60000, () => {
      setTime(string_clock())
      return GLib.SOURCE_CONTINUE
    })

    return GLib.SOURCE_REMOVE
  })

  function formatSW(secs: number) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    const string = h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    if (barVisible()) cacheLastTimeRendered = string
    return string

  }

  function tick() {
    const elapsed = Date.now() - startTime
    setStopwatch(Math.round(elapsed / 1000))
    const nextTick = 1000 - (elapsed % 1000)
    swInterval = GLib.timeout_add(GLib.PRIORITY_HIGH, nextTick, () => {
      tick()
      return GLib.SOURCE_REMOVE
    })
  }

  function startStopwatch() {
    startTime = Date.now()
    setStopwatch(0)
    setRunning(true)
    tick()
  }

  function stopStopwatch() {
    if (swInterval !== null) {
      GLib.source_remove(swInterval)
      swInterval = null
    }
    startTime = 0
    setRunning(false)
    setStopwatch(0)
  }

  let wasVisible = widgetsRefresh()

  createEffect(() => {
    const visible = widgetsRefresh()
    if (visible && !wasVisible) {
      cacheLastTimeRendered = time()
      if (running()) {
        if (swInterval !== null) {
          GLib.source_remove(swInterval)
          swInterval = null
        }
        tick()
      }
    } else if (!visible) {
      if (swInterval !== null) {
        GLib.source_remove(swInterval)
        swInterval = null
      }
    }
    wasVisible = visible
  })
  return (
    <menubutton
      valign={Gtk.Align.CENTER}
      cssClasses={running((r) => r ? ["clock", "stopwatch"] : ["clock"])}
    >
      <label label={running((r) => r
        ? (barVisible() ? formatSW(stopwatch()) : cacheLastTimeRendered)
        : (barVisible() ? time() : cacheLastTimeRendered)
      )} />
      <Gtk.GestureClick
        button={3}
        onPressed={() => {
          if (running()) {
            stopStopwatch()
          } else {
            startStopwatch()
          }
        }}
      />
      <popover cssClasses={["calendar-popover"]}>
        <Gtk.Calendar
          cssClasses={["calendar-widget"]}
          showWeekNumbers={false}
        />
      </popover>
    </menubutton>
  )
}