// Pestaña "repos": chips de repo, estado, commits, archivos+acciones y diff.
// Ver `./estado.ts` para el estado compartido y `./vistaGestionar.tsx` para
// la otra pestaña de la sección Git.

import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import {
  getFileDiff, commitChanges, pullRepo, pushRepo, checkoutBranch,
  type FileChange,
} from "../../../services/GitService"
import { vaciarCaja } from "../../shared/gtkUtils"
import {
  repos, selectedId, setSelectedId, repoData, selectedFile, setSelectedFile,
  diffContent, setDiffContent, ghAvailable, actionMsg, showDiff, setShowDiff,
  showAction, refreshRepo, statusCls,
} from "./estado"

// ── Repo chips ────────────────────────────────────────────────────────────────

function buildRepoChips(): Gtk.Box {
  const chipRow = new Gtk.Box({ spacing: 4, cssClasses: ["git-chip-row"], hexpand: true })

  function rebuild() {
    vaciarCaja(chipRow)

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

    vaciarCaja(listBox)

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
    vaciarCaja(fileList)

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
    vaciarCaja(branchBox)
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
  box.append(diffBody)

  function refresh() {
    const file = selectedFile.get()
    if (!file) return
    fileLabel.label = file.split("/").pop() ?? file
    const lines = diffContent.get().split("\n").filter(
      l => !l.startsWith("diff ") && !l.startsWith("index ") && !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("@@"),
    ).slice(0, 80)
    addLabel.label = `+${lines.filter(l => l.startsWith("+")).length}`
    remLabel.label = `-${lines.filter(l => l.startsWith("-")).length}`
    vaciarCaja(diffBody)
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

export function buildReposView(): Gtk.Box {
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
