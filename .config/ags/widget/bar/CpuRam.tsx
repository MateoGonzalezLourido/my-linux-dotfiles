import { createState, createEffect, onCleanup } from "ags"
import { readFileAsync } from "ags/file"
import { Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { widgetsRefresh, openBarMenu, closeBarMenu, panelAutoClose } from "../state"

// Lee /proc/stat y devuelve los jiffies acumulados desde el arranque. El uso de
// CPU NO se puede calcular de una sola muestra (eso da el promedio desde el boot,
// prácticamente constante); hay que comparar el delta entre dos muestras.
async function readCpuSample(): Promise<{ total: number; idle: number } | null> {
  try {
    const parts = (await readFileAsync("/proc/stat")).split("\n")[0].trim().split(/\s+/).slice(1).map(Number)
    const idle = parts[3] + (parts[4] || 0) // idle + iowait = tiempo no ocupado
    const total = parts.reduce((a, b) => a + b, 0)
    return { total, idle }
  } catch { return null }
}

// GiB usados según MemAvailable (estimación del kernel de RAM realmente libre,
// más fiable que total-free-buffers-cached, que infravalora lo disponible).
async function ramUsedGb(): Promise<number | null> {
  try {
    const lines = (await readFileAsync("/proc/meminfo")).split("\n")
    const get = (k: string) => parseInt(lines.find((l) => l.startsWith(k))?.split(/\s+/)[1] ?? "0")
    const total = get("MemTotal:")
    const avail = get("MemAvailable:")
    return (total - avail) / 1024 / 1024
  } catch { return null }
}

export default function CpuRam() {
  const [cpu, setCpu] = createState(0)
  const [ram, setRam] = createState<number | string>(0)
  const [cpuTop, setCpuTop] = createState("Cargando…")
  const [ramTop, setRamTop] = createState("Cargando…")

  let activePopover: Gtk.Popover | null = null
  let activeCpuLbl: Gtk.Label | null = null
  let activeRamLbl: Gtk.Label | null = null

  // Auto-cierre por hover: se mantiene mientras el ratón esté sobre el popover o
  // sobre el botón que lo invoca; se cierra (con gracia) al salir de ambas zonas,
  // igual que un panel. Sustituye al antiguo timer fijo de 3.5s.
  const autoClose = panelAutoClose(() => { if (activePopover) activePopover.popdown() }, 250)

  cpuTop.subscribe((t: string) => { if (activeCpuLbl) activeCpuLbl.set_label(t) })
  ramTop.subscribe((t: string) => { if (activeRamLbl) activeRamLbl.set_label(t) })

  // Tarjeta del popover: cabecera + dos filas (CPU / RAM) con icono y proceso top.
  const buildPopupCard = () => {
    const card = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 })
    card.add_css_class("cpuram-popup")

    const cardMotion = new Gtk.EventControllerMotion()
    cardMotion.connect("enter", () => autoClose.onEnter())
    cardMotion.connect("leave", () => autoClose.onLeave())
    card.add_controller(cardMotion)

    const header = new Gtk.Label({ label: "Procesos top", xalign: 0 })
    header.add_css_class("cpuram-popup-header")
    card.append(header)

    const mkRow = (icon: string, kind: string, initial: string) => {
      const row = new Gtk.Box({ spacing: 8 })
      row.add_css_class("cpuram-popup-row")
      const ic = new Gtk.Label({ label: icon })
      ic.add_css_class("cpuram-popup-ic")
      ic.add_css_class(kind)
      const val = new Gtk.Label({ label: initial, xalign: 0 })
      val.add_css_class("cpuram-popup-val")
      row.append(ic)
      row.append(val)
      card.append(row)
      return val
    }

    activeCpuLbl = mkRow("󰻠", "cpu", cpuTop.get())
    activeRamLbl = mkRow("󰍛", "ram", ramTop.get())
    return card
  }

  const openPopover = (anchor: Gtk.Widget) => {
    if (activePopover) {
      activePopover.popdown()
      try { activePopover.unparent() } catch (_) {}
      activePopover = null
      activeCpuLbl = null
      activeRamLbl = null
      return
    }

    const pop = new Gtk.Popover()
    pop.add_css_class("cpuram-popover")
    pop.set_has_arrow(true)
    pop.set_autohide(false)
    pop.set_position(Gtk.PositionType.TOP)
    pop.set_child(buildPopupCard())
    pop.set_parent(anchor)
    activePopover = pop
    openBarMenu()

    pop.connect("closed", () => {
      activePopover = null
      activeCpuLbl = null
      activeRamLbl = null
      try { pop.unparent() } catch (_) {}
      closeBarMenu()
    })

    pop.popup()
  }

  // Muestra anterior de /proc/stat para el cálculo por delta. Persiste entre
  // ocultado/mostrado a propósito: la primera lectura tras reaparecer promedia el
  // intervalo oculto, dando de inmediato un valor útil en vez de un 0 transitorio.
  let prevCpu: { total: number; idle: number } | null = null

  const pollCpuRam = async () => {
    const [sample, ramGb] = await Promise.all([readCpuSample(), ramUsedGb()])
    if (sample) {
      if (prevCpu) {
        const dTotal = sample.total - prevCpu.total
        const dIdle = sample.idle - prevCpu.idle
        if (dTotal > 0) setCpu(Math.max(0, Math.min(100, Math.round(100 * (1 - dIdle / dTotal)))))
      }
      prevCpu = sample
    }
    if (ramGb !== null) setRam(ramGb.toFixed(1))
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

      setCpuTop(parseCpu(cpuOut))
      setRamTop(parseRam(ramOut))
    } catch {
      setCpuTop("—")
      setRamTop("—")
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

  // Al desactivar la función CPU/RAM, Bar.tsx desmonta este widget via <With>.
  // Los setInterval son JS puro y no se paran solos al destruir el widget, así que
  // los limpiamos aquí explícitamente (y cerramos el popover si estuviera abierto).
  onCleanup(() => {
    if (cpuRamTimer !== null) { clearInterval(cpuRamTimer); cpuRamTimer = null }
    if (topProcsTimer !== null) { clearInterval(topProcsTimer); topProcsTimer = null }
    // popdown() dispara el handler "closed", que ya hace unparent + closeBarMenu.
    if (activePopover) { try { activePopover.popdown() } catch (_) {} }
  })

  return (
    <box cssClasses={["bar-pill", "cpuram"]} spacing={3}>
      {/* Mantiene el popover abierto mientras el ratón esté sobre el botón */}
      <Gtk.EventControllerMotion onEnter={autoClose.onEnter} onLeave={autoClose.onLeave} />
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
      <label cssClasses={["icon", "icon-sep"]} label="󰍛" />
      <label cssClasses={["label"]} label={ram((r) => `${r}G`)} />
    </box>
  )
}
