import GLib from "gi://GLib"
import { createState } from "ags"
import { Gtk } from "ags/gtk4"

export default function Clock() {
  const now = GLib.DateTime.new_now_local()
  const [time, setTime] = createState(now.format("%H:%M") ?? "")
  const [stopwatch, setStopwatch] = createState(0)
  const [running, setRunning] = createState(false)
  let swInterval: number | null = null
  let startTime = 0

  GLib.timeout_add(GLib.PRIORITY_DEFAULT, (60 - now.get_second()) * 1000, () => {
    setTime(GLib.DateTime.new_now_local().format("%H:%M") ?? "")
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60000, () => {
      setTime(GLib.DateTime.new_now_local().format("%H:%M") ?? "")
      return GLib.SOURCE_CONTINUE
    })
    return GLib.SOURCE_REMOVE
  })

  function formatSW(secs: number) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }

  function startStopwatch() {
    //hay un problema con elcronometro, el interval tiene desvio, esto provoca error acumulativo a la hora de actualizar el cronometro, para solucionarlo se calcula el tiempo transcurrido desde el inicio y se programa el siguiente tick para que ocurra justo al siguiente segundo completo, asi se corrige el desvio en cada tick. no es la solucion mas elegante pero es efectiva y sencilla de implementar
    startTime = Date.now()
    setStopwatch(0)
    setRunning(true)

    function tick() {
      const elapsed = Date.now() - startTime
      setStopwatch(Math.round(elapsed / 1000))

      const nextTick = 1000 - (elapsed % 1000)
      swInterval = GLib.timeout_add(GLib.PRIORITY_HIGH, nextTick, () => {
        tick()
        return GLib.SOURCE_REMOVE
      })
    }

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
  return (
    <menubutton
      valign={Gtk.Align.CENTER}
      cssClasses={running((r) => r ? ["clock", "stopwatch"] : ["clock"])}
    >
      <label label={running((r) => r ? formatSW(stopwatch()) : time())} />
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