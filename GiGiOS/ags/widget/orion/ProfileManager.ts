import GLib from "gi://GLib"
import { pinnedTabs, setPinnedTabs, activeSection, setActiveSection, setActiveTabId, PinnedTab, SectionId } from "./state"

const PROFILES_DIR = `${GLib.get_home_dir()}/.local/share/orion/profiles`

export interface SessionProfile {
  name: string
  savedAt: number
  tabs: PinnedTab[]
  activeSection: SectionId
}

function ensureDir() {
  GLib.mkdir_with_parents(PROFILES_DIR, 0o755)
}

function profilePath(name: string): string {
  const safe = name.replace(/[^a-z0-9-]/gi, "_")
  return `${PROFILES_DIR}/${safe}.json`
}

export function saveProfile(name?: string): string {
  ensureDir()
  const profileName = name?.trim() || `sesión-${new Date().toISOString().slice(0, 10)}`
  const profile: SessionProfile = {
    name: profileName,
    savedAt: Date.now(),
    tabs: pinnedTabs.get(),
    activeSection: activeSection.get(),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(profile, null, 2))
  const [ok] = GLib.file_set_contents(profilePath(profileName), bytes)
  if (!ok) console.warn(`[Orion] Failed to save profile: ${profileName}`)
  return profileName
}

export function loadProfiles(): SessionProfile[] {
  ensureDir()
  let dir: GLib.Dir
  try {
    dir = GLib.dir_open(PROFILES_DIR, 0)
  } catch (_) {
    return []
  }
  const profiles: SessionProfile[] = []
  let entry: string | null
  while ((entry = GLib.dir_read_name(dir)) !== null) {
    if (!entry.endsWith(".json")) continue
    try {
      const [ok, bytes] = GLib.file_get_contents(`${PROFILES_DIR}/${entry}`)
      if (ok) profiles.push(JSON.parse(new TextDecoder().decode(bytes)))
    } catch (e) { console.warn("[Orion] Skipping corrupt profile:", e) }
  }
  GLib.dir_close(dir)
  return profiles.sort((a, b) => b.savedAt - a.savedAt)
}

export function restoreProfile(profile: SessionProfile) {
  setPinnedTabs(profile.tabs)
  const VALID_SECTIONS = new Set<string>(["inicio","sistema","git","watcher","env","workflows","rice","ai","mascotas","keybinds","reactivo"])
  setActiveSection(
    VALID_SECTIONS.has(profile.activeSection)
      ? (profile.activeSection as SectionId)
      : "inicio"
  )
}

export function deleteProfile(name: string) {
  const path = profilePath(name)
  if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
    GLib.unlink(path)
  }
}

export function clearSession() {
  setPinnedTabs([])
  setActiveTabId("home")
}
