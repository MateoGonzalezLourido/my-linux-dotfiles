import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import {
  loadRepoConfig, loadScanConfig, saveScanConfig, scanForRepos,
  addRepo, pinRepo, removeRepo, expandPath,
  getFileStatus, getBranches, getAheadBehind, getCommits,
  getFileDiff, getReleaseInfo, fetchRepo, pullRepo, pushRepo,
  commitChanges, checkoutBranch, detectActiveRepo,
  type RepoConfig, type RepoStatus, type FileChange, type ScanConfig, type DiscoveredRepo,
} from "../../services/GitService"

// ── Module-level state ────────────────────────────────────────────────────────

const [repos,           setRepos]           = createState<RepoConfig[]>([])
const [selectedId,      setSelectedId]      = createState<string | null>(null)
const [repoData,        setRepoData]        = createState<Record<string, RepoStatus>>({})
const [selectedFile,    setSelectedFile]    = createState<string | null>(null)
const [diffContent,     setDiffContent]     = createState<string>("")
const [ghAvailable,     setGhAvailable]     = createState(false)
const [actionMsg,       setActionMsg]       = createState<string | null>(null)
const [scanRunning,     setScanRunning]     = createState(false)
const [discoveredRepos, setDiscoveredRepos] = createState<DiscoveredRepo[]>([])
const [scanCfg,         setScanCfg]         = createState<ScanConfig | null>(null)
const [showDiff,        setShowDiff]        = createState(false)
const [gitView,         setGitView]         = createState<"repos" | "manage">("repos")

let _actionTimer: ReturnType<typeof setTimeout> | null = null
function showAction(msg: string) {
  setActionMsg(msg)
  if (_actionTimer) clearTimeout(_actionTimer)
  _actionTimer = setTimeout(() => setActionMsg(null), 4000)
}

// ── Init ──────────────────────────────────────────────────────────────────────

let _initialized = false

async function init() {
  if (_initialized) return
  _initialized = true

  const list = loadRepoConfig()
  setRepos(list)
  if (list.length > 0) setSelectedId(list[0].id)

  setScanCfg(loadScanConfig())

  const gh = await execAsync(["bash", "-c", "gh auth status"]).then(() => true).catch(() => false)
  setGhAvailable(gh)

  await refreshAll(list)
  for (const r of list) {
    if (r.path && r.remote) fetchRepo(r.path, r.remote).catch(() => {})
  }
  initScan().catch(console.error)
}

async function initScan() {
  const active = await detectActiveRepo()
  if (active) {
    const list = repos.get()
    const already = list.find(r => r.path && expandPath(r.path) === active)
    if (!already) {
      const name = active.split("/").pop() ?? "repo"
      setDiscoveredRepos([{ path: active, name, alreadySaved: false }])
    } else {
      setSelectedId(already.id)
    }
  }
  runScan().catch(console.error)
}

async function runScan() {
  setScanRunning(true)
  const savedPaths = repos.get().map(r => r.path ?? "").filter(Boolean)
  setDiscoveredRepos([])
  await scanForRepos(savedPaths, found => {
    setDiscoveredRepos([...discoveredRepos.get(), found])
  }).catch(console.error)
  setScanRunning(false)
}

async function refreshAll(list: RepoConfig[]) {
  for (const r of list) await refreshRepo(r)
}

async function refreshRepo(r: RepoConfig) {
  const cur = repoData.get()
  setRepoData({ ...cur, [r.id]: { ...(cur[r.id] ?? {}), id: r.id, name: r.name, path: r.path, loading: true, error: null } as RepoStatus })
  try {
    if (!r.path) {
      const { release } = await getReleaseInfo(r.github ?? null, null)
      setRepoData({ ...repoData.get(), [r.id]: { id: r.id, name: r.name, path: null, branch: "—", branches: [], ahead: 0, behind: 0, modified: [], staged: [], untracked: [], commits: [], release, localVersion: null, loading: false, error: null } })
      return
    }
    const [fileStatus, branchInfo, aheadBehind, commits, releaseInfo] = await Promise.all([
      getFileStatus(r.path), getBranches(r.path),
      getAheadBehind(r.path, r.remote ?? "origin"),
      getCommits(r.path, 5), getReleaseInfo(r.github ?? null, r.path),
    ])
    setRepoData({ ...repoData.get(), [r.id]: { id: r.id, name: r.name, path: r.path, branch: branchInfo.current, branches: branchInfo.all, ahead: aheadBehind.ahead, behind: aheadBehind.behind, modified: fileStatus.modified, staged: fileStatus.staged, untracked: fileStatus.untracked, commits, release: releaseInfo.release, localVersion: releaseInfo.local, loading: false, error: null } })
  } catch (e) {
    const cur2 = repoData.get()
    setRepoData({ ...cur2, [r.id]: { ...(cur2[r.id] ?? {}), id: r.id, name: r.name, path: r.path, loading: false, error: String(e) } as RepoStatus })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusCls(d: RepoStatus): string {
  if (d.error) return "pill-err"
  if (d.behind > 0) return "pill-warn"
  if (d.ahead > 0 || (d.modified?.length ?? 0) > 0 || (d.staged?.length ?? 0) > 0) return "pill-warn"
  return "pill-ok"
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW: REPOS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Repo chips ────────────────────────────────────────────────────────────────

function buildRepoChips(): Gtk.Box {
  const chipRow = new Gtk.Box({ spacing: 4, cssClasses: ["git-chip-row"], hexpand: true })

  function rebuild() {
    let child = chipRow.get_first_child()
    while (child) { const next = child.get_next_sibling(); chipRow.remove(child); child = next }

    const sel = selectedId.get()
    const list = repos.get()

    if (list.length === 0) {
      const hint = new Gtk.Label({ label: "sin repos — ve a Gestionar para añadir", cssClasses: ["git-empty-lbl"] })
      chipRow.append(hint)
      return
    }

    for (const r of list) {
      const d = repoData.get()[r.id]
      const btn = new Gtk.Button({ cssClasses: ["git-chip", sel === r.id ? "git-chip-active" : ""] })
      const inner = new Gtk.Box({ spacing: 5 })
      inner.append(new Gtk.Label({ label: r.name, cssClasses: ["git-chip-name"], maxWidthChars: 14, ellipsize: 3 }))
      if (d && !d.loading) inner.append(new Gtk.Box({ cssClasses: ["git-chip-dot", statusCls(d)] }))
      btn.set_child(inner)
      btn.connect("clicked", () => { setSelectedId(r.id); setSelectedFile(null); setDiffContent(""); setShowDiff(false) })
      chipRow.append(btn)
    }
  }

  repos.subscribe(rebuild)
  repoData.subscribe(rebuild)
  selectedId.subscribe(rebuild)
  rebuild()
  return chipRow
}

// ── Status bar ────────────────────────────────────────────────────────────────

function buildStatusBar(): Gtk.Box {
  const bar = new Gtk.Box({ cssClasses: ["git-status-bar"], spacing: 6 })

  const branchBox = new Gtk.Box({ cssClasses: ["git-branch-chip"], spacing: 4 })
  const branchLbl = new Gtk.Label({ label: "—", cssClasses: ["git-branch-lbl"] })
  branchBox.append(new Gtk.Image({ iconName: "vcs-branch-symbolic", cssClasses: ["git-branch-ico"] }))
  branchBox.append(branchLbl)
  bar.append(branchBox)

  const aheadLbl  = new Gtk.Label({ cssClasses: ["git-stat-pill", "gsp-ahead"],  visible: false })
  const behindLbl = new Gtk.Label({ cssClasses: ["git-stat-pill", "gsp-behind"], visible: false })
  const modLbl    = new Gtk.Label({ cssClasses: ["git-stat-pill", "gsp-mod"],    visible: false })
  const errLbl    = new Gtk.Label({ cssClasses: ["git-stat-pill", "gsp-err"],    visible: false })
  bar.append(aheadLbl)
  bar.append(behindLbl)
  bar.append(modLbl)
  bar.append(errLbl)
  bar.append(new Gtk.Box({ hexpand: true }))

  const refreshBtn = new Gtk.Button({ cssClasses: ["git-icon-btn"], tooltipText: "refrescar" })
  refreshBtn.set_child(new Gtk.Image({ iconName: "view-refresh-symbolic" }))
  refreshBtn.connect("clicked", async () => {
    const r = repos.get().find(x => x.id === selectedId.get())
    if (r) await refreshRepo(r)
  })
  bar.append(refreshBtn)

  function refresh() {
    const d = selectedId.get() ? repoData.get()[selectedId.get()!] : null
    branchLbl.label = d?.loading ? "…" : (d?.branch ?? "—")
    aheadLbl.label  = `↑${d?.ahead ?? 0}`;  aheadLbl.visible  = !!(d && d.ahead > 0)
    behindLbl.label = `↓${d?.behind ?? 0}`; behindLbl.visible = !!(d && d.behind > 0)
    const changes = (d?.modified?.length ?? 0) + (d?.staged?.length ?? 0) + (d?.untracked?.length ?? 0)
    modLbl.label = `${changes} cambios`;    modLbl.visible    = changes > 0
    errLbl.label = "error";                  errLbl.visible    = !!(d?.error)
  }

  selectedId.subscribe(refresh)
  repoData.subscribe(refresh)
  refresh()
  return bar
}

// ── Commits column ────────────────────────────────────────────────────────────

function buildCommitsCol(): Gtk.Box {
  const box = new Gtk.Box({ cssClasses: ["git-col-card"], orientation: Gtk.Orientation.VERTICAL })

  const hdr = new Gtk.Box({ cssClasses: ["git-col-hdr"], spacing: 6 })
  const aheadLbl  = new Gtk.Label({ cssClasses: ["git-ab", "git-ab-a"], visible: false })
  const behindLbl = new Gtk.Label({ cssClasses: ["git-ab", "git-ab-b"], visible: false })
  hdr.append(new Gtk.Label({ label: "commits", cssClasses: ["git-col-title"], halign: Gtk.Align.START, hexpand: true }))
  hdr.append(aheadLbl)
  hdr.append(behindLbl)
  box.append(hdr)

  const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  box.append(listBox)

  function refresh() {
    const d = selectedId.get() ? repoData.get()[selectedId.get()!] : null
    aheadLbl.label  = `↑${d?.ahead}`;  aheadLbl.visible  = !!(d && d.ahead > 0)
    behindLbl.label = `↓${d?.behind}`; behindLbl.visible = !!(d && d.behind > 0)

    let child = listBox.get_first_child()
    while (child) { const next = child.get_next_sibling(); listBox.remove(child); child = next }

    if (!d || d.loading) {
      listBox.append(new Gtk.Label({ label: d?.loading ? "cargando…" : "elige un repo", cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
      return
    }
    for (const c of (d.commits ?? []).slice(0, 5)) {
      const row = new Gtk.Box({ cssClasses: ["git-commit-row"], spacing: 6 })
      row.append(new Gtk.Label({ label: c.shortHash, cssClasses: ["git-commit-hash"] }))
      row.append(new Gtk.Label({ label: c.message, cssClasses: ["git-commit-msg"], hexpand: true, halign: Gtk.Align.START, maxWidthChars: 34, ellipsize: 3 }))
      row.append(new Gtk.Label({ label: c.date, cssClasses: ["git-commit-date"], halign: Gtk.Align.END }))
      listBox.append(row)
    }
    if (!d.commits?.length) listBox.append(new Gtk.Label({ label: "sin commits", cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
  }

  selectedId.subscribe(refresh)
  repoData.subscribe(refresh)
  refresh()
  return box
}

// ── Files + actions column ────────────────────────────────────────────────────

function buildFilesActionsCol(): Gtk.Box {
  const box = new Gtk.Box({ cssClasses: ["git-col-card"], orientation: Gtk.Orientation.VERTICAL })

  const hdr = new Gtk.Box({ cssClasses: ["git-col-hdr"], spacing: 4 })
  const countLbl = new Gtk.Label({ label: "0", cssClasses: ["git-files-count"] })
  const diffToggle = new Gtk.ToggleButton({ cssClasses: ["git-icon-btn-sm"], tooltipText: "ver diff", sensitive: false })
  diffToggle.set_child(new Gtk.Image({ iconName: "text-x-patch-symbolic" }))
  diffToggle.connect("toggled", () => setShowDiff(diffToggle.active))
  showDiff.subscribe(v => { if (diffToggle.active !== v) diffToggle.active = v })
  selectedFile.subscribe(f => { diffToggle.sensitive = !!f })
  hdr.append(new Gtk.Label({ label: "archivos", cssClasses: ["git-col-title"], halign: Gtk.Align.START, hexpand: true }))
  hdr.append(countLbl)
  hdr.append(diffToggle)
  box.append(hdr)

  const fileList = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  box.append(fileList)

  function refreshFiles() {
    const id = selectedId.get()
    const d = id ? repoData.get()[id] : null
    let child = fileList.get_first_child()
    while (child) { const next = child.get_next_sibling(); fileList.remove(child); child = next }

    if (!d || d.loading) { countLbl.label = "—"; return }

    const allFiles = [
      ...d.staged.map(f => ({ ...f, group: "staged" })),
      ...d.modified.map(f => ({ ...f, group: "modified" })),
      ...d.untracked.map(f => ({ status: "?" as FileChange["status"], path: f, group: "untracked" })),
    ]
    countLbl.label = `${allFiles.length}`

    const sel = selectedFile.get()
    for (const f of allFiles.slice(0, 6)) {
      const btn = new Gtk.Button()
      btn.set_css_classes(["git-file-row", ...(sel === f.path ? ["git-file-active"] : [])])
      const row = new Gtk.Box({ spacing: 5 })
      row.append(new Gtk.Label({ label: f.status, cssClasses: ["git-file-stat", f.status === "?" ? "fs-u" : `fs-${f.status.toLowerCase()}`] }))
      row.append(new Gtk.Label({ label: f.path.split("/").pop() ?? f.path, cssClasses: ["git-file-name"], halign: Gtk.Align.START, hexpand: true, maxWidthChars: 16, ellipsize: 3, tooltipText: f.path }))
      btn.set_child(row)
      const fp = f.path
      btn.connect("clicked", async () => {
        setSelectedFile(fp)
        const r = repos.get().find(x => x.id === id)
        if (r?.path) { const diff = await getFileDiff(r.path, fp); setDiffContent(diff); setShowDiff(true) }
      })
      fileList.append(btn)
    }
    if (!allFiles.length) fileList.append(new Gtk.Label({ label: "limpio", cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
  }

  selectedId.subscribe(refreshFiles)
  repoData.subscribe(refreshFiles)
  selectedFile.subscribe(refreshFiles)
  refreshFiles()

  box.append(new Gtk.Box({ cssClasses: ["git-mini-sep"] }))

  // Commit entry
  const commitEntry = new Gtk.Entry({ cssClasses: ["git-commit-entry"], placeholderText: "mensaje del commit…" })
  box.append(commitEntry)
  commitEntry.connect("activate", async () => {
    const id = selectedId.get()
    const r = repos.get().find(x => x.id === id)
    const msg = commitEntry.text.trim()
    if (!r?.path || !msg) return
    try { await commitChanges(r.path, msg, true); commitEntry.text = ""; showAction("commit: ok"); refreshRepo(r) }
    catch (e) { showAction(`commit error: ${String(e).slice(0, 60)}`) }
  })

  // Action buttons
  const actRow = new Gtk.Box({ cssClasses: ["git-act-row"], spacing: 4 })

  function iconBtn(icon: string, tip: string, cb: () => void): Gtk.Button {
    const btn = new Gtk.Button({ cssClasses: ["git-act-btn"], tooltipText: tip })
    btn.set_child(new Gtk.Image({ iconName: icon }))
    btn.connect("clicked", cb)
    return btn
  }

  actRow.append(iconBtn("go-down-symbolic", "pull", async () => {
    const r = repos.get().find(x => x.id === selectedId.get())
    if (!r?.path) return
    try { const out = await pullRepo(r.path); showAction(`pull: ${out.trim().split("\n").pop() ?? "ok"}`); refreshRepo(r) }
    catch (e) { showAction(`pull error: ${String(e).slice(0, 60)}`) }
  }))

  actRow.append(iconBtn("go-up-symbolic", "push", async () => {
    const r = repos.get().find(x => x.id === selectedId.get())
    if (!r?.path) return
    try { const out = await pushRepo(r.path, r.remote ?? "origin"); showAction(`push: ${out.trim().split("\n").pop() ?? "ok"}`); refreshRepo(r) }
    catch (e) { showAction(`push error: ${String(e).slice(0, 60)}`) }
  }))

  // Branches popover
  const branchPopover = new Gtk.Popover()
  const branchBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, cssClasses: ["git-branch-popover"] })

  function rebuildBranches() {
    let child = branchBox.get_first_child()
    while (child) { const next = child.get_next_sibling(); branchBox.remove(child); child = next }
    const id = selectedId.get(); const d = id ? repoData.get()[id] : null
    if (!d?.branches?.length) { branchBox.append(new Gtk.Label({ label: "sin branches", cssClasses: ["git-branch-item-lbl"] })); return }
    for (const b of d.branches) {
      const btn = new Gtk.Button({ cssClasses: ["git-branch-item-btn"] })
      btn.set_child(new Gtk.Label({ label: b, cssClasses: ["git-branch-item-lbl", b === d.branch ? "git-branch-active" : ""], halign: Gtk.Align.START }))
      btn.connect("clicked", async () => {
        branchPopover.popdown()
        const r = repos.get().find(x => x.id === id)
        if (!r?.path) return
        try { await checkoutBranch(r.path, b); refreshRepo(r) }
        catch (e) { showAction(`checkout error: ${String(e).slice(0, 60)}`) }
      })
      branchBox.append(btn)
    }
  }
  branchPopover.set_child(branchBox)
  selectedId.subscribe(rebuildBranches)
  repoData.subscribe(rebuildBranches)
  rebuildBranches()

  const branchBtn = new Gtk.MenuButton({ cssClasses: ["git-act-btn"], popover: branchPopover, tooltipText: "branches" })
  branchBtn.set_child(new Gtk.Image({ iconName: "vcs-branch-symbolic" }))
  actRow.append(branchBtn)

  const ghBtn = iconBtn("web-browser-symbolic", "ver en GitHub", () => {
    const r = repos.get().find(x => x.id === selectedId.get())
    if (r?.github) execAsync(["xdg-open", `https://github.com/${r.github}`]).catch(() => {})
  })
  ghAvailable.subscribe(v => { ghBtn.visible = v })
  actRow.append(ghBtn)

  box.append(actRow)
  return box
}

// ── Diff panel ────────────────────────────────────────────────────────────────

function buildDiffPanel(): Gtk.Box {
  const box = new Gtk.Box({ cssClasses: ["git-diff-panel"], orientation: Gtk.Orientation.VERTICAL, visible: false })

  const hdr = new Gtk.Box({ cssClasses: ["git-col-hdr"], spacing: 6 })
  const fileLabel = new Gtk.Label({ cssClasses: ["git-diff-file"], halign: Gtk.Align.START, hexpand: true })
  const addLabel  = new Gtk.Label({ cssClasses: ["git-ds-a"] })
  const remLabel  = new Gtk.Label({ cssClasses: ["git-ds-r"] })
  const closeBtn  = new Gtk.Button({ cssClasses: ["git-icon-btn-sm"] })
  closeBtn.set_child(new Gtk.Image({ iconName: "window-close-symbolic" }))
  closeBtn.connect("clicked", () => { setShowDiff(false); setSelectedFile(null) })
  hdr.append(fileLabel); hdr.append(addLabel); hdr.append(remLabel); hdr.append(closeBtn)
  box.append(hdr)

  const diffBody = new Gtk.Box({ cssClasses: ["git-diff-body"], orientation: Gtk.Orientation.VERTICAL })
  const scroll = new Gtk.ScrolledWindow()
  scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
  scroll.height_request = 130
  scroll.set_child(diffBody)
  box.append(scroll)

  function refresh() {
    const file = selectedFile.get()
    if (!file) return
    fileLabel.label = file.split("/").pop() ?? file
    const lines = diffContent.get().split("\n").filter(
      l => !l.startsWith("diff ") && !l.startsWith("index ") && !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("@@"),
    ).slice(0, 80)
    addLabel.label = `+${lines.filter(l => l.startsWith("+")).length}`
    remLabel.label = `-${lines.filter(l => l.startsWith("-")).length}`
    let child = diffBody.get_first_child()
    while (child) { const next = child.get_next_sibling(); diffBody.remove(child); child = next }
    for (const line of lines) {
      diffBody.append(new Gtk.Label({ label: line || " ", halign: Gtk.Align.START, selectable: true, xalign: 0, cssClasses: ["git-diff-line", line.startsWith("+") ? "dl-add" : line.startsWith("-") ? "dl-rem" : "dl-ctx"] }))
    }
  }
  selectedFile.subscribe(refresh)
  diffContent.subscribe(refresh)
  showDiff.subscribe(v => { box.visible = v })
  refresh()
  return box
}

// ── Action bar ────────────────────────────────────────────────────────────────

function buildActionBar(): Gtk.Label {
  const lbl = new Gtk.Label({ cssClasses: ["git-action-bar"], halign: Gtk.Align.START, visible: false })
  actionMsg.subscribe(msg => { lbl.label = msg ?? ""; lbl.visible = !!msg })
  return lbl
}

// ── Full repos view ───────────────────────────────────────────────────────────

function buildReposView(): Gtk.Box {
  const view = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })

  view.append(buildRepoChips())
  view.append(buildStatusBar())
  view.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))

  const cols = new Gtk.Box({ spacing: 8 })
  const left = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true })
  left.append(buildCommitsCol())
  const right = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  right.width_request = 190
  right.append(buildFilesActionsCol())
  cols.append(left)
  cols.append(right)
  view.append(cols)

  view.append(buildDiffPanel())
  view.append(buildActionBar())

  return view
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW: MANAGE
// ═══════════════════════════════════════════════════════════════════════════════

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

// ── Saved repos list ──────────────────────────────────────────────────────────

function buildSavedList(): Gtk.Box {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, cssClasses: ["git-manage-card"] })
  box.append(new Gtk.Label({ label: "repos guardados", cssClasses: ["git-manage-title"], halign: Gtk.Align.START }))

  const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 })
  box.append(listBox)

  function rebuild() {
    let child = listBox.get_first_child()
    while (child) { const next = child.get_next_sibling(); listBox.remove(child); child = next }

    const list = repos.get()
    if (list.length === 0) {
      listBox.append(new Gtk.Label({ label: "ninguno todavía", cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
      return
    }
    for (const r of list) {
      const row = new Gtk.Box({ cssClasses: ["git-saved-row"], spacing: 8 })
      row.append(new Gtk.Image({ iconName: "vcs-repository-symbolic", cssClasses: ["git-disc-icon"] }))

      const textCol = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 1, hexpand: true })
      textCol.append(new Gtk.Label({ label: r.name, cssClasses: ["git-saved-name"], halign: Gtk.Align.START }))
      if (r.path) textCol.append(new Gtk.Label({ label: r.path, cssClasses: ["git-saved-path"], halign: Gtk.Align.START, maxWidthChars: 36, ellipsize: 3 }))
      row.append(textCol)

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
    let child = listBox.get_first_child()
    while (child) { const next = child.get_next_sibling(); listBox.remove(child); child = next }

    const list = discoveredRepos.get().filter(r => !r.alreadySaved)
    const running = scanRunning.get()

    if (list.length === 0) {
      listBox.append(new Gtk.Label({ label: running ? "buscando…" : "no se encontraron repos nuevos", cssClasses: ["git-empty-lbl"], halign: Gtk.Align.START }))
      return
    }

    for (const r of list.slice(0, 8)) {
      const home = GLib.get_home_dir()
      const displayPath = r.path.startsWith(home) ? r.path.replace(home, "~") : r.path
      const row = new Gtk.Box({ cssClasses: ["git-disc-item"], spacing: 8 })
      row.append(new Gtk.Image({ iconName: "vcs-repository-symbolic", cssClasses: ["git-disc-icon"] }))
      const textCol = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 1, hexpand: true })
      textCol.append(new Gtk.Label({ label: r.name, cssClasses: ["git-disc-name"], halign: Gtk.Align.START }))
      textCol.append(new Gtk.Label({ label: displayPath, cssClasses: ["git-disc-path"], halign: Gtk.Align.START, maxWidthChars: 36, ellipsize: 3 }))
      row.append(textCol)

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

function buildManageView(): Gtk.Box {
  const scroll = new Gtk.ScrolledWindow()
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  scroll.vexpand = true
  scroll.height_request = 320

  const inner = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 })
  inner.append(buildAddForm())
  inner.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))
  inner.append(buildSavedList())
  inner.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))
  inner.append(buildDiscoveryPanel())

  scroll.set_child(inner)

  // Wrap in a box so we can return Gtk.Box
  const view = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  view.append(scroll as unknown as Gtk.Widget)
  return view
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB BAR + MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

function buildTabBar(): Gtk.Box {
  const bar = new Gtk.Box({ cssClasses: ["git-tab-bar"], spacing: 4 })

  const reposTab  = new Gtk.ToggleButton({ cssClasses: ["git-tab"], active: true })
  const manageTab = new Gtk.ToggleButton({ cssClasses: ["git-tab"] })

  const ri = new Gtk.Box({ spacing: 6 })
  ri.append(new Gtk.Image({ iconName: "vcs-repository-symbolic" }))
  ri.append(new Gtk.Label({ label: "repos" }))
  reposTab.set_child(ri)

  const mi = new Gtk.Box({ spacing: 6 })
  mi.append(new Gtk.Image({ iconName: "list-add-symbolic" }))
  mi.append(new Gtk.Label({ label: "gestionar" }))
  manageTab.set_child(mi)

  bar.append(reposTab)
  bar.append(manageTab)

  reposTab.connect("toggled", () => {
    if (reposTab.active) { setGitView("repos"); if (manageTab.active) manageTab.active = false }
    else if (!manageTab.active) reposTab.active = true
  })
  manageTab.connect("toggled", () => {
    if (manageTab.active) { setGitView("manage"); if (reposTab.active) reposTab.active = false }
    else if (!reposTab.active) manageTab.active = true
  })

  gitView.subscribe(v => {
    const wantRepos = v === "repos"
    if (reposTab.active  !== wantRepos)  reposTab.active  = wantRepos
    if (manageTab.active !== !wantRepos) manageTab.active = !wantRepos
  })

  return bar
}

export function GitSection(): Gtk.Box {
  init().catch(console.error)

  const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8, cssClasses: ["git-section"] })

  container.append(buildTabBar())
  container.append(new Gtk.Box({ cssClasses: ["j-hdiv"] }))

  const reposView  = buildReposView()
  const manageView = buildManageView()
  manageView.visible = false

  gitView.subscribe(v => {
    reposView.visible  = v === "repos"
    manageView.visible = v === "manage"
  })

  container.append(reposView)
  container.append(manageView)

  return container
}
