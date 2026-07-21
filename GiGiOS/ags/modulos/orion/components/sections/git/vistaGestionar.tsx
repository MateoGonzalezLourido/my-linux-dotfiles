// Pestaña "gestionar": añadir repo a mano, lista de guardados y
// descubrimiento automático. Ver `./estado.ts` para el estado compartido y
// `./vistaRepos.tsx` para la otra pestaña de la sección Git.

import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import {
  loadRepoConfig, loadScanConfig, saveScanConfig,
  addRepo, pinRepo, removeRepo, expandPath,
} from "../../../services/GitService"
import { vaciarCaja } from "../../shared/gtkUtils"
import {
  repos, setRepos, selectedId, setSelectedId,
  discoveredRepos, setDiscoveredRepos, scanRunning, setScanCfg,
  runScan, refreshRepo, showAction, setGitView,
} from "./estado"

// ── Add form ──────────────────────────────────────────────────────────────────

function buildAddForm(): Gtk.Box {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, cssClasses: ["git-manage-card"] })
  box.append(new Gtk.Label({ label: "añadir repo", cssClasses: ["git-manage-title"], halign: Gtk.Align.START }))

  const pathEntry   = new Gtk.Entry({ cssClasses: ["git-manage-entry"], placeholderText: "ruta  ~/proyectos/mi-repo" })
  const nameEntry   = new Gtk.Entry({ cssClasses: ["git-manage-entry"], placeholderText: "nombre (auto si vacío)" })
  const remoteEntry = new Gtk.Entry({ cssClasses: ["git-manage-entry"], placeholderText: "remote  origin" })
  box.append(pathEntry)
  box.append(nameEntry)
  box.append(remoteEntry)

  const errLbl = new Gtk.Label({ cssClasses: ["git-manage-err"], halign: Gtk.Align.START, visible: false })
  box.append(errLbl)

  const btnRow     = new Gtk.Box({ spacing: 6 })
  const confirmBtn = new Gtk.Button({ label: "añadir", cssClasses: ["git-manage-confirm"] })
  btnRow.append(new Gtk.Box({ hexpand: true }))
  btnRow.append(confirmBtn)
  box.append(btnRow)

  async function doAdd() {
    errLbl.visible = false
    const rawPath = pathEntry.text.trim()
    if (!rawPath) { errLbl.label = "introduce una ruta"; errLbl.visible = true; return }
    const path = expandPath(rawPath)
    try { await execAsync(["git", "-C", path, "rev-parse", "--show-toplevel"]) }
    catch { errLbl.label = "no es un repo git válido"; errLbl.visible = true; return }
    const name   = nameEntry.text.trim()   || rawPath.split("/").pop() || "repo"
    const remote = remoteEntry.text.trim() || "origin"
    const ok = addRepo(path, name, { remote })
    if (!ok) { errLbl.label = "ya está en la lista"; errLbl.visible = true; return }
    const list = loadRepoConfig()
    setRepos(list)
    const newest = list[list.length - 1]
    if (newest) { setSelectedId(newest.id); refreshRepo(newest).catch(console.error) }
    pathEntry.text = nameEntry.text = remoteEntry.text = ""
    showAction(`repo "${name}" añadido`)
  }

  confirmBtn.connect("clicked", () => doAdd().catch(console.error))
  pathEntry.connect("activate",  () => doAdd().catch(console.error))

  return box
}

// Fila "icono + nombre + path" compartida por la lista de guardados y el panel
// de descubrimiento (misma forma, distinto prefijo de clase); cada caller
// sigue añadiendo sus propios botones de acción al Gtk.Box devuelto.
function buildRepoIconRow(rowClass: string, name: string, path: string | undefined, nameClass: string, pathClass: string): Gtk.Box {
  const row = new Gtk.Box({ cssClasses: [rowClass], spacing: 8 })
  row.append(new Gtk.Image({ iconName: "vcs-repository-symbolic", cssClasses: ["git-disc-icon"] }))

  const textCol = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 1, hexpand: true })
  textCol.append(new Gtk.Label({ label: name, cssClasses: [nameClass], halign: Gtk.Align.START }))
  if (path) textCol.append(new Gtk.Label({ label: path, cssClasses: [pathClass], halign: Gtk.Align.START, maxWidthChars: 36, ellipsize: 3 }))
  row.append(textCol)

  return row
}

// ── Saved repos list ──────────────────────────────────────────────────────────

function buildSavedList(): Gtk.Box {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, cssClasses: ["git-manage-card"] })
  box.append(new Gtk.Label({ label: "repos guardados", cssClasses: ["git-manage-title"], halign: Gtk.Align.START }))

  const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 })
  box.append(listBox)

  function rebuild() {
    vaciarCaja(listBox)

    const list = repos.get()
    if (list.length === 0) {
      listBox.append(new Gtk.Label({ label: "ninguno todavía", cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
      return
    }
    for (const r of list) {
      const row = buildRepoIconRow("git-saved-row", r.name, r.path, "git-saved-name", "git-saved-path")

      // "Ver" → jump to repos view with this repo selected
      const viewBtn = new Gtk.Button({ cssClasses: ["git-saved-view"], tooltipText: "ver en repos" })
      viewBtn.set_child(new Gtk.Image({ iconName: "go-next-symbolic" }))
      viewBtn.connect("clicked", () => { setSelectedId(r.id); setGitView("repos") })
      row.append(viewBtn)

      // Remove
      const rmBtn = new Gtk.Button({ cssClasses: ["git-saved-rm"], tooltipText: "eliminar" })
      rmBtn.set_child(new Gtk.Image({ iconName: "user-trash-symbolic" }))
      rmBtn.connect("clicked", () => {
        removeRepo(r.id)
        const updated = loadRepoConfig()
        setRepos(updated)
        if (selectedId.get() === r.id) setSelectedId(updated[0]?.id ?? null)
      })
      row.append(rmBtn)

      listBox.append(row)
    }
  }

  repos.subscribe(rebuild)
  rebuild()
  return box
}

// ── Discovery panel ───────────────────────────────────────────────────────────

function buildDiscoveryPanel(): Gtk.Box {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, cssClasses: ["git-manage-card"] })

  const hdr = new Gtk.Box({ spacing: 6 })
  hdr.append(new Gtk.Label({ label: "descubrimiento", cssClasses: ["git-manage-title"], halign: Gtk.Align.START, hexpand: true }))
  const scanBtn = new Gtk.Button({ cssClasses: ["git-icon-btn"], tooltipText: "re-escanear" })
  scanBtn.set_child(new Gtk.Image({ iconName: "view-refresh-symbolic" }))
  scanRunning.subscribe(r => { scanBtn.sensitive = !r })
  scanBtn.connect("clicked", () => runScan().catch(console.error))
  hdr.append(scanBtn)
  box.append(hdr)

  const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3 })
  box.append(listBox)

  function rebuild() {
    vaciarCaja(listBox)

    const list = discoveredRepos.get().filter(r => !r.alreadySaved)
    const running = scanRunning.get()

    if (list.length === 0) {
      listBox.append(new Gtk.Label({ label: running ? "buscando…" : "no se encontraron repos nuevos", cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
      return
    }

    for (const r of list.slice(0, 8)) {
      const home = GLib.get_home_dir()
      const displayPath = r.path.startsWith(home) ? r.path.replace(home, "~") : r.path
      const row = buildRepoIconRow("git-disc-item", r.name, displayPath, "git-disc-name", "git-disc-path")

      const pinBtn = new Gtk.Button({ cssClasses: ["git-disc-btn", "git-disc-pin"], tooltipText: "guardar" })
      pinBtn.set_child(new Gtk.Image({ iconName: "pin-symbolic" }))
      pinBtn.connect("clicked", () => {
        pinRepo(r.path, r.name)
        const updated = loadRepoConfig()
        setRepos(updated)
        setDiscoveredRepos(discoveredRepos.get().map(x => x.path === r.path ? { ...x, alreadySaved: true } : x))
        const saved = updated.find(x => x.path && expandPath(x.path) === r.path)
        if (saved) refreshRepo(saved).catch(console.error)
      })

      const ignBtn = new Gtk.Button({ cssClasses: ["git-disc-btn", "git-disc-ignore"], tooltipText: "ignorar" })
      ignBtn.set_child(new Gtk.Image({ iconName: "window-close-symbolic" }))
      ignBtn.connect("clicked", () => {
        const cfg = loadScanConfig()
        cfg.excludePaths.push(r.path)
        saveScanConfig(cfg)
        setScanCfg({ ...cfg })
        setDiscoveredRepos(discoveredRepos.get().filter(x => x.path !== r.path))
      })

      row.append(pinBtn)
      row.append(ignBtn)
      listBox.append(row)
    }
    if (list.length > 8) listBox.append(new Gtk.Label({ label: `…y ${list.length - 8} más`, cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
  }

  discoveredRepos.subscribe(rebuild)
  scanRunning.subscribe(rebuild)
  rebuild()
  return box
}

// ── Full manage view ──────────────────────────────────────────────────────────

export function buildManageView(): Gtk.Box {
  const inner = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 })
  inner.append(buildAddForm())
  inner.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))
  inner.append(buildSavedList())
  inner.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))
  inner.append(buildDiscoveryPanel())

  return inner
}
