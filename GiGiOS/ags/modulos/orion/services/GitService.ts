import { execAsync } from "ags/process"
import { readFile } from "ags/file"
import GLib from "gi://GLib"
import Gio from "gi://Gio"

export interface RepoConfig {
  id: string
  name: string
  path: string | null
  remote: string | null
  github: string | null
}

export interface RepoStatus {
  id: string
  name: string
  path: string | null
  branch: string
  branches: string[]
  ahead: number
  behind: number
  modified: FileChange[]
  staged: FileChange[]
  untracked: string[]
  commits: Commit[]
  release: ReleaseInfo | null
  localVersion: LocalVersion | null
  loading: boolean
  error: string | null
}

export interface FileChange {
  status: "M" | "A" | "D" | "R" | "?"
  path: string
}

export interface Commit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
  timestamp: number
}

export interface ReleaseInfo {
  tag: string
  name: string
  date: string
  body: string
  hasReleases: boolean
}

export interface LocalVersion {
  tag: string | null
  hash: string
  commitsBehindLatest: number
}

export function expandPath(p: string): string {
  return p.replace(/^~/, GLib.get_home_dir())
}

export function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60)     return "ahora"
  if (diff < 3600)   return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400)  return `hace ${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)}d`
  return new Date(ts).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
}

export async function getFileStatus(repoPath: string): Promise<{
  modified: FileChange[]
  staged: FileChange[]
  untracked: string[]
}> {
  const path = expandPath(repoPath)
  const out = await execAsync(["git", "-C", path, "status", "--porcelain"])
  const modified: FileChange[] = []
  const staged: FileChange[] = []
  const untracked: string[] = []

  for (const line of out.split("\n").filter(Boolean)) {
    const indexStatus = line[0]
    const wtStatus = line[1]
    const file = line.slice(3)

    if (wtStatus === "?" && indexStatus === "?") {
      untracked.push(file)
    } else {
      if (indexStatus !== " " && indexStatus !== "?")
        staged.push({ status: indexStatus as FileChange["status"], path: file })
      if (wtStatus !== " " && wtStatus !== "?")
        modified.push({ status: wtStatus as FileChange["status"], path: file })
    }
  }

  return { modified, staged, untracked }
}

export async function getBranches(repoPath: string): Promise<{ current: string; all: string[] }> {
  const path = expandPath(repoPath)
  const out = await execAsync(["git", "-C", path, "branch"])
  const lines = out.split("\n").filter(Boolean)
  const current = lines.find(l => l.startsWith("*"))?.slice(2).trim() ?? "HEAD"
  const all = lines.map(l => l.replace(/^\*\s*/, "").trim())
  return { current, all }
}

export async function getAheadBehind(repoPath: string, remote: string = "origin"): Promise<{
  ahead: number
  behind: number
}> {
  const path = expandPath(repoPath)
  try {
    const branch = (await getBranches(path)).current
    const out = await execAsync([
      "git", "-C", path, "rev-list", "--left-right", "--count",
      `${remote}/${branch}...HEAD`,
    ])
    const [behind, ahead] = out.trim().split("\t").map(Number)
    return { ahead: ahead || 0, behind: behind || 0 }
  } catch {
    return { ahead: 0, behind: 0 }
  }
}

export async function getCommits(repoPath: string, n: number = 10): Promise<Commit[]> {
  const path = expandPath(repoPath)
  const fmt = "%H|%h|%s|%an|%ar|%at"
  const out = await execAsync(["git", "-C", path, "log", `-${n}`, `--format=${fmt}`])
  return out.split("\n").filter(Boolean).map(line => {
    const [hash, shortHash, message, author, date, ts] = line.split("|")
    return { hash, shortHash, message, author, date, timestamp: parseInt(ts) * 1000 }
  })
}

export async function getFileDiff(repoPath: string, filePath: string): Promise<string> {
  const path = expandPath(repoPath)
  return await execAsync(["git", "-C", path, "diff", "HEAD", "--", filePath]).catch(() => "")
}

export async function getReleaseInfo(
  githubRepo: string | null,
  repoPath: string | null,
): Promise<{ release: ReleaseInfo | null; local: LocalVersion | null }> {
  let release: ReleaseInfo | null = null
  let local: LocalVersion | null = null

  if (repoPath) {
    const path = expandPath(repoPath)
    try {
      const hash = (await execAsync(["git", "-C", path, "rev-parse", "--short", "HEAD"])).trim()
      const tagRaw = await execAsync(["git", "-C", path, "describe", "--tags", "--abbrev=0"]).catch(() => "")
      const tag = tagRaw.trim() || null
      let commitsBehindLatest = 0
      if (tag) {
        const countRaw = await execAsync(
          ["git", "-C", path, "rev-list", `${tag}..HEAD`, "--count"],
        ).catch(() => "0")
        commitsBehindLatest = parseInt(countRaw.trim()) || 0
      }
      local = { tag, hash, commitsBehindLatest }
    } catch { /* repo sin historial */ }
  }

  if (githubRepo) {
    try {
      const raw = await execAsync([
        "bash", "-c",
        `gh release view --repo ${githubRepo} --json tagName,name,publishedAt,body`,
      ])
      const data = JSON.parse(raw)
      const body = (data.body ?? "").split("\n").find((l: string) => l.trim().length > 20) ?? ""
      release = {
        tag: data.tagName,
        name: data.name,
        date: relativeTime(new Date(data.publishedAt).getTime()),
        body: body.slice(0, 140),
        hasReleases: true,
      }
    } catch {
      release = { tag: "", name: "", date: "", body: "", hasReleases: false }
    }
  }

  return { release, local }
}

export async function fetchRepo(repoPath: string, remote: string = "origin"): Promise<void> {
  const path = expandPath(repoPath)
  await execAsync(["git", "-C", path, "fetch", remote, "--quiet"]).catch(() => {})
}

export async function pullRepo(repoPath: string): Promise<string> {
  return await execAsync(["git", "-C", expandPath(repoPath), "pull"])
}

export async function pushRepo(repoPath: string, remote: string = "origin"): Promise<string> {
  return await execAsync(["git", "-C", expandPath(repoPath), "push", remote])
}

export async function commitChanges(
  repoPath: string,
  message: string,
  stageAll: boolean = false,
): Promise<string> {
  const path = expandPath(repoPath)
  if (stageAll) await execAsync(["git", "-C", path, "add", "-A"])
  return await execAsync(["git", "-C", path, "commit", "-m", message])
}

export async function checkoutBranch(repoPath: string, branch: string): Promise<string> {
  return await execAsync(["git", "-C", expandPath(repoPath), "checkout", branch])
}

export function loadRepoConfig(): RepoConfig[] {
  const path = `${GLib.get_home_dir()}/.config/jarvis/git-repos.json`
  try {
    return JSON.parse(readFile(path)).repos ?? []
  } catch {
    return []
  }
}

export function saveRepoConfig(repos: RepoConfig[]): void {
  const dir = `${GLib.get_home_dir()}/.config/jarvis`
  const path = `${dir}/git-repos.json`
  GLib.mkdir_with_parents(dir, 0o755)
  const content = JSON.stringify({ repos }, null, 2)
  const file = Gio.File.new_for_path(path)
  file.replace_contents(
    new TextEncoder().encode(content),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  )
}

export async function detectActiveRepo(): Promise<string | null> {
  try {
    const raw = await execAsync(["hyprctl", "activewindow", "-j"])
    const pid = JSON.parse(raw).pid
    const cwd = (await execAsync(["readlink", "-f", `/proc/${pid}/cwd`])).trim()
    const root = (await execAsync(["git", "-C", cwd, "rev-parse", "--show-toplevel"])).trim()
    return root
  } catch {
    return null
  }
}

// ── Scan / auto-discovery ─────────────────────────────────────────────────────

export interface ScanConfig {
  maxDepth: number
  includePaths: string[]
  excludePaths: string[]
  lastScanAt: number | null
}

export interface DiscoveredRepo {
  path: string
  name: string
  alreadySaved: boolean
}

function defaultScanConfig(): ScanConfig {
  return {
    maxDepth: 5,
    includePaths: [],
    excludePaths: [
      ".*",
      "~/.cache", "~/.local/share", "~/.var",
      "~/snap", "node_modules", ".cargo", ".rustup",
      ".npm", ".gem", ".gradle", "venv", "__pycache__",
    ],
    lastScanAt: null,
  }
}

export function loadScanConfig(): ScanConfig {
  const path = `${GLib.get_home_dir()}/.config/jarvis/git-repos.json`
  try {
    return JSON.parse(readFile(path)).scan ?? defaultScanConfig()
  } catch {
    return defaultScanConfig()
  }
}

export function saveConfig(data: any): void {
  const dir = `${GLib.get_home_dir()}/.config/jarvis`
  const path = `${dir}/git-repos.json`
  GLib.mkdir_with_parents(dir, 0o755)
  const file = Gio.File.new_for_path(path)
  file.replace_contents(
    new TextEncoder().encode(JSON.stringify(data, null, 2)),
    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
  )
}

// Keeps private alias so existing internal callers compile unchanged
const saveFullConfig = saveConfig

export function ensureConfigFile(): void {
  const dir = `${GLib.get_home_dir()}/.config/jarvis`
  const path = `${dir}/git-repos.json`
  GLib.mkdir_with_parents(dir, 0o755)
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
    saveConfig({ repos: [], scan: defaultScanConfig() })
  }
}

export function saveScanConfig(scan: ScanConfig): void {
  ensureConfigFile()
  const path = `${GLib.get_home_dir()}/.config/jarvis/git-repos.json`
  try {
    const raw = readFile(path)
    const data = raw ? JSON.parse(raw) : { repos: [] }
    data.scan = { ...scan, lastScanAt: Date.now() }
    saveFullConfig(data)
  } catch { /* ignore */ }
}

export async function scanForRepos(
  savedPaths: string[],
  onProgress?: (found: DiscoveredRepo) => void,
): Promise<DiscoveredRepo[]> {
  const config = loadScanConfig()
  const home = GLib.get_home_dir()
  const expand = (p: string) => p.replace(/^~/, home)

  const results: DiscoveredRepo[] = []
  const seen = new Set<string>()

  const hasFd = await execAsync(["bash", "-c", "which fd"]).then(() => true).catch(() => false)

  // Names to prune at any depth (no path separator)
  const pruneNames = config.excludePaths.filter(p => !p.includes("/"))
  // Absolute paths to skip entirely
  const pruneAbs   = config.excludePaths.filter(p => p.includes("/")).map(expand)

  // fd's --exclude '.*' also excludes .git itself, breaking the search.
  // Keep .* out of fd args; the explicit hidden-dir names (.cargo etc.) cover fd.
  const fdPruneNames = pruneNames.filter(n => n !== ".*")
  // find can handle .* safely with ! -name '.git'
  const hasDotStar = pruneNames.includes(".*")

  const scanPath = async (rootPath: string, depth: number) => {
    const expanded = expand(rootPath)
    let output = ""

    if (hasFd) {
      const excl = fdPruneNames.map(n => `--exclude '${n}'`).join(" ")
      output = await execAsync(["bash", "-c",
        `fd -H -t d -d ${depth} '^\\.git$' '${expanded}' ${excl} --exec echo {//} 2>/dev/null || true`,
      ]).catch(() => "")
    }

    if (!output.trim()) {
      const findExprs = pruneNames
        .filter(n => n !== ".*")
        .map(n => `-name '${n}'`)
      if (hasDotStar) findExprs.push(`\\( -name '.*' ! -name '.git' \\)`)
      const pruneExpr = findExprs.length > 0
        ? `\\( ${findExprs.join(" -o ")} \\) -prune -o`
        : ""
      output = await execAsync(["bash", "-c",
        `find '${expanded}' -maxdepth ${depth} ${pruneExpr} -name '.git' -type d -print0 2>/dev/null | xargs -0 -r dirname 2>/dev/null || true`,
      ]).catch(() => "")
    }

    for (const line of output.split("\n").filter(Boolean)) {
      const repoPath = line.trim()
      if (!repoPath || seen.has(repoPath)) continue
      if (pruneAbs.some(ep => repoPath.startsWith(ep))) continue
      seen.add(repoPath)

      const name = repoPath.split("/").pop() ?? repoPath
      const alreadySaved = savedPaths.some(sp => sp && expand(sp) === repoPath)
      const found: DiscoveredRepo = { path: repoPath, name, alreadySaved }
      results.push(found)
      onProgress?.(found)
    }
  }

  await Promise.all([
    ...config.includePaths.map(p => scanPath(p, config.maxDepth + 2)),
    scanPath(home, config.maxDepth),
  ])

  return results.sort((a, b) => {
    if (a.alreadySaved !== b.alreadySaved) return a.alreadySaved ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

export function addRepo(
  repoPath: string,
  repoName: string,
  opts: { remote?: string; github?: string | null } = {},
): boolean {
  ensureConfigFile()
  const filePath = `${GLib.get_home_dir()}/.config/jarvis/git-repos.json`
  try {
    const raw = readFile(filePath)
    const data = raw ? JSON.parse(raw) : { repos: [] }
    if (!Array.isArray(data.repos)) data.repos = []
    const home = GLib.get_home_dir()
    const alreadyExists = data.repos.find(
      (r: any) => r.path && expandPath(r.path) === repoPath,
    )
    if (alreadyExists) return false
    const displayPath = repoPath.startsWith(home) ? repoPath.replace(home, "~") : repoPath
    data.repos.push({
      id: `${repoName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`,
      name: repoName,
      path: displayPath,
      remote: opts.remote ?? "origin",
      github: opts.github ?? null,
    })
    saveConfig(data)
    return true
  } catch {
    return false
  }
}

export function pinRepo(repoPath: string, repoName: string): void {
  addRepo(repoPath, repoName)
}

export function removeRepo(repoId: string): void {
  const filePath = `${GLib.get_home_dir()}/.config/jarvis/git-repos.json`
  try {
    const raw = readFile(filePath)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!Array.isArray(data.repos)) return
    data.repos = data.repos.filter((r: any) => r.id !== repoId)
    saveFullConfig(data)
  } catch { /* ignore */ }
}
