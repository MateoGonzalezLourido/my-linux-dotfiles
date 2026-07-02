import AstalBattery from "gi://AstalBattery"
import { For, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { barVisible, widgetsRefresh } from "../state"

const SEGMENTS = 5

export default function Battery() {
  const bat = AstalBattery.get_default()
  if (!bat) return (<box />)

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  const getTooltip = () => {
    let text = ""
    if (bat.charging && (bat.percentage >= 1 || bat.state === AstalBattery.State.FULLY_CHARGED)) {
      text = "cargado"
    } else if (bat.charging) {
      text = bat.timeToFull > 0 ? `+ ${formatTime(bat.timeToFull)}` : `+ ${Math.round(bat.percentage * 100)}`
    } else {
      text = bat.timeToEmpty > 0 ? `- ${formatTime(bat.timeToEmpty)}` : `- ${Math.round(bat.percentage * 100)}`
    }
    if (bat.energyRate > 0) {
      const sign = bat.charging ? "+" : "-"
      text += `\n${sign} ${bat.energyRate.toFixed(1)}w`
    }
    return text
  }

  const statusClass = () => {
    const p = bat.percentage * 100
    if (bat.charging) return "charging"
    if (p <= 15) return "low"
    return "normal"
  }

  const getSegmentClasses = () => {
    const pct = Math.round(bat.percentage * 100)
    const charging = bat.charging && pct < 100 && bat.state !== AstalBattery.State.FULLY_CHARGED
    const low = !bat.charging && pct <= 15
    const segmentSize = 100 / SEGMENTS
    const active = Math.min(SEGMENTS - 1, Math.floor(pct / (100 / SEGMENTS)))
    const filled = charging
      ? active
      : pct > 0
        ? Math.ceil(pct / (100 / SEGMENTS))
        : 0
    const draining = Math.max(0, filled - 1)
    const segmentStart = draining * segmentSize
    const segmentMiddle = segmentStart + segmentSize / 2
    const warnSegment = !charging && !low && pct < 100 && pct <= segmentMiddle

    return Array.from({ length: SEGMENTS }, (_, i) => {
      const classes = ["battery-seg"]
      if (i < filled) classes.push("filled")
      if (warnSegment && i === draining) classes.push("warn")
      if (charging && i === active) classes.push("charging-blink")
      if (low && i === 0) classes.push("low-blink", "filled")
      return classes
    })
  }

  const [bodyClass, setBodyClass] = createState(["battery-body", statusClass()])
  const [segmentClasses, setSegmentClasses] = createState(getSegmentClasses())
  const [tooltip, setTooltip]   = createState(getTooltip())

  const sync = () => {
    setBodyClass(["battery-body", statusClass()])
    setSegmentClasses(getSegmentClasses())
    setTooltip(getTooltip())
  }

  const updateVars = () => {
    if (!barVisible.get()) return
    sync()
  }

  bat.connect("notify::percentage",    updateVars)
  bat.connect("notify::charging",      updateVars)
  bat.connect("notify::time-to-empty", updateVars)
  bat.connect("notify::time-to-full",  updateVars)
  bat.connect("notify::energy-rate",   updateVars)

  // Al volver visible, sincronizar con el estado real del hardware
  widgetsRefresh.subscribe((v) => {
    if (v) sync()
  })

  return (
    <box
      cssClasses={["battery"]}
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={3}
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      tooltipText={tooltip}
    >
      <box
        cssClasses={bodyClass}
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={1}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        <For each={segmentClasses}>
          {(classes) => <box cssClasses={classes} />}
        </For>
      </box>
      <box cssClasses={["battery-cap"]} valign={Gtk.Align.CENTER} />
    </box>
  )
}
