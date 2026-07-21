// Estado reactivo y lógica de refresco de la sección Git, compartidos por
// `vistaRepos.tsx` (pestaña "repos") y `vistaGestionar.tsx` (pestaña
// "gestionar"). Separado de ambas para que ninguna dependa de la otra.

import { createState } from "ags"
import { execAsync } from "ags/process"
import {
  loadRepoConfig, loadScanConfig, scanForRepos,
  getFileStatus, getBranches, getAheadBehind, getCommits, getReleaseInfo,
  fetchRepo, detectActiveRepo, expandPath,
  type RepoConfig, type RepoStatus, type ScanConfig, type DiscoveredRepo,
} from "../../../services/GitService"

export const [repos,           setRepos]           = createState<RepoConfig[]>([])
export const [selectedId,      setSelectedId]      = createState<string | null>(null)
export const [repoData,        setRepoData]        = createState<Record<string, RepoStatus>>({})
export const [selectedFile,    setSelectedFile]    = createState<string | null>(null)
export const [diffContent,     setDiffContent]     = createState<string>("")
export const [ghAvailable,     setGhAvailable]     = createState(false)
export const [actionMsg,       setActionMsg]       = createState<string | null>(null)
export const [scanRunning,     setScanRunning]     = createState(false)
export const [discoveredRepos, setDiscoveredRepos] = createState<DiscoveredRepo[]>([])
export const [scanCfg,         setScanCfg]         = createState<ScanConfig | null>(null)
export const [showDiff,        setShowDiff]        = createState(false)
export const [gitView,         setGitView]         = createState<"repos" | "manage">("repos")

let _actionTimer: ReturnType<typeof setTimeout> | null = null
export function showAction(msg: string) {
  setActionMsg(msg)
  if (_actionTimer) clearTimeout(_actionTimer)
  _actionTimer = setTimeout(() => setActionMsg(null), 4000)
}

// ── Init ──────────────────────────────────────────────────────────────────────

let _initialized = false

export async function init() {
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

export async function runScan() {
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

export async function refreshRepo(r: RepoConfig) {
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

export function statusCls(d: RepoStatus): string {
  if (d.error) return "pill-err"
  if (d.behind > 0) return "pill-warn"
  if (d.ahead > 0 || (d.modified?.length ?? 0) > 0 || (d.staged?.length ?? 0) > 0) return "pill-warn"
  return "pill-ok"
}
