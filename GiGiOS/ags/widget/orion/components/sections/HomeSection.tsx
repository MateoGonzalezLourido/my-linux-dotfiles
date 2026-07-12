import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { readFile } from "ags/file"
import { createState } from "ags"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import Gdk from "gi://Gdk"
import GObject from "gi://GObject"
import {
  setSection, showAppContext, orionVisible, activeSection,
  addTask, removeTask, hidePanel,
} from "../../state"
import { favorites, setFavorites, saveFavorites, type FavoriteApp } from "../../data/favorites"
import { checkExecExists } from "../../data/appResolver"

// Cache of appId/execName → Gio.Icon for rendering favorites
let _iconCache: Map<string, Gio.Icon | null> | null = null
function lookupGioIcon(appId: string, execName: string): Gio.Icon | null {
  if (!_iconCache) {
    _iconCache = new Map()
    for (const a of Gio.AppInfo.get_all() as Gio.AppInfo[]) {
      const id  = a.get_id()
      const ex  = a.get_executable()
      const ico = a.get_icon()
      if (id) _iconCache.set(id, ico)
      if (ex) _iconCache.set(ex, ico)
    }
  }
  return _iconCache.get(appId) ?? _iconCache.get(execName) ?? null
}

// ── Drag-to-reorder state ─────────────────────────────────────────────────────
// Kept module-level so buildAppFlowBtn (also module-level) can access appsFlow
let _appsFlow: Gtk.FlowBox | null = null
const _btnApp  = new Map<Gtk.Widget, FavoriteApp>()   // button → app (for sort & drop)
let _draggedId: string | null = null
let _workOrder: string[] = []    // current display order during drag
let _origOrder: string[] = []    // order before drag started (for cancel restore)

function _displayOrder(): string[] {
  return favorites.get().filter(a => checkExecExists(a.exec)).map(a => a.id)
}

function _commitOrder() {
  const favMap = new Map(favorites.get().map(f => [f.id, f]))
  const visible = _workOrder.map(id => favMap.get(id)).filter((f): f is FavoriteApp => !!f)
  const hidden  = favorites.get().filter(f => !checkExecExists(f.exec))
  const next = [...visible, ...hidden]
  setFavorites(next)
  saveFavorites(next)
}

// ── State ─────────────────────────────────────────────────────────────────────

const [cpuPct,     setCpuPct]     = createState(0)
const [ramUsed,    setRamUsed]    = createState("0.0")
const [ramPct,     setRamPct]     = createState(0)
// iGPU Intel
const [iGpu,       setIGpu]       = createState({ pct: 0, freq: 0, max: 1300 })
// NVIDIA dGPU (only shown when PRIME active)
const [nGpuActive, setNGpuActive] = createState(false)
const [nGpuPct,    setNGpuPct]    = createState(0)
const [nVramUsed,  setNVramUsed]  = createState("0M")
const [nVramPct,   setNVramPct]   = createState(0)

// ── CPU (delta) ───────────────────────────────────────────────────────────────

let prevIdle  = 0
let prevTotal = 0

function updateCpu() {
  try {
    const parts = readFile("/proc/stat").split("\n")[0].trim().split(/\s+/).slice(1).map(Number)
    const idle  = parts[3]
    const total = parts.reduce((a, b) => a + b, 0)
    if (prevTotal > 0) {
      const dIdle  = idle  - prevIdle
      const dTotal = total - prevTotal
      if (dTotal > 0) setCpuPct(Math.round(100 - (dIdle / dTotal) * 100))
    }
    prevIdle  = idle
    prevTotal = total
  } catch (_) {}
}

// ── RAM ───────────────────────────────────────────────────────────────────────

function updateRam() {
  try {
    const lines = readFile("/proc/meminfo").split("\n")
    const get = (k: string) => parseInt(lines.find(l => l.startsWith(k))?.split(/\s+/)[1] ?? "0")
    const total = get("MemTotal:")
    const free  = get("MemFree:")
    const bufs  = get("Buffers:")
    const cache = get("Cached:")
    const used  = total - free - bufs - cache
    setRamUsed((used / 1024 / 1024).toFixed(1))
    setRamPct(Math.round((used / total) * 100))
  } catch (_) {}
}

// ── iGPU Intel via RC6 residency delta ───────────────────────────────────────
// RC6 is a sleep state: the more time in RC6 → more idle
// delta_rc6_ms / 1000ms = fraction of time idle → GPU usage = 100 - that

const IGPU_CARD = "/sys/class/drm/card2"
let prevRc6 = -1

function updateIGpu() {
  try {
    const curFreq  = parseInt(readFile(`${IGPU_CARD}/gt_cur_freq_mhz`).trim())
    const maxFreq  = parseInt(readFile(`${IGPU_CARD}/gt_max_freq_mhz`).trim())
    const rc6Ms    = parseInt(readFile(`${IGPU_CARD}/gt/gt0/rc6_residency_ms`).trim())

    let pct = 0
    if (prevRc6 >= 0) {
      const deltaRc6 = rc6Ms - prevRc6
      pct = Math.max(0, Math.min(100, Math.round(100 - (deltaRc6 / 10))))
    }
    prevRc6 = rc6Ms

    setIGpu({ pct, freq: curFreq, max: maxFreq })
  } catch (_) {}
}

// ── NVIDIA dGPU (PRIME) ───────────────────────────────────────────────────────

async function updateNvidia() {
  try {
    const out = await execAsync([
      "bash", "-c",
      "/usr/bin/nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits",
    ])
    const [gpu, vramMb, vramTotal] = out.trim().split(", ").map(s => parseFloat(s.trim()))
    const active = gpu > 0 || vramMb > 100
    setNGpuActive(active)
    setNGpuPct(Math.round(gpu))
    setNVramUsed(vramMb >= 1024 ? `${(vramMb / 1024).toFixed(1)}G` : `${Math.round(vramMb)}M`)
    setNVramPct(Math.round((vramMb / vramTotal) * 100))
  } catch (_) {
    setNGpuActive(false)
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────
// Las stats (CPU/RAM/GPU) sólo se ven en la sección de inicio de Jarvis. Para no
// consumir en reposo (sobre todo el spawn de nvidia-smi cada segundo), el poll
// sólo corre mientras Orion está visible Y en "inicio"; se para al cerrar o al
// cambiar de sección. En reposo el consumo es cero.

let _pollSource: number | null = null

function tick() {
  updateCpu()
  updateRam()
  updateIGpu()
  updateNvidia()
}

function pollShouldRun(): boolean {
  return orionVisible.get() && activeSection.get() === "inicio"
}

function startPolling() {
  if (_pollSource !== null) return
  // Resetea los acumuladores delta para que el primer tick tras reabrir no
  // muestre un pico falso calculado sobre todo el tiempo que estuvo cerrado.
  prevTotal = 0
  prevIdle = 0
  prevRc6 = -1
  tick()  // refresco inmediato para no mostrar datos rancios al abrir
  _pollSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 1000, () => {
    tick()
    return GLib.SOURCE_CONTINUE
  })
}

function stopPolling() {
  if (_pollSource !== null) {
    GLib.source_remove(_pollSource)
    _pollSource = null
  }
}

function syncPolling() {
  if (pollShouldRun()) startPolling()
  else stopPolling()
}

orionVisible.subscribe(syncPolling)
activeSection.subscribe(syncPolling)

// Pie de métricas fijo: Orion lo monta fuera del viewport desplazable y sólo
// aparece en Inicio, donde también vive el polling que alimenta estos datos.
export function SystemStats() {
  return (
    <box
      cssClasses={["sys-strip", "sys-strip-fixed"]}
      spacing={5}
      visible={activeSection(section => section === "inicio")}
    >
      <box cssClasses={["sys-card"]} orientation={Gtk.Orientation.VERTICAL} hexpand>
        <label label="CPU" cssClasses={["sys-label"]} halign={Gtk.Align.START} />
        <label cssClasses={["sys-val"]} halign={Gtk.Align.START} label={cpuPct(v => `${v}%`)} />
        <box cssClasses={["sys-bar"]}>
          <box cssClasses={["sys-fill", "sf-blue"]} widthRequest={cpuPct(v => Math.round((v / 100) * 90))} />
        </box>
      </box>

      <box cssClasses={["sys-card"]} orientation={Gtk.Orientation.VERTICAL} hexpand>
        <label label="iGPU" cssClasses={["sys-label"]} halign={Gtk.Align.START} />
        <label cssClasses={["sys-val"]} halign={Gtk.Align.START} label={iGpu(v => `${v.pct}%·${v.freq}M`)} />
        <box cssClasses={["sys-bar"]}>
          <box cssClasses={["sys-fill", "sf-pink"]} widthRequest={iGpu(v => Math.round((v.pct / 100) * 90))} />
        </box>
      </box>

      <box cssClasses={["sys-card"]} orientation={Gtk.Orientation.VERTICAL} hexpand>
        <label label="RAM" cssClasses={["sys-label"]} halign={Gtk.Align.START} />
        <label cssClasses={["sys-val"]} halign={Gtk.Align.START} label={ramUsed(v => `${v}G`)} />
        <box cssClasses={["sys-bar"]}>
          <box cssClasses={["sys-fill", "sf-teal"]} widthRequest={ramPct(v => Math.round((v / 100) * 90))} />
        </box>
      </box>

      <box visible={nGpuActive(v => v)} cssClasses={["sys-card"]} orientation={Gtk.Orientation.VERTICAL} hexpand>
        <label label="GPU·NV" cssClasses={["sys-label"]} halign={Gtk.Align.START} />
        <label cssClasses={["sys-val"]} halign={Gtk.Align.START} label={nGpuPct(v => `${v}%`)} />
        <box cssClasses={["sys-bar"]}>
          <box cssClasses={["sys-fill", "sf-pink"]} widthRequest={nGpuPct(v => Math.round((v / 100) * 90))} />
        </box>
      </box>

      <box visible={nGpuActive(v => v)} cssClasses={["sys-card"]} orientation={Gtk.Orientation.VERTICAL} hexpand>
        <label label="VRAM·NV" cssClasses={["sys-label"]} halign={Gtk.Align.START} />
        <label cssClasses={["sys-val"]} halign={Gtk.Align.START} label={nVramUsed(v => `${v}`)} />
        <box cssClasses={["sys-bar"]}>
          <box cssClasses={["sys-fill", "sf-amber"]} widthRequest={nVramPct(v => Math.round((v / 100) * 90))} />
        </box>
      </box>
    </box>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

function buildAppFlowBtn(app: FavoriteApp): Gtk.Button {
  const btn = new Gtk.Button({ cssClasses: ["app-item"] })
  btn.tooltip_text = app.name
  let suppressClick = false

  const execName = app.exec.split(" ")[0].split("/").pop() ?? app.exec
  const gicon = lookupGioIcon(app.id, execName)

  const inner = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, halign: Gtk.Align.CENTER })
  if (gicon) {
    const img = Gtk.Image.new_from_gicon(gicon)
    img.pixel_size = 28
    img.set_css_classes(["app-item-img"])
    inner.append(img)
  } else {
    const img = new Gtk.Image({ iconName: app.iconName, cssClasses: ["app-item-img"] })
    img.pixel_size = 28
    inner.append(img)
  }
  inner.append(new Gtk.Label({ label: app.name, cssClasses: ["app-label"], maxWidthChars: 8, ellipsize: 3 }))
  btn.set_child(inner)

  btn.connect("clicked", () => {
    if (suppressClick) { suppressClick = false; return }
    if (_draggedId) return  // ignore clicks that are actually drag-starts
    try {
      showAppContext({
        id: app.id, name: app.name, iconName: app.iconName, gicon,
        execRaw: app.exec, execName, appId: app.id,
        launch: () => execAsync(["sh", "-c", app.exec]).catch(() => {}),
      })
    } catch (_) {}
  })

  const clickGesture = new Gtk.GestureClick()
  clickGesture.set_button(1)
  clickGesture.propagation_phase = Gtk.PropagationPhase.CAPTURE
  clickGesture.connect("pressed", (_gesture, presses) => {
    if (presses !== 2 || _draggedId) return
    suppressClick = true
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
      suppressClick = false
      return GLib.SOURCE_REMOVE
    })
    const taskId = addTask(`Abriendo ${app.name}`, app.iconName)
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
      removeTask(taskId)
      return GLib.SOURCE_REMOVE
    })
    execAsync(["sh", "-c", app.exec]).catch(() => {})
    hidePanel()
  })
  btn.add_controller(clickGesture)

  // ── Drag source ───────────────────────────────────────────────────────────
  const src = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE })
  src.connect("prepare", () => {
    _origOrder = _displayOrder()
    _workOrder = [..._origOrder]
    _draggedId = app.id
    return Gdk.ContentProvider.new_for_value(app.id)
  })
  src.connect("drag-begin", (self: any) => {
    btn.set_css_classes(["app-item", "app-dragging"])
    const pic = new Gtk.WidgetPaintable({ widget: btn })
    self.set_icon(pic, 20, 20)
  })
  src.connect("drag-end", () => {
    btn.set_css_classes(["app-item"])
    if (_draggedId) {
      // Drag cancelled — restore original order without saving
      _workOrder = [..._origOrder]
      _appsFlow?.invalidate_sort()
      _draggedId = null
    }
  })
  btn.add_controller(src)

  // ── Drop target (receives hover from other items' drag) ────────────────────
  const dst = new Gtk.DropTarget({ actions: Gdk.DragAction.MOVE })
  dst.set_gtypes([GObject.TYPE_STRING])
  dst.connect("motion", () => {
    if (_draggedId && _draggedId !== app.id) {
      const from = _workOrder.indexOf(_draggedId)
      const to   = _workOrder.indexOf(app.id)
      if (from !== -1 && to !== -1 && from !== to) {
        const next = [..._workOrder]
        next.splice(from, 1)
        next.splice(to, 0, _draggedId)
        _workOrder = next
        _appsFlow?.invalidate_sort()
      }
    }
    return Gdk.DragAction.MOVE
  })
  dst.connect("drop", () => {
    _draggedId = null   // cleared before drag-end fires → drag-end won't restore
    // Defer rebuild to next main-loop iteration so GTK4 can finish the DnD
    // protocol before we remove/recreate the FlowBox children.
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { _commitOrder(); return GLib.SOURCE_REMOVE })
    return true
  })
  btn.add_controller(dst)

  return btn
}

export function HomeSection() {
  // ── Apps FlowBox ──────────────────────────────────────────────────────────
  const appsFlow = new Gtk.FlowBox()
  _appsFlow = appsFlow
  appsFlow.set_css_classes(["apps-grid"])
  appsFlow.selection_mode = Gtk.SelectionMode.NONE
  appsFlow.column_spacing = 2
  appsFlow.row_spacing = 2
  appsFlow.max_children_per_line = 99

  // Sort by _workOrder; "todas" (not in _btnApp) is always index -1 → first
  appsFlow.set_sort_func((c1: any, c2: any) => {
    const b1 = c1.get_first_child() as Gtk.Widget | null
    const b2 = c2.get_first_child() as Gtk.Widget | null
    const a1 = b1 ? _btnApp.get(b1) : undefined
    const a2 = b2 ? _btnApp.get(b2) : undefined
    if (!a1 && !a2) return 0
    if (!a1) return -1   // "todas" before everything
    if (!a2) return 1
    const i1 = _workOrder.indexOf(a1.id)
    const i2 = _workOrder.indexOf(a2.id)
    return (i1 === -1 ? 999 : i1) - (i2 === -1 ? 999 : i2)
  })

  function rebuildApps() {
    _btnApp.clear()
    let ch: Gtk.FlowBoxChild | null
    while ((ch = appsFlow.get_child_at_index(0)) !== null) appsFlow.remove(ch)

    // "todas" always first (not registered in _btnApp → sort places it first)
    const todasBtn = new Gtk.Button({ cssClasses: ["app-item"] })
    const todasInner = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, halign: Gtk.Align.CENTER })
    const todasImg = new Gtk.Image({ iconName: "view-app-grid-symbolic", cssClasses: ["app-item-img"] })
    todasImg.pixel_size = 28
    todasInner.append(todasImg)
    todasBtn.set_child(todasInner)
    todasBtn.connect("clicked", () => setSection("apps"))
    appsFlow.append(todasBtn)

    // Only show apps whose exec resolves; register in _btnApp for sort/drag
    for (const app of favorites.get()) {
      if (!checkExecExists(app.exec)) continue
      const btn = buildAppFlowBtn(app)
      _btnApp.set(btn, app)
      appsFlow.append(btn)
    }

    _workOrder = _displayOrder()
    appsFlow.invalidate_sort()
  }

  favorites.subscribe(() => rebuildApps())
  rebuildApps()

  return (
    <box cssClasses={["section-home"]} orientation={Gtk.Orientation.VERTICAL}>

      <label label="Aplicaciones" cssClasses={["section-title"]} halign={Gtk.Align.START} />
      {appsFlow as unknown as any}

    </box>
  )
}
