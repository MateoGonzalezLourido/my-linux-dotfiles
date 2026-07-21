import type Gio from "gi://Gio"
import type { SectionId } from "../state"

export interface SearchResult {
  id: string
  title: string
  subtitle?: string
  icon?: Gio.Icon | null
  iconName?: string
  /** If set, ReactiveSection navigates here instead of closing the panel */
  navigateTo?: SectionId
  /** Extra metadata passed to result renderers (e.g. app exec, app id) */
  meta?: Record<string, string>
  action: () => void
}

export interface SearchContext {
  section: SectionId
}

export interface SearchHandler {
  readonly id: string
  /** Sections where this handler is used by default (gets a score boost) */
  readonly defaultFor: readonly SectionId[]
  /** Sections where results are shown inline — no redirect to reactive */
  readonly inlineFor: readonly SectionId[]
  confidence(query: string, ctx: SearchContext): number
  search(query: string, ctx: SearchContext): SearchResult[]
}
