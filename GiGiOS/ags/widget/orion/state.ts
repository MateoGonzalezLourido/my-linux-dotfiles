import { createState } from "ags"
import GLib from "gi://GLib"
import { searchEngine } from "./search"
import type { SearchResult } from "./search"
import { orionAppsDefault } from "../settings/preferences"

export type SectionId =
  | "inicio" | "apps" | "sistema" | "git" | "watcher"
  | "env" | "workflows" | "rice" | "ai"
  | "mascotas" | "keybinds" | "reactivo"

export const [orionVisible,  setOrionVisible]  = createState(false)
export const [activeSection,  setActiveSection]  = createState<SectionId>("inicio")
export const [searchQuery,    setSearchQuery]    = createState("")
export const [searchResults,  setSearchResults]  = createState<SearchResult[]>([])

export function preparePanelOpen() {
  const section = orionAppsDefault.get() ? "apps" : "inicio"
  originSection = section
  setSection(section)
}

export function showPanel()   { preparePanelOpen(); setOrionVisible(true) }
export function hidePanel()   { setOrionVisible(false); setSection("inicio"); originSection = "inicio" }
export function togglePanel() {
  if (orionVisible.get()) hidePanel()
  else showPanel()
}

type SectionListener = (id: SectionId) => void
const sectionListeners: SectionListener[] = []
export function onSectionChange(fn: SectionListener) { sectionListeners.push(fn) }

export function setSection(section: SectionId) {
  setActiveSection(section)
  sectionListeners.forEach(fn => fn(section))
}

// Section the user was in before a reactive search redirected them
let originSection: SectionId = "inicio"

export function setQuery(query: string) {
  setSearchQuery(query)

  if (!query.trim()) {
    setSearchResults([])
    hideRightPanel()
    // If we redirected to reactive, go back to where they came from
    if (activeSection.get() === "reactivo") setSection(originSection)
    return
  }

  const resolved = searchEngine.resolve(query, activeSection.get())

  if (resolved.inline) {
    // Active section handles filtering on its own (e.g. keybinds)
    return
  }

  // Remember origin before jumping to reactive
  if (activeSection.get() !== "reactivo") originSection = activeSection.get()
  setSearchResults(resolved.results)
  setSection("reactivo")

  // Auto-preview: if the apps handler won and there are results, open the first one
  const results = resolved.results
  if (resolved.handlerId === "apps" && results.length > 0) {
    const first    = results[0]
    const execName = first.meta?.execName ?? (first.meta?.exec ?? "").split(" ")[0].split("/").pop() ?? ""
    showAppContext({
      id:       first.id,
      name:     first.title,
      iconName: first.iconName ?? "application-x-executable",
      gicon:    first.icon ?? null,
      execRaw:  first.meta?.exec ?? "",
      execName,
      appId:    first.meta?.appId ?? first.id,
      launch:   () => first.action(),
    })
  } else {
    hideRightPanel()
  }
}

// ── Task panel ────────────────────────────────────────────────────────────────

export interface OrionTask {
  id: string
  message: string
  icon: string
}

export const [orionTasks,          setOrionTasks]          = createState<OrionTask[]>([])
export const [taskPanelUserEnabled, setTaskPanelUserEnabled] = createState(false)
export const [taskPanelVisible,     setTaskPanelVisible]     = createState(false)

function syncTaskPanel() {
  setTaskPanelVisible(taskPanelUserEnabled.get() && orionTasks.get().length > 0)
}
orionTasks.subscribe(syncTaskPanel)
taskPanelUserEnabled.subscribe(syncTaskPanel)

export interface GroupedTask {
  message: string
  icon: string
  count: number
}

export const [groupedTasks, setGroupedTasks] = createState<GroupedTask[]>([])

function syncGrouped() {
  const map = new Map<string, GroupedTask>()
  for (const t of orionTasks.get()) {
    const key = `${t.icon}::${t.message}`
    const g = map.get(key)
    if (g) g.count++
    else map.set(key, { message: t.message, icon: t.icon, count: 1 })
  }
  setGroupedTasks(Array.from(map.values()))
}
orionTasks.subscribe(syncGrouped)

export function addTask(message: string, icon: string): string {
  const id = GLib.uuid_string_random()
  setOrionTasks([...orionTasks.get(), { id, message, icon }])
  return id
}

export function removeTask(id: string) {
  setOrionTasks(orionTasks.get().filter(t => t.id !== id))
}

export function toggleTaskPanel() {
  setTaskPanelUserEnabled(!taskPanelUserEnabled.get())
}

// ── App context / right panel ─────────────────────────────────────────────────

export interface AppContextItem {
  id: string
  name: string
  iconName: string
  gicon?: any | null   // Gio.Icon — kept as `any` to avoid importing Gio in state
  execRaw: string   // full exec string
  execName: string  // bare binary name
  appId: string
  launch: () => void
}

export const [rightPanelApp,     setRightPanelApp]     = createState<AppContextItem | null>(null)
export const [rightPanelVisible, setRightPanelVisible] = createState(false)

orionVisible.subscribe(() => {
  if (!orionVisible.get()) setRightPanelVisible(false)
})

export function showAppContext(item: AppContextItem) {
  setRightPanelApp(item)
  setRightPanelVisible(true)
}

export function hideRightPanel() { setRightPanelVisible(false) }
