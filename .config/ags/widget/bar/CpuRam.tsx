import { createPoll } from "ags/time"
import { readFile } from "ags/file"

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

  return (
    <box cssClasses={["cpuram"]} spacing={4}>
      <label cssClasses={["icon"]} label="󰻠" />
      <label cssClasses={["label"]} label={cpu((c) => `${c}%`)} />
      <label cssClasses={[" label"]} label="|" />
      <label cssClasses={["icon"]} label="󰍛" />
      <label cssClasses={["label"]} label={ram((r) => `${r}G`)} />
    </box>
  )
}

