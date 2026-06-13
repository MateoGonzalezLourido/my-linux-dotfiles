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

  const fillColor = () => {
    const p = bat.percentage * 100
    if (bat.charging) return "#a6e3a1"   // verde
    if (p <= 15) return "#f38ba8"        // rojo
    return "#89b4fa"                     // azul
  }

  // Relleno proporcional dentro del cuerpo de la batería:
  // color hasta el nivel actual, hueco oscuro el resto (texto blanco legible sobre ambos).
  const getFill = () => {
    const p = Math.round(bat.percentage * 100)
    const color = fillColor()
    return `
      background: linear-gradient(to top,
        ${color} ${p}%,
        rgba(0, 0, 0, 0.40) ${p}%
      );
    `
  }

  const [pctStr, setPctStr]     = createState(`${Math.round(bat.percentage * 100)}`)
  const [charging, setCharging] = createState(bat.charging)
  const [cssStr, setCssStr]     = createState(getFill())
  const [bodyClass, setBodyClass] = createState(
    ["battery-body", bat.percentage * 100 <= 15 ? "low" : "normal"]
  )
  const [tooltip, setTooltip]   = createState(getTooltip())

  const sync = () => {
    setPctStr(`${Math.round(bat.percentage * 100)}`)
    setCharging(bat.charging)
    setCssStr(getFill())
    setBodyClass(["battery-body", bat.percentage * 100 <= 15 ? "low" : "normal"])
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
      orientation={Gtk.Orientation.VERTICAL}
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      tooltipText={tooltip}
    >
      <box cssClasses={["battery-cap"]} halign={Gtk.Align.CENTER} />
      <box
        cssClasses={bodyClass}
        css={cssStr}
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.FILL}
        valign={Gtk.Align.CENTER}
      >
        <label
          cssClasses={["battery-charging-icon"]}
          label=""
          visible={charging}
          halign={Gtk.Align.CENTER}
        />
        <label
          cssClasses={["battery-text"]}
          label={pctStr}
          hexpand={true}
          vexpand={true}
          valign={Gtk.Align.CENTER}
          halign={Gtk.Align.CENTER}
          xalign={0.5}
          yalign={0.5}
        />
      </box>
    </box>
  )
}
