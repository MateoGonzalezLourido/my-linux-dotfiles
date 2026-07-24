// Estado central de Orion: sección activa, búsqueda y panel contextual
// derecho. Es la única pieza que las secciones y `Orion.tsx` comparten —
// evita que cada componente importe a otro directamente.

import { createState } from "ags"
import { resolveSearch } from "./search"
import type { SearchResult } from "./search"
import {
  orionAppsDefault,
  orionRecordarUltimaSeccion,
} from "../ajustes/preferences"

export type SectionId =
  | "inicio" | "apps" | "rice" | "keybinds" | "reactivo"

export const [orionVisible,  setOrionVisible]  = createState(false)
export const [activeSection,  setActiveSection]  = createState<SectionId>("inicio")
export const [searchQuery,    setSearchQuery]    = createState("")
export const [searchResults,  setSearchResults]  = createState<SearchResult[]>([])

// Solo vive durante la sesión actual de AGS. Un reinicio vuelve a respetar la
// página inicial y evita convertir estado de navegación en configuración.
let ultimaSeccionCerrada: SectionId | null = null

function seccionActualRecordable(): SectionId {
  return activeSection.get() === "reactivo" ? originSection : activeSection.get()
}

function recordarSeccionAlCerrar(): void {
  ultimaSeccionCerrada = orionRecordarUltimaSeccion.get()
    ? seccionActualRecordable()
    : null
}

export function preparePanelOpen() {
  setSearchQuery("")
  setSearchResults([])
  setRightPanelVisible(false)
  const seccionInicial: SectionId = orionAppsDefault.get() ? "apps" : "inicio"
  const seccion = orionRecordarUltimaSeccion.get()
    ? ultimaSeccionCerrada ?? seccionInicial
    : seccionInicial
  originSection = seccion
  // No notificar un cambio inexistente conserva también el desplazamiento de
  // la sección montada al volver a abrir Orion.
  if (activeSection.get() !== seccion) setSection(seccion)
}

export function showPanel()   { preparePanelOpen(); setOrionVisible(true) }
export function hidePanel()   { recordarSeccionAlCerrar(); setOrionVisible(false) }
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

/** Limpia el estado cuando la ventana ya ha terminado de salir de pantalla. */
export function finalizarCierrePanel() {
  if (orionVisible.get()) return
  recordarSeccionAlCerrar()
  setSearchQuery("")
  setSearchResults([])
  setRightPanelVisible(false)
  if (ultimaSeccionCerrada !== null) {
    originSection = ultimaSeccionCerrada
    if (activeSection.get() !== ultimaSeccionCerrada) setSection(ultimaSeccionCerrada)
    return
  }
  if (activeSection.get() !== "inicio") setSection("inicio")
  originSection = "inicio"
}

// Si se desactiva y se vuelve a activar sin abrir Orion entre medias, no debe
// reaparecer una sección guardada por una configuración anterior.
orionRecordarUltimaSeccion.subscribe(() => {
  if (!orionRecordarUltimaSeccion.get()) ultimaSeccionCerrada = null
})

export function setQuery(query: string) {
  setSearchQuery(query)

  if (!query.trim()) {
    setSearchResults([])
    hideRightPanel()
    // If we redirected to reactive, go back to where they came from
    if (activeSection.get() === "reactivo") setSection(originSection)
    return
  }

  const resolved = resolveSearch(query, activeSection.get())

  if (resolved.inline) {
    // Active section handles filtering on its own (e.g. keybinds)
    return
  }

  // Remember origin before jumping to reactive
  if (activeSection.get() !== "reactivo") originSection = activeSection.get()
  setSearchResults(resolved.results)
  setSection("reactivo")

  // Auto-preview: if the first result is an app (the list can now mix apps and
  // shortcuts), open its context in the right panel.
  const first = resolved.results[0]
  if (first?.meta?.exec) {
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

export function showAppContext(item: AppContextItem) {
  setRightPanelApp(item)
  setRightPanelVisible(true)
}

export function hideRightPanel() { setRightPanelVisible(false) }
