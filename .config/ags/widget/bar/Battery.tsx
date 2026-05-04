import AstalBattery from "gi://AstalBattery"
import { createState } from "ags"
import { Gtk } from "ags/gtk4"

export default function Battery() {
  const bat = AstalBattery.get_default()
  if (!bat) return (<box />)

  const [pctStr, setPctStr] = createState(`${Math.round(bat.percentage * 100)}`)
  const [charging, setCharging] = createState(bat.charging)
  
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

  const [tooltip, setTooltip] = createState(getTooltip())
  
  const getGradient = () => {
    const p = bat.percentage * 100
    const color = bat.charging ? "#a6e3a1" : (p < 20 ? "#f38ba8" : p < 60 ? "#f9e2af" : "#a6e3a1")
    return `
      background: linear-gradient(to right, 
        ${color} ${Math.round(p)}%, 
        rgba(17, 17, 27, 0.6) ${Math.round(p)}%
      );
      border-radius: 99px;
    `
  }

  const [cssStr, setCssStr] = createState(getGradient())
  const [cssClass, setCssClass] = createState(
    ["battery-pill", bat.percentage * 100 < 20 ? "low" : bat.percentage * 100 < 60 ? "medium" : "normal"]
  )

  const updateVars = () => {
    setPctStr(`${Math.round(bat.percentage * 100)}`)
    setCharging(bat.charging)
    setCssStr(getGradient())
    setCssClass(["battery-pill", bat.percentage * 100 < 20 ? "low" : bat.percentage * 100 < 60 ? "medium" : "normal"])
    setTooltip(getTooltip())
  }

  bat.connect("notify::percentage", updateVars)
  bat.connect("notify::charging", updateVars)
  bat.connect("notify::time-to-empty", updateVars)
  bat.connect("notify::time-to-full", updateVars)
  bat.connect("notify::energy-rate", updateVars)

  return (
    <box 
      cssClasses={cssClass}
      css={cssStr}
      tooltipText={tooltip}
    >
      <box halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} hexpand vexpand>
        <label
          cssClasses={["battery-charging-icon"]}
          label="󰂄 "
          visible={charging}
        />
        <label
          cssClasses={["battery-text"]}
          label={pctStr}
        />
      </box>
    </box>
  )
}
