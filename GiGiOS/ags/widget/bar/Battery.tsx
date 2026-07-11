import AstalBattery from "gi://AstalBattery"
import GLib from "gi://GLib"
import { For, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { widgetsRefresh } from "../state"

const SEGMENTS = 5
const LOW_BATTERY_THRESHOLD = 10
const WARN_BATTERY_THRESHOLD = 15

export default function Battery() {
  const bat = AstalBattery.get_default()
  // AstalBattery puede existir como servicio aunque el equipo no tenga una
  // batería física. En ese caso no se muestra ningún hueco en la barra.
  if (!bat?.isPresent) return (<box visible={false} />)

  const powerNowPath = [
    bat.nativePath ? `${bat.nativePath}/power_now` : "",
    "/sys/class/power_supply/BAT0/power_now",
  ].find((path) => path && GLib.file_test(path, GLib.FileTest.EXISTS))

  const readInstantPower = () => {
    if (!powerNowPath) return null
    try {
      const [ok, bytes] = GLib.file_get_contents(powerNowPath)
      if (!ok) return null
      const microwatts = Number(new TextDecoder().decode(bytes).trim())
      return Number.isFinite(microwatts) && microwatts >= 0 ? microwatts / 1_000_000 : null
    } catch {
      return null
    }
  }

  let instantPower = readInstantPower()

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
    const watts = instantPower ?? Math.abs(bat.energyRate)
    if (watts > 0) {
      const sign = bat.charging ? "+" : "-"
      text += `\n${sign} ${watts.toFixed(1)}w`
    }
    return text
  }

  const statusClass = () => {
    const p = bat.percentage * 100
    if (bat.charging) return "charging"
    if (p <= LOW_BATTERY_THRESHOLD) return "low"
    return "normal"
  }

  const getSegmentClasses = () => {
    const pct = Math.round(bat.percentage * 100)
    const charging = bat.charging && pct < 100 && bat.state !== AstalBattery.State.FULLY_CHARGED
    const low = !bat.charging && pct <= LOW_BATTERY_THRESHOLD
    const warnLow = !charging && !low && pct <= WARN_BATTERY_THRESHOLD
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
    const warnSegment = !charging && !low && pct < 100 && (pct <= segmentMiddle || warnLow)

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

  // AstalBattery/UPower puede mantener energyRate cacheado durante bastante
  // tiempo. Leer power_now directamente fuerza una muestra nueva del kernel.
  const tooltipTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
    instantPower = readInstantPower()
    setTooltip(getTooltip())
    return GLib.SOURCE_CONTINUE
  })

  const sync = () => {
    setBodyClass(["battery-body", statusClass()])
    setSegmentClasses(getSegmentClasses())
    setTooltip(getTooltip())
  }

  // Mantener el estado local actualizado incluso con la barra oculta. Ignorar
  // estos eventos creaba una carrera al mostrarla: widgetsRefresh sincronizaba
  // antes de que barVisible pasara a true y cualquier cambio durante esa ventana
  // se perdía hasta la siguiente notificación de UPower.
  bat.connect("notify::percentage",    sync)
  bat.connect("notify::charging",      sync)
  bat.connect("notify::state",         sync)   // carga↔descarga y cargando→cargado
  bat.connect("notify::time-to-empty", sync)
  bat.connect("notify::time-to-full",  sync)
  bat.connect("notify::energy-rate",   sync)

  // Al volver visible, sincronizar con el estado real del hardware.
  // gnim invoca el callback sin argumentos → hay que leer .get().
  widgetsRefresh.subscribe(() => {
    if (widgetsRefresh.get()) sync()
  })

  return (
    <box
      cssClasses={["battery"]}
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={3}
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      tooltipText={tooltip}
      $={(self: Gtk.Box) => self.connect("destroy", () => GLib.source_remove(tooltipTimer))}
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
