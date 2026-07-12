import { createState } from "ags"
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
