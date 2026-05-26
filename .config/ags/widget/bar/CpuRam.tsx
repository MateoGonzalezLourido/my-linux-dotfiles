import { createState, createEffect } from "ags"
import { readFile } from "ags/file"
import { Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { widgetsRefresh } from "../state"

function cpuUsage() {
  try {
    const parts = readFile("/proc/stat").split("\n")[0].trim().split(/\s+/).slice(1).map(Number)
    const idle = parts[3]
    const total = parts.reduce((a, b) => a + b, 0)
    return Math.round(100 - (idle / total) * 100)
  } catch { return 0 }
}

function ramUsage() {
  try {
    const lines = readFile("/proc/meminfo").split("\n")
    const get = (k: string) => parseInt(lines.find((l) => l.startsWith(k))?.split(/\s+/)[1] ?? "0")
    const total = get("MemTotal:")
    const free = get("MemFree:")
    const bufs = get("Buffers:")
    const cache = get("Cached:")
    return ((total - free - bufs - cache) / 1024 / 1024).toFixed(1)
  } catch { return 0 }
}

export default function CpuRam() {
  const [cpu, setCpu] = createState(0)
  const [ram, setRam] = createState<number | string>(0)
  const [topProcs, setTopProcs] = createState("Cargando...")

  let activePopover: Gtk.Popover | null = null
  let activeLbl: Gtk.Label | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  topProcs.subscribe((t: string) => {
    if (activeLbl) activeLbl.set_label(t)
  })

  const openPopover = (anchor: Gtk.Widget) => {
    if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null }
    if (activePopover) {
      activePopover.popdown()
      try { activePopover.unparent() } catch (_) {}
      activePopover = null
      activeLbl = null
      return
    }

    const lbl = new Gtk.Label({ label: topProcs.get() })
    lbl.add_css_class("cpuram-popup-label")
    activeLbl = lbl

    const pop = new Gtk.Popover()
    pop.set_has_arrow(true)
    pop.set_autohide(false)
    pop.set_position(Gtk.PositionType.TOP)
    pop.set_child(lbl)
    pop.set_parent(anchor)
    activePopover = pop

    pop.connect("closed", () => {
      activePopover = null
      activeLbl = null
      if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null }
      try { pop.unparent() } catch (_) {}
    })

    pop.popup()
    hideTimer = setTimeout(() => { pop.popdown(); hideTimer = null }, 3500)
  }

  const pollCpuRam = () => {
    setCpu(cpuUsage())
    setRam(ramUsage())
  }

  const pollTopProcs = async () => {
    try {
      const [cpuOut, ramOut] = await Promise.all([
        execAsync(["bash", "-c", "ps axch -o pcpu,comm --sort=-pcpu | head -n 1"]),
        execAsync(["bash", "-c", "ps axch -o rss,comm --sort=-rss | head -n 1"]),
      ])

      const parseCpu = (out: string) => {
        const parts = out.trim().split(/\s+/)
        return `${parts.slice(1).join(" ")} (${parts[0]}%)`
      }

      const parseRam = (out: string) => {
        const parts = out.trim().split(/\s+/)
        const gb = (parseInt(parts[0]) / 1024 / 1024).toFixed(1)
        return `${parts.slice(1).join(" ")} (${gb}G)`
      }

      setTopProcs(`CPU: ${parseCpu(cpuOut)}\nRAM: ${parseRam(ramOut)}`)
    } catch {
      setTopProcs("Error al obtener procesos")
    }
  }

  let cpuRamTimer: ReturnType<typeof setInterval> | null = null
  let topProcsTimer: ReturnType<typeof setInterval> | null = null
  let wasVisible = false

  createEffect(() => {
    const visible = widgetsRefresh()
    if (visible && !wasVisible) {
      pollCpuRam()
      pollTopProcs()
      cpuRamTimer = setInterval(pollCpuRam, 4000)
      topProcsTimer = setInterval(pollTopProcs, 5000)
    } else if (!visible && wasVisible) {
      if (cpuRamTimer !== null) { clearInterval(cpuRamTimer); cpuRamTimer = null }
      if (topProcsTimer !== null) { clearInterval(topProcsTimer); topProcsTimer = null }
    }
    wasVisible = visible
  })

  return (
    <box cssClasses={["cpuram"]} spacing={4}>
      <Gtk.GestureClick
        button={Gdk.BUTTON_PRIMARY}
        onPressed={(g: any) => openPopover((g as Gtk.GestureClick).get_widget())}
      />
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onPressed={() => execAsync("kitty --class floating_terminal -e btop").catch(console.error)}
      />
      <label cssClasses={["icon"]} label="󰻠" />
      <label cssClasses={["label"]} label={cpu((c) => `${c}%`)} />
      <label cssClasses={[" label"]} label="|" />
      <label cssClasses={["icon"]} label="󰍛" />
      <label cssClasses={["label"]} label={ram((r) => `${r}G`)} />
    </box>
  )
}
