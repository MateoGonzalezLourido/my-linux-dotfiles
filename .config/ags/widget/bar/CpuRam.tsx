import { createPoll } from "ags/time"
import { readFile } from "ags/file"
import { Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"

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
  const cpu = createPoll(0, 4000, cpuUsage)
  const ram = createPoll(0, 4000, ramUsage)

  const topProcs = createPoll("Cargando...", 5000, async () => {
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

      return `CPU: ${parseCpu(cpuOut)}\nRAM: ${parseRam(ramOut)}`
    } catch {
      return "Error al obtener procesos"
    }
  })

  return (
    <box
      cssClasses={["cpuram"]}
      spacing={4}
      tooltipText={topProcs((t) => t)}
    >
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

