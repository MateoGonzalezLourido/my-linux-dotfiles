# Jarvis Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Jarvis launcher/control panel that slides up from the bottom of the screen, with tabs, a search bar, section navigation, and a Home section showing pinned apps, quick actions, and system stats.

**Architecture:** Jarvis is a GTK Layer Shell window (`BOTTOM | LEFT | RIGHT` anchored) that renders above all other windows. State lives in a dedicated `state.ts` module using AGS `createState`; profile persistence uses `GLib` file I/O. The panel is mounted once per monitor in `app.ts`, mirroring the existing bar/notification panel pattern.

**Tech Stack:** AGS / Astal (GTK4, `ags/gtk4`), TypeScript/TSX, SCSS (appended to `style.scss`), GLib for disk I/O, `ags/process` for shell commands.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `widget/jarvis/state.ts` | Create | All reactive state + helper functions |
| `widget/jarvis/ProfileManager.ts` | Create | Save/restore sessions to `~/.local/share/jarvis/profiles/` |
| `widget/jarvis/components/SearchBar.tsx` | Create | Search input, auto-focuses on panel open |
| `widget/jarvis/components/TabsBar.tsx` | Create | Home tab + dynamic pinned tabs + profile button |
| `widget/jarvis/components/sections/HomeSection.tsx` | Create | Apps grid, quick actions, system metrics strip |
| `widget/jarvis/components/sections/index.ts` | Create | Exports section map for NavSections |
| `widget/jarvis/components/NavSections.tsx` | Create | Section pills + active section content slot |
| `widget/jarvis/Jarvis.tsx` | Create | Layer Shell window wrapping all components |
| `app.ts` | Modify | Import + mount Jarvis |
| `style.scss` | Modify | Append all Jarvis CSS (tokens + components) |

---

## Task 1: State Module

**Files:**
- Create: `widget/jarvis/state.ts`

- [ ] **Step 1: Write `state.ts`**

```typescript
import { createState } from "ags"

export type SectionId =
  | "inicio" | "sistema" | "git" | "watcher"
  | "env" | "workflows" | "rice" | "ai"
  | "mascotas" | "keybinds" | "reactivo"

export type TabType = "home" | "image" | "command" | "calc" | "url" | "file"

export interface PinnedTab {
  id: string
  type: TabType
  label: string
  content: string
  timestamp: number
}

export const [jarvisVisible, setJarvisVisible] = createState(false)
export const [activeSection, setActiveSection] = createState<SectionId>("inicio")
export const [searchQuery, setSearchQuery] = createState("")
export const [pinnedTabs, setPinnedTabs] = createState<PinnedTab[]>([])
export const [activeTabId, setActiveTabId] = createState("home")

export function showPanel() { setJarvisVisible(true) }
export function hidePanel() { setJarvisVisible(false) }
export function togglePanel() { setJarvisVisible(!jarvisVisible.get()) }

export function setSection(section: SectionId) {
  setActiveSection(section)
}

export function setQuery(query: string) {
  setSearchQuery(query)
  setActiveSection(query.length > 0 ? "reactivo" : "inicio")
}

export function pinTab(tab: Omit<PinnedTab, "id" | "timestamp">) {
  const newTab: PinnedTab = {
    ...tab,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  }
  setPinnedTabs([...pinnedTabs.get(), newTab])
}

export function closeTab(id: string) {
  setPinnedTabs(pinnedTabs.get().filter(t => t.id !== id))
  if (activeTabId.get() === id) setActiveTabId("home")
}

export function setActiveTab(id: string) {
  setActiveTabId(id)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/.config/ags && ags run app.ts 2>&1 | head -20
```
Expected: AGS starts without TypeScript errors about `jarvis/state`.

- [ ] **Step 3: Commit**

```bash
git -C ~/.config/ags add widget/jarvis/state.ts
git -C ~/.config/ags commit -m "feat(jarvis): add reactive state module"
```

---

## Task 2: ProfileManager

**Files:**
- Create: `widget/jarvis/ProfileManager.ts`

- [ ] **Step 1: Write `ProfileManager.ts`**

```typescript
import GLib from "gi://GLib"
import { pinnedTabs, setPinnedTabs, activeSection, setActiveSection, PinnedTab } from "./state"

const PROFILES_DIR = `${GLib.get_home_dir()}/.local/share/jarvis/profiles`

export interface SessionProfile {
  name: string
  savedAt: number
  tabs: PinnedTab[]
  activeSection: string
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
  GLib.file_set_contents(profilePath(profileName), bytes)
  return profileName
}

export function loadProfiles(): SessionProfile[] {
  ensureDir()
  const dir = GLib.dir_open(PROFILES_DIR, 0)
  if (!dir) return []
  const profiles: SessionProfile[] = []
  let entry: string | null
  while ((entry = GLib.dir_read_name(dir)) !== null) {
    if (!entry.endsWith(".json")) continue
    try {
      const [ok, bytes] = GLib.file_get_contents(`${PROFILES_DIR}/${entry}`)
      if (ok) profiles.push(JSON.parse(new TextDecoder().decode(bytes)))
    } catch (_) {}
  }
  GLib.dir_close(dir)
  return profiles.sort((a, b) => b.savedAt - a.savedAt)
}

export function restoreProfile(profile: SessionProfile) {
  setPinnedTabs(profile.tabs)
  setActiveSection(profile.activeSection as any)
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
```

> **Note:** `GLib.dir_open` / `GLib.dir_read_name` / `GLib.dir_close` are the GLib directory-listing functions available in GJS. `GLib.unlink` removes a file.

Fix the missing import in clearSession (import `setActiveTabId` from `./state`):

```typescript
// At the top imports, add:
import { pinnedTabs, setPinnedTabs, activeSection, setActiveSection, setActiveTabId, PinnedTab } from "./state"
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd ~/.config/ags && ags run app.ts 2>&1 | head -20
```
Expected: AGS starts cleanly.

- [ ] **Step 3: Commit**

```bash
git -C ~/.config/ags add widget/jarvis/ProfileManager.ts
git -C ~/.config/ags commit -m "feat(jarvis): add session profile persistence"
```

---

## Task 3: Styles

**Files:**
- Modify: `style.scss` (append at end)

- [ ] **Step 1: Append Jarvis tokens and component CSS to `style.scss`**

Add the following block at the very end of `~/.config/ags/style.scss`:

```scss
// ═══════════════════════════════════════════════════════════
// JARVIS PANEL
// ═══════════════════════════════════════════════════════════

// ── Tokens ──────────────────────────────────────────────────
$j-bg-shell:       rgba(9, 12, 20, 0.97);
$j-bg-tabs:        rgba(6, 8, 15, 0.95);
$j-bg-item:        rgba(122, 162, 247, 0.025);
$j-bg-item-hover:  rgba(122, 162, 247, 0.07);
$j-bg-item-active: rgba(122, 162, 247, 0.08);

$j-accent:         #7aa2f7;
$j-accent-teal:    #73daca;
$j-accent-pink:    #ff79c6;
$j-accent-purple:  #bb9af7;
$j-accent-amber:   #e0af68;
$j-accent-red:     #f7768e;

$j-text-primary:   #c0caf5;
$j-text-secondary: #565f89;
$j-text-muted:     #2a3050;

$j-border-subtle:  rgba(122, 162, 247, 0.07);
$j-border-normal:  rgba(122, 162, 247, 0.11);
$j-border-active:  rgba(122, 162, 247, 0.25);

$j-radius:    20px;
$j-radius-md: 11px;
$j-radius-sm: 9px;
$j-radius-xs: 7px;

$j-font-mono: 'JetBrains Mono', 'Fira Code', monospace;
$j-font-sans: 'Inter', system-ui, sans-serif;

// ── Window ──────────────────────────────────────────────────
.Jarvis {
  background: transparent;
}

// ── Panel shell ─────────────────────────────────────────────
.jarvis-panel {
  background: $j-bg-shell;
  border: 1px solid $j-border-normal;
  border-bottom: none;
  border-radius: $j-radius $j-radius 0 0;
  min-width: 580px;
}

.jarvis-handle { padding: 10px 0 5px; }
.handle-bar {
  min-width: 40px;
  min-height: 3px;
  border-radius: 2px;
  background: rgba(122, 162, 247, 0.18);
}

// ── Button resets ────────────────────────────────────────────
.Jarvis button,
.jarvis-panel button {
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
  padding: 0;
  margin: 0;
}

// ── Tabs bar ─────────────────────────────────────────────────
.tabs-bar {
  background: $j-bg-tabs;
  border-bottom: 1px solid $j-border-subtle;
  min-height: 32px;
}

.j-tab {
  padding: 0 11px;
  font-size: 10px;
  font-family: $j-font-mono;
  color: $j-text-muted;
  border-right: 1px solid $j-border-subtle;
  border-bottom: 2px solid transparent;
  transition: all 100ms ease;
  &:hover { background: $j-bg-item-hover; color: $j-text-secondary; }
}
.j-tab.active  { color: $j-text-primary; border-bottom-color: $j-accent; }
.j-tab-home    { padding: 0 13px; }

.tab-x {
  padding: 0 2px;
  color: $j-text-muted;
  &:hover { color: $j-accent-red; }
}

.profile-btn {
  padding: 0 10px;
  color: $j-text-muted;
  border-left: 1px solid $j-border-subtle;
  &:hover { background: $j-bg-item-hover; color: $j-accent; }
}

.profile-dropdown {
  background: $j-bg-shell;
  border: 1px solid $j-border-normal;
  border-radius: $j-radius-md;
  padding: 8px 0;
  min-width: 220px;
}
.pd-header {
  font-size: 9px;
  color: $j-text-muted;
  padding: 0 12px 6px;
  font-family: $j-font-mono;
}
.pd-save-input { padding: 0 8px 6px; }
.pd-input {
  background: $j-bg-item;
  border: 1px solid $j-border-subtle;
  border-radius: $j-radius-xs;
  color: $j-text-primary;
  font-size: 11px;
  padding: 4px 8px;
}
.pd-confirm { color: $j-accent; }

.pd-action {
  padding: 7px 12px;
  &:hover { background: $j-bg-item-hover; }
}
.pd-action-danger { color: $j-accent-red; }
.pd-action-ico {
  width: 24px; height: 24px;
  border-radius: 6px;
}
.pdai-save  { background: rgba(122, 162, 247, 0.1); color: $j-accent; }
.pdai-clear { background: rgba(247, 118, 142, 0.1); color: $j-accent-red; }
.pd-action-name { font-size: 11px; color: $j-text-primary; }
.pd-action-sub  { font-size: 9px;  color: $j-text-muted; }

.pd-profiles-label {
  font-size: 9px; color: $j-text-muted;
  padding: 4px 12px 2px;
  font-family: $j-font-mono;
}
.pd-profile-item {
  padding: 5px 12px;
  &:hover { background: $j-bg-item-hover; }
}
.pd-profile-dot {
  min-width: 5px; min-height: 5px;
  border-radius: 50%;
  background: $j-accent;
}
.pd-profile-name { font-size: 11px; color: $j-text-primary; }
.pd-profile-meta { font-size: 9px;  color: $j-text-muted; }
.pd-pa { color: $j-text-muted; &:hover { color: $j-accent; } }
.pd-pa-del { &:hover { color: $j-accent-red; } }

// ── Search ───────────────────────────────────────────────────
.search-zone { padding: 12px 13px 10px; }
.search-bar {
  background: $j-bg-item;
  border: 1px solid rgba(122, 162, 247, 0.1);
  border-radius: $j-radius-md;
  padding: 10px 13px;

  image { color: $j-text-muted; }
  text { /* GTK4 Entry inner text node */
    background: transparent;
    color: $j-accent;
    font-family: $j-font-mono;
    font-size: 13px;
  }
  entry {
    background: transparent;
    border: none;
    box-shadow: none;
    color: $j-accent;
    font-family: $j-font-mono;
    font-size: 13px;
  }
}

// ── Nav sections ─────────────────────────────────────────────
.nav-sections {
  padding: 8px 11px 6px;
}
.ns {
  padding: 4px 8px;
  border-radius: $j-radius-xs;
  font-size: 10px;
  color: $j-text-muted;
  border: 1px solid transparent;
  &:hover { color: $j-text-secondary; background: $j-bg-item-hover; border-color: $j-border-subtle; }
  &.active { color: $j-accent; background: $j-bg-item-active; border-color: $j-border-active; }
}
.ns-reactive { color: $j-accent-teal; }
.ns-reactive.active {
  background: rgba(115, 218, 202, 0.08);
  border-color: rgba(115, 218, 202, 0.25);
}

.section-content { min-height: 10px; }

// ── Apps grid ────────────────────────────────────────────────
.section-home { padding-bottom: 4px; }
.apps-grid {
  padding: 4px 9px 8px;
}
.app-item {
  padding: 7px 2px;
  border-radius: $j-radius-sm;
  border: 1px solid transparent;
  &:hover { background: $j-bg-item-hover; border-color: $j-border-subtle; }
}
.app-icon {
  min-width: 34px; min-height: 34px;
  border-radius: $j-radius-sm;
  &.c-blue   { background: rgba(122, 162, 247, 0.1); color: $j-accent; }
  &.c-red    { background: rgba(247, 118, 142, 0.1); color: $j-accent-red; }
  &.c-purple { background: rgba(187, 154, 247, 0.1); color: $j-accent-purple; }
  &.c-teal   { background: rgba(115, 218, 202, 0.1); color: $j-accent-teal; }
  &.c-amber  { background: rgba(224, 175, 104, 0.1); color: $j-accent-amber; }
  &.c-pink   { background: rgba(255, 121, 198, 0.1); color: $j-accent-pink; }
  &.c-muted  { background: rgba(35, 42, 62, 0.9);    color: $j-text-muted; }
}
.app-label { font-size: 9px; color: $j-text-muted; }

.j-hdiv { background: $j-border-subtle; min-height: 1px; margin: 0 11px; }

// ── Quick actions ─────────────────────────────────────────────
.qa-row { padding: 8px 9px; }
.quick-action-btn {
  padding: 9px 4px;
  border-radius: $j-radius-sm;
  background: $j-bg-item;
  border: 1px solid $j-border-subtle;
  &:hover { background: $j-bg-item-hover; border-color: $j-border-active; }
}
.qa-icon {
  min-width: 24px; min-height: 24px;
  border-radius: 6px;
  &.c-blue   { background: rgba(122, 162, 247, 0.1); color: $j-accent; }
  &.c-red    { background: rgba(247, 118, 142, 0.1); color: $j-accent-red; }
  &.c-purple { background: rgba(187, 154, 247, 0.1); color: $j-accent-purple; }
  &.c-teal   { background: rgba(115, 218, 202, 0.1); color: $j-accent-teal; }
  &.c-amber  { background: rgba(224, 175, 104, 0.1); color: $j-accent-amber; }
  &.c-pink   { background: rgba(255, 121, 198, 0.1); color: $j-accent-pink; }
  &.c-muted  { background: rgba(35, 42, 62, 0.9);    color: $j-text-muted; }
}
.qa-label { font-size: 10px; color: $j-text-secondary; font-weight: 500; }

// ── System strip ──────────────────────────────────────────────
.sys-strip { padding: 8px 9px 10px; }
.sys-card {
  background: $j-bg-item;
  border: 1px solid $j-border-subtle;
  border-radius: 8px;
  padding: 7px 9px;
}
.sys-label { font-size: 9px; color: $j-text-muted; font-family: $j-font-mono; }
.sys-val   { font-size: 12px; font-weight: 500; color: $j-accent; font-family: $j-font-mono; }
.sys-bar   { background: rgba(122, 162, 247, 0.07); border-radius: 2px; min-height: 2px; }
.sys-fill  { border-radius: 2px; min-height: 2px; }
.sf-blue   { background: rgba(122, 162, 247, 0.55); }
.sf-pink   { background: rgba(247, 118, 142, 0.55); }
.sf-teal   { background: rgba(115, 218, 202, 0.55); }
.sf-amber  { background: rgba(224, 175, 104, 0.55); }
```

- [ ] **Step 2: Verify SCSS compiles (AGS compiles it on start)**

```bash
cd ~/.config/ags && ags run app.ts 2>&1 | grep -i "scss\|css\|error" | head -10
```
Expected: No SCSS compilation errors.

- [ ] **Step 3: Commit**

```bash
git -C ~/.config/ags add style.scss
git -C ~/.config/ags commit -m "feat(jarvis): add Jarvis design tokens and component CSS"
```

---

## Task 4: SearchBar

**Files:**
- Create: `widget/jarvis/components/SearchBar.tsx`

- [ ] **Step 1: Write `SearchBar.tsx`**

```tsx
import { Gtk } from "ags/gtk4"
import { setQuery, jarvisVisible } from "../state"

export default function SearchBar() {
  let entry: Gtk.Entry | undefined

  jarvisVisible.subscribe(v => {
    if (v) entry?.grab_focus()
    if (!v && entry) entry.text = ""
  })

  return (
    <box cssClasses={["search-zone"]}>
      <box cssClasses={["search-bar"]} hexpand>
        <image iconName="system-search-symbolic" cssClasses={["search-icon"]} />
        <entry
          cssClasses={["search-input"]}
          hexpand
          placeholderText=""
          onChanged={(self) => setQuery(self.text)}
          setup={(self: Gtk.Entry) => { entry = self }}
        />
      </box>
    </box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git -C ~/.config/ags add widget/jarvis/components/SearchBar.tsx
git -C ~/.config/ags commit -m "feat(jarvis): add SearchBar component"
```

---

## Task 5: TabsBar

**Files:**
- Create: `widget/jarvis/components/TabsBar.tsx`

- [ ] **Step 1: Write `TabsBar.tsx`**

```tsx
import { Gtk } from "ags/gtk4"
import { For } from "ags"
import {
  pinnedTabs, activeTabId, setActiveTab, closeTab, PinnedTab, TabType
} from "../state"
import {
  saveProfile, loadProfiles, restoreProfile, deleteProfile, clearSession, SessionProfile
} from "../ProfileManager"

const TAB_META: Record<TabType, { icon: string }> = {
  home:    { icon: "go-home-symbolic" },
  image:   { icon: "image-x-generic-symbolic" },
  command: { icon: "utilities-terminal-symbolic" },
  calc:    { icon: "accessories-calculator-symbolic" },
  url:     { icon: "web-browser-symbolic" },
  file:    { icon: "text-x-generic-symbolic" },
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60)    return "ahora"
  if (diff < 3600)  return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  return `hace ${Math.floor(diff / 86400)}d`
}

function ProfileDropdown() {
  let nameEntry: Gtk.Entry | undefined

  function refreshList(box: Gtk.Box) {
    // Remove all children
    let child = box.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      box.remove(child)
      child = next
    }
    loadProfiles().forEach(profile => {
      const row = (
        <box cssClasses={["pd-profile-item"]} spacing={8}>
          <box cssClasses={["pd-profile-dot"]} />
          <box orientation={Gtk.Orientation.VERTICAL} hexpand>
            <label
              label={profile.name}
              halign={Gtk.Align.START}
              cssClasses={["pd-profile-name"]}
              maxWidthChars={20}
              ellipsize={3}
            />
            <label
              label={`${profile.tabs.length} tabs · ${relativeTime(profile.savedAt)}`}
              halign={Gtk.Align.START}
              cssClasses={["pd-profile-meta"]}
            />
          </box>
          <button
            cssClasses={["pd-pa"]}
            onClicked={() => restoreProfile(profile)}
          >
            <image iconName="document-open-symbolic" />
          </button>
          <button
            cssClasses={["pd-pa", "pd-pa-del"]}
            onClicked={() => {
              deleteProfile(profile.name)
              refreshList(box)
            }}
          >
            <image iconName="user-trash-symbolic" />
          </button>
        </box>
      ) as unknown as Gtk.Widget
      box.append(row)
    })
  }

  let profileListBox: Gtk.Box | undefined

  const content = (
    <box cssClasses={["profile-dropdown"]} orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      <label cssClasses={["pd-header"]} label="perfiles de sesión" halign={Gtk.Align.START} />

      <box cssClasses={["pd-save-input"]} spacing={6}>
        <entry
          cssClasses={["pd-input"]}
          placeholderText="nombre del perfil…"
          maxLength={24}
          hexpand
          setup={(self: Gtk.Entry) => { nameEntry = self }}
        />
        <button
          cssClasses={["pd-confirm"]}
          onClicked={() => {
            if (nameEntry) {
              saveProfile(nameEntry.text || undefined)
              nameEntry.text = ""
              if (profileListBox) refreshList(profileListBox)
            }
          }}
        >
          <image iconName="object-select-symbolic" />
        </button>
      </box>

      <button cssClasses={["pd-action"]} onClicked={() => nameEntry?.grab_focus()}>
        <box spacing={8}>
          <box cssClasses={["pd-action-ico", "pdai-save"]}>
            <image iconName="document-save-symbolic" />
          </box>
          <box orientation={Gtk.Orientation.VERTICAL}>
            <label cssClasses={["pd-action-name"]} label="guardar sesión" halign={Gtk.Align.START} />
            <label cssClasses={["pd-action-sub"]} label="tabs + sección → disco" halign={Gtk.Align.START} />
          </box>
        </box>
      </button>

      <button cssClasses={["pd-action", "pd-action-danger"]} onClicked={() => clearSession()}>
        <box spacing={8}>
          <box cssClasses={["pd-action-ico", "pdai-clear"]}>
            <image iconName="user-trash-symbolic" />
          </box>
          <box orientation={Gtk.Orientation.VERTICAL}>
            <label cssClasses={["pd-action-name"]} label="limpiar sesión" halign={Gtk.Align.START} />
            <label cssClasses={["pd-action-sub"]} label="cierra tabs · libera ram" halign={Gtk.Align.START} />
          </box>
        </box>
      </button>

      <label cssClasses={["pd-profiles-label"]} label="guardados" halign={Gtk.Align.START} />
      <box
        orientation={Gtk.Orientation.VERTICAL}
        setup={(self: Gtk.Box) => {
          profileListBox = self
          refreshList(self)
        }}
      />
    </box>
  )

  const popover = new Gtk.Popover()
  popover.set_child(content as unknown as Gtk.Widget)

  return (
    <menubutton cssClasses={["profile-btn"]} popover={popover}>
      <image iconName="view-list-symbolic" />
    </menubutton>
  )
}

export default function TabsBar() {
  return (
    <box cssClasses={["tabs-bar"]} hexpand>

      {/* Fixed home tab */}
      <button
        cssClasses={activeTabId(id => id === "home" ? ["j-tab", "j-tab-home", "active"] : ["j-tab", "j-tab-home"])}
        onClicked={() => setActiveTab("home")}
      >
        <image iconName="go-home-symbolic" />
      </button>

      {/* Dynamic pinned tabs */}
      <scrolledwindow
        hexpand
        vscrollbarPolicy={Gtk.PolicyType.NEVER}
        hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      >
        <box>
          <For each={pinnedTabs}>
            {(tab: PinnedTab) => (
              <button
                cssClasses={activeTabId(id => id === tab.id ? ["j-tab", "active"] : ["j-tab"])}
                onClicked={() => setActiveTab(tab.id)}
              >
                <box spacing={4}>
                  <image iconName={TAB_META[tab.type].icon} />
                  <label label={tab.label} maxWidthChars={18} ellipsize={3} />
                  <button
                    cssClasses={["tab-x"]}
                    onClicked={() => closeTab(tab.id)}
                  >
                    <image iconName="window-close-symbolic" />
                  </button>
                </box>
              </button>
            )}
          </For>
        </box>
      </scrolledwindow>

      <ProfileDropdown />

    </box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git -C ~/.config/ags add widget/jarvis/components/TabsBar.tsx
git -C ~/.config/ags commit -m "feat(jarvis): add TabsBar with profile management"
```

---

## Task 6: HomeSection

**Files:**
- Create: `widget/jarvis/components/sections/HomeSection.tsx`
- Create: `widget/jarvis/components/sections/index.ts`

- [ ] **Step 1: Write `HomeSection.tsx`**

```tsx
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { createState } from "ags"
import GLib from "gi://GLib"
import { hidePanel, setSection, SectionId } from "../../state"

interface PinnedApp {
  id: string; name: string; icon: string; exec: string; color: string
}

const PINNED_APPS: PinnedApp[] = [
  { id: "code",     name: "VS Code",  icon: "code",                exec: "code",     color: "c-blue"   },
  { id: "firefox",  name: "Firefox",  icon: "firefox",             exec: "firefox",  color: "c-red"    },
  { id: "kitty",    name: "Kitty",    icon: "kitty",               exec: "kitty",    color: "c-purple" },
  { id: "files",    name: "Archivos", icon: "system-file-manager", exec: "nautilus", color: "c-teal"   },
  { id: "obsidian", name: "Obsidian", icon: "obsidian",            exec: "obsidian", color: "c-amber"  },
  { id: "discord",  name: "Discord",  icon: "discord",             exec: "discord",  color: "c-blue"   },
]

interface QuickAction {
  id: string; label: string; icon: string; color: string; targetSection: SectionId
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "workflows", label: "workflows", icon: "view-grid-symbolic",                   color: "c-pink",   targetSection: "workflows" },
  { id: "temas",     label: "temas",     icon: "preferences-desktop-theme-symbolic",   color: "c-blue",   targetSection: "rice"      },
  { id: "ssh",       label: "ssh",       icon: "network-server-symbolic",              color: "c-purple", targetSection: "workflows" },
  { id: "clipboard", label: "clipboard", icon: "edit-paste-symbolic",                  color: "c-teal",   targetSection: "watcher"   },
  { id: "env",       label: "env",       icon: "preferences-system-symbolic",          color: "c-amber",  targetSection: "env"       },
  { id: "watcher",   label: "watcher",   icon: "camera-photo-symbolic",                color: "c-red",    targetSection: "watcher"   },
  { id: "keybinds",  label: "keybinds",  icon: "input-keyboard-symbolic",              color: "c-muted",  targetSection: "keybinds"  },
  { id: "ai",        label: "ai hub",    icon: "applications-science-symbolic",        color: "c-teal",   targetSection: "ai"        },
]

const [cpuUsage, setCpuUsage] = createState(0)
const [gpuUsage, setGpuUsage] = createState(0)
const [ramUsed,  setRamUsed]  = createState("0G")
const [vramUsed, setVramUsed] = createState("0G")

let pollingStarted = false

function startSystemPolling() {
  if (pollingStarted) return
  pollingStarted = true

  const poll = async () => {
    try {
      const cpu = await execAsync(["bash", "-c", "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"])
      setCpuUsage(Math.round(parseFloat(cpu)))
    } catch (_) {}

    try {
      const ram = await execAsync(["bash", "-c", "free -g | awk '/Mem:/{print $3}'"])
      setRamUsed(`${ram.trim()}G`)
    } catch (_) {}

    try {
      const gpuOut = await execAsync([
        "nvidia-smi",
        "--query-gpu=utilization.gpu,memory.used",
        "--format=csv,noheader,nounits"
      ])
      const [gpuPct, vramMb] = gpuOut.trim().split(", ")
      setGpuUsage(Math.round(parseFloat(gpuPct)))
      setVramUsed(`${(parseFloat(vramMb) / 1024).toFixed(1)}G`)
    } catch (_) {}
  }

  poll()
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => { poll(); return GLib.SOURCE_CONTINUE })
}

startSystemPolling()

export function HomeSection() {
  const metrics = [
    { label: "CPU",  val: cpuUsage, isNum: true,  css: "sf-blue"  },
    { label: "GPU",  val: gpuUsage, isNum: true,  css: "sf-pink"  },
    { label: "RAM",  val: ramUsed,  isNum: false, css: "sf-teal"  },
    { label: "VRAM", val: vramUsed, isNum: false, css: "sf-amber" },
  ]

  return (
    <box cssClasses={["section-home"]} orientation={Gtk.Orientation.VERTICAL}>

      {/* Apps grid */}
      <box cssClasses={["apps-grid"]}>
        {PINNED_APPS.map(app => (
          <button
            cssClasses={["app-item"]}
            onClicked={() => {
              execAsync(app.exec).catch(console.error)
              hidePanel()
            }}
            tooltipText={app.name}
          >
            <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
              <box cssClasses={["app-icon", app.color]} halign={Gtk.Align.CENTER}>
                <image iconName={app.icon} iconSize={3 /* LARGE_TOOLBAR */} />
              </box>
              <label label={app.name} cssClasses={["app-label"]} maxWidthChars={7} ellipsize={3} />
            </box>
          </button>
        ))}
        {/* "All apps" button */}
        <button
          cssClasses={["app-item"]}
          onClicked={() =>
            execAsync(["anyrun"]).catch(() =>
              execAsync(["rofi", "-show", "drun"]).catch(console.error)
            )
          }
        >
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <box cssClasses={["app-icon", "c-muted"]} halign={Gtk.Align.CENTER}>
              <image iconName="view-app-grid-symbolic" iconSize={3} />
            </box>
            <label label="todas" cssClasses={["app-label"]} />
          </box>
        </button>
      </box>

      <box cssClasses={["j-hdiv"]} />

      {/* Quick actions */}
      <box cssClasses={["qa-row"]}>
        {QUICK_ACTIONS.map(action => (
          <button
            cssClasses={["quick-action-btn"]}
            onClicked={() => setSection(action.targetSection)}
          >
            <box orientation={Gtk.Orientation.VERTICAL} spacing={5}>
              <box cssClasses={["qa-icon", action.color]} halign={Gtk.Align.CENTER}>
                <image iconName={action.icon} />
              </box>
              <label label={action.label} cssClasses={["qa-label"]} />
            </box>
          </button>
        ))}
      </box>

      <box cssClasses={["j-hdiv"]} />

      {/* System strip */}
      <box cssClasses={["sys-strip"]} spacing={5}>
        {metrics.map(m => (
          <box cssClasses={["sys-card"]} orientation={Gtk.Orientation.VERTICAL} hexpand>
            <label label={m.label} cssClasses={["sys-label"]} halign={Gtk.Align.START} />
            <label
              cssClasses={["sys-val"]}
              halign={Gtk.Align.START}
              label={m.isNum
                ? (m.val as ReturnType<typeof createState<number>>[0])((v) => `${v}%`)
                : (m.val as ReturnType<typeof createState<string>>[0])((v) => `${v}`)
              }
            />
            <box cssClasses={["sys-bar"]}>
              <box
                cssClasses={["sys-fill", m.css]}
                widthRequest={m.isNum
                  ? (m.val as ReturnType<typeof createState<number>>[0])((v) => Math.round((v / 100) * 120))
                  : 60
                }
              />
            </box>
          </box>
        ))}
      </box>

    </box>
  )
}
```

> **Note on `createState` generics:** The `label` and `widthRequest` bindings use `state(transform)` reactive syntax. For the mixed numeric/string states in the metrics array, cast them when binding. If TypeScript complains, write each metric card inline without the `.map()`.

- [ ] **Step 2: Write `sections/index.ts`**

```typescript
import { SectionId } from "../../state"
import { HomeSection } from "./HomeSection"

export const SECTION_COMPONENTS: Partial<Record<SectionId, () => any>> = {
  inicio: HomeSection,
  // Future sections registered here
}
```

- [ ] **Step 3: Commit**

```bash
git -C ~/.config/ags add widget/jarvis/components/sections/
git -C ~/.config/ags commit -m "feat(jarvis): add HomeSection with apps, quick actions, system stats"
```

---

## Task 7: NavSections

**Files:**
- Create: `widget/jarvis/components/NavSections.tsx`

- [ ] **Step 1: Write `NavSections.tsx`**

```tsx
import { Gtk } from "ags/gtk4"
import { activeSection, setSection, SectionId } from "../state"
import { SECTION_COMPONENTS } from "./sections/index"

interface SectionMeta {
  id: SectionId
  label: string
  icon: string
  reactive?: boolean
}

const SECTIONS: SectionMeta[] = [
  { id: "inicio",    label: "inicio",    icon: "go-home-symbolic" },
  { id: "sistema",   label: "sistema",   icon: "computer-symbolic" },
  { id: "git",       label: "git",       icon: "vcs-branch-symbolic" },
  { id: "watcher",   label: "watcher",   icon: "camera-photo-symbolic" },
  { id: "env",       label: "env",       icon: "preferences-system-symbolic" },
  { id: "workflows", label: "workflows", icon: "view-grid-symbolic" },
  { id: "rice",      label: "rice",      icon: "preferences-desktop-theme-symbolic" },
  { id: "ai",        label: "ai",        icon: "applications-science-symbolic" },
  { id: "mascotas",  label: "mascotas",  icon: "emoji-nature-symbolic" },
  { id: "keybinds",  label: "keybinds",  icon: "input-keyboard-symbolic" },
  { id: "reactivo",  label: "reactivo",  icon: "go-jump-symbolic", reactive: true },
]

function SectionContent() {
  let currentWidget: Gtk.Widget | null = null
  let container: Gtk.Box | undefined

  activeSection.subscribe(sectionId => {
    if (!container) return
    if (currentWidget) {
      container.remove(currentWidget)
      currentWidget = null
    }
    const Component = SECTION_COMPONENTS[sectionId]
    if (Component) {
      currentWidget = Component() as unknown as Gtk.Widget
      container.append(currentWidget)
    }
  })

  return (
    <box
      cssClasses={["section-content"]}
      orientation={Gtk.Orientation.VERTICAL}
      setup={(self: Gtk.Box) => {
        container = self
        // Render initial section
        const Component = SECTION_COMPONENTS[activeSection.get()]
        if (Component) {
          currentWidget = Component() as unknown as Gtk.Widget
          self.append(currentWidget)
        }
      }}
    />
  )
}

export default function NavSections() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL}>

      <scrolledwindow
        hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        vscrollbarPolicy={Gtk.PolicyType.NEVER}
      >
        <box cssClasses={["nav-sections"]} spacing={2}>
          {SECTIONS.map(sec => (
            <button
              cssClasses={activeSection(id =>
                id === sec.id
                  ? (sec.reactive ? ["ns", "ns-reactive", "active"] : ["ns", "active"])
                  : (sec.reactive ? ["ns", "ns-reactive"] : ["ns"])
              )}
              onClicked={() => setSection(sec.id)}
            >
              <box spacing={4}>
                <image iconName={sec.icon} />
                <label label={sec.label} />
              </box>
            </button>
          ))}
        </box>
      </scrolledwindow>

      <SectionContent />

    </box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git -C ~/.config/ags add widget/jarvis/components/NavSections.tsx
git -C ~/.config/ags commit -m "feat(jarvis): add NavSections with dynamic content slot"
```

---

## Task 8: Jarvis Window

**Files:**
- Create: `widget/jarvis/Jarvis.tsx`

- [ ] **Step 1: Write `Jarvis.tsx`**

```tsx
import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { jarvisVisible, hidePanel } from "./state"
import TabsBar from "./components/TabsBar"
import SearchBar from "./components/SearchBar"
import NavSections from "./components/NavSections"

export default function Jarvis(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  return (
    <window
      name="jarvis"
      visible={jarvisVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      anchor={BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      application={app}
      decorated={false}
      cssClasses={["Jarvis"]}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) { hidePanel(); return true }
          return false
        }}
      />

      {/* Full-width backdrop — click closes panel */}
      <box hexpand vexpand>
        <Gtk.GestureClick onReleased={() => hidePanel()} />

        {/* Panel centered on backdrop */}
        <box hexpand halign={Gtk.Align.CENTER}>
          {/* Capture clicks on panel so they don't bubble to backdrop */}
          <Gtk.GestureClick onPressed={(self: any) => {
            self.set_state(Gdk.EventSequenceState.CLAIMED)
          }} />

          <box cssClasses={["jarvis-panel"]} orientation={Gtk.Orientation.VERTICAL}>
            <box cssClasses={["jarvis-handle"]} halign={Gtk.Align.CENTER}>
              <box cssClasses={["handle-bar"]} />
            </box>
            <TabsBar />
            <SearchBar />
            <NavSections />
          </box>
        </box>
      </box>
    </window>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git -C ~/.config/ags add widget/jarvis/Jarvis.tsx
git -C ~/.config/ags commit -m "feat(jarvis): add main Jarvis window"
```

---

## Task 9: Integration — app.ts + Hyprland

**Files:**
- Modify: `app.ts`
- Modify: `~/.config/hypr/keybindings.conf` (or equivalent)
- Modify: Hyprland window rules config

- [ ] **Step 1: Add Jarvis to `app.ts`**

Edit `~/.config/ags/app.ts` — add import at the top (after existing imports):

```typescript
import Jarvis from "./widget/jarvis/Jarvis"
```

Inside `main()`, add after the last existing `.map()` call:

```typescript
app.get_monitors().map(Jarvis)
```

The full `main()` block becomes:

```typescript
main() {
  app.get_monitors().flatMap(Bar)
  app.get_monitors().map(PowerOptions)
  app.get_monitors().map(MicOSD)
  app.get_monitors().map(PixelVolumeOSD)
  app.get_monitors().map(PixelMicOSD)
  app.get_monitors().map(QuickSettings)
  app.get_monitors().map(NotificationPopup)
  app.get_monitors().map(NotificationPanel)
  app.get_monitors().map(CalendarPanel)
  app.get_monitors().map(Jarvis)          // ← new
},
```

- [ ] **Step 2: Test AGS starts without errors**

```bash
ags run ~/.config/ags/app.ts 2>&1 | head -30
```
Expected: AGS starts cleanly; no TypeScript errors. Jarvis window hidden by default.

- [ ] **Step 3: Toggle Jarvis manually to verify it renders**

In a second terminal:

```bash
astal -i ags -t jarvis
```

Expected: Jarvis panel slides up from the bottom. Press Escape or toggle again to close.

- [ ] **Step 4: Add Hyprland keybind**

Find your keybindings file (commonly `~/.config/hypr/keybindings.conf` or inline in `hyprland.conf`):

```bash
grep -r "keybind\|bind " ~/.config/hypr/ --include="*.conf" -l
```

Add this line to that file:

```ini
bind = SUPER ALT, Space, exec, astal -i ags -t jarvis
```

- [ ] **Step 5: Add Hyprland window rules**

Find where your `windowrulev2` rules live:

```bash
grep -r "windowrulev2" ~/.config/hypr/ --include="*.conf" -l
```

Append to that file:

```ini
# Jarvis panel
windowrulev2 = float,    title:^(jarvis)$
windowrulev2 = noborder, title:^(jarvis)$
windowrulev2 = noshadow, title:^(jarvis)$

# Blur
layerrule = blur,          jarvis
layerrule = ignorezero,    jarvis
layerrule = ignorealpha 0.3, jarvis
```

- [ ] **Step 6: Reload Hyprland config**

```bash
hyprctl reload
```

- [ ] **Step 7: Test keybind**

Press `SUPER+ALT+Space`. Jarvis panel should appear.

- [ ] **Step 8: Final commit**

```bash
git -C ~/.config/ags add app.ts
git -C ~/.config/ags commit -m "feat(jarvis): wire Jarvis into app.ts"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Plan task |
|---|---|
| §1 File structure | File Map + all tasks |
| §2 Design tokens | Task 3 (SCSS) |
| §3 AppState | Task 1 (state.ts, adapted to `createState`) |
| §4 ProfileManager | Task 2 |
| §5 Jarvis window | Task 8 |
| §6 TabsBar | Task 5 |
| §7 SearchBar | Task 4 |
| §8 NavSections | Task 7 |
| §9 HomeSection | Task 6 |
| §10 app.ts integration | Task 9, Step 1 |
| §11 Hyprland keybind + rules | Task 9, Steps 4-6 |
| §12 CSS | Task 3 |
| §13 Not in this delivery | N/A (noted as future work) |
| §14 System dependencies | Listed below |

**GTK4 adaptations made (not in spec):**
- All imports changed from `astal/gtk3` → `ags/gtk4`; `astal` → `ags`
- `Variable` → `createState` throughout
- `className` → `cssClasses={[...]}`
- `onButtonPressEvent` → `<Gtk.GestureClick>`
- `onKeyPressEvent` → `<Gtk.EventControllerKey>`
- Disk I/O: `Gio.File` → `GLib.file_get_contents` / `GLib.file_set_contents`
- `GLib.timeout_add` return constant: `GLib.SOURCE_CONTINUE` instead of `true`
- Window `name` prop enables `astal -i ags -t jarvis` toggle (same as spec)

**Dependencies to install (from spec §14):**

```bash
# If not already installed
yay -S fd cliphist wl-clipboard
# nvidia-smi comes with the nvidia driver (already present for VRAM monitoring)
```
