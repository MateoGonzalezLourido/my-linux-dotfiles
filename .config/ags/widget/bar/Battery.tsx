import AstalBattery from "gi://AstalBattery"
import { createState } from "ags"
import { Gtk } from "ags/gtk4"
import { barVisible, widgetsRefresh } from "../state"

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

  const getGradient = () => {
    const p = bat.percentage * 100
    const color = bat.charging ? "#6eff61ff" : (p <= 15 ? "#f38ba8" : "#f0f0f0ff")
    return `
      background: linear-gradient(to right,
        ${color} ${Math.round(p)}%,
        rgba(255, 255, 255, 0.4) ${Math.round(p)}%
      );
      border-radius: 99px;
    `
  }

  const [pctStr, setPctStr]   = createState(`${Math.round(bat.percentage * 100)}`)
  const [charging, setCharging] = createState(bat.charging)
  const [cssStr, setCssStr]   = createState(getGradient())
  const [cssClass, setCssClass] = createState(
    ["battery-pill", bat.percentage * 100 <= 15 ? "low" : "normal"]
  )
  const [tooltip, setTooltip] = createState(getTooltip())

  const updateVars = () => {
    if (!barVisible.get()) return
    setPctStr(`${Math.round(bat.percentage * 100)}`)
    setCharging(bat.charging)
    setCssStr(getGradient())
    setCssClass(["battery-pill", bat.percentage * 100 <= 15 ? "low" : "normal"])
    setTooltip(getTooltip())
  }

  bat.connect("notify::percentage",   updateVars)
  bat.connect("notify::charging",     updateVars)
  bat.connect("notify::time-to-empty", updateVars)
  bat.connect("notify::time-to-full",  updateVars)
  bat.connect("notify::energy-rate",   updateVars)

  // Al volver visible, sincronizar con el estado real del hardware
  widgetsRefresh.subscribe((v) => {
    if (v) {
      setPctStr(`${Math.round(bat.percentage * 100)}`)
      setCharging(bat.charging)
      setCssStr(getGradient())
      setCssClass(["battery-pill", bat.percentage * 100 <= 15 ? "low" : "normal"])
      setTooltip(getTooltip())
    }
  })

  return (
    <box
      cssClasses={cssClass}
      css={cssStr}
      tooltipText={tooltip}
      spacing={0}
      halign={Gtk.Align.CENTER}
    >
      <label
        cssClasses={["battery-charging-icon"]}
        label="󰂄"
        visible={charging}
        valign={Gtk.Align.CENTER}
      />
      <label
        cssClasses={["battery-text"]}
        label={pctStr}
        valign={Gtk.Align.CENTER}
        halign={Gtk.Align.CENTER}
        xalign={0.5}
      />
    </box>
  )
}
