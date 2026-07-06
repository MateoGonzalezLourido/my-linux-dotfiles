# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An [AGS v2](https://github.com/Aylur/ags) (Astal) desktop shell for Hyprland/Wayland, written in TypeScript + JSX targeting GTK4. It renders a per-monitor bar plus a collection of panels and overlays. There is no `package.json`, `tsconfig.json`, or test suite — AGS itself owns bundling, transpilation, and the runtime. `@girs/` holds generated GObject type stubs for editor support only.

## Running

```sh
ags run ~/.config/ags/app.ts     # launch/reload the shell
```

There is no build/lint/test step for the shell itself. To verify a UI change, run the shell and observe it. `out.css` / `out.css.map` are compiled artifacts from `style.scss` — do not edit them by hand.

Pure-logic modules (no GTK imports) are covered by Node's built-in test runner:

```sh
node --test widget/notifications/rules/*.test.ts widget/notifications/history/*.test.ts widget/notifications/cleanup/*.test.ts widget/notifications/settings/*.test.ts widget/services/spotify/*.test.ts
```

Run the full suite or a single file. Tests live alongside their implementation files (e.g. `engine.ts` / `engine.compile.test.ts`).

## Architecture

`app.ts` is the entry point. Inside `app.start({ css, main })`, every top-level window is instantiated **once per monitor** via `app.get_monitors().map(Component)` (Bar uses `.flatMap`). Adding a new top-level window means importing it in `app.ts` and adding a `.map(...)` line. `CalendarPanel` is wrapped in try/catch as the pattern for windows that may fail to construct.

### State and reactivity

- Reactive state comes from `createState` in the `ags` module: `const [value, setValue] = createState(initial)`.
- Read current value with `.get()`, react with `.subscribe(cb)`.
- In JSX props, bind by passing a transform: `prop={state((v) => derived)}`.
- **`widget/state.tsx` is the global state hub.** It exports panel-visibility states and the composite `anyPanelVisible`, plus orchestration helpers like `closeAllPanels`, `openQuickSettings`, `openPowerMenu`. Panels are **mutually exclusive**: opening one calls `closeAllPanels()` first.
- The auto-hide `Bar` stays visible whenever `anyPanelVisible` is true. **If you add a new panel, add its visibility state to the `panelStates` array in `state.tsx`** — that single registration propagates to both `anyPanelVisible` and any subscriber. Also add a `close*()` call inside `closeAllPanels`. This is the single most common integration mistake.
- `panelAutoClose(close, graceMs?)` in `state.tsx` returns `{ onEnter, onLeave }` handlers for a `Gtk.EventControllerMotion` child — centralizes the mouse-leave-then-close pattern all bar panels share.
- `openBarMenu()` / `closeBarMenu()` in `state.tsx` are ref-counted; use them for tray context menus and popovers so the bar stays visible while any menu is open.

### Modules / hardware access

System services are GObject libraries imported as `gi://Astal*` (e.g. `AstalWp` audio, `AstalHyprland`, `AstalNetwork`, `AstalBluetooth`, `AstalMpris`, `AstalNotifd`, `AstalBattery`, `AstalTray`). Shelling out uses `ags/process`. Low-level GLib/Gio via `gi://GLib`, `gi://Gio`.

### JSX / GTK4 idioms

- Widgets and JSX runtime come from `ags/gtk4`; `app` from `ags/gtk4/app`.
- Event controllers are written as JSX children, not props: `<Gtk.EventControllerMotion onEnter={...} />`.
- Top-level panels are Layer Shell windows (e.g. Orion uses OVERLAY layer, anchored BOTTOM|LEFT|RIGHT, EXCLUSIVE keymode).

### Styling

Single global stylesheet `style.scss` (large, ~67KB), imported in `app.ts`. Dark catppuccin-inspired theme. Class-name prefixes scope features: `.nb-*`/`.np-*`/`.notif-*`/`.ns-*` for notifications, etc. Some self-contained widgets keep their own scss (`widget/orion/orion.scss`, `widget/WorkspaceOverview/style.scss`). UI uses JetBrainsMono Nerd Font glyphs throughout for icons.

Palette: `#08080c` bar bg; `#cba6f7` violet, `#89b4fa` blue, `#f38ba8` red, `#fab387` orange, `#f9e2af` yellow, `#a6e3a1` green, `#94e2d5` teal.

## Feature areas

- `widget/Bar.tsx` + `widget/bar/*` — the auto-hide bar and its modules (workspaces, clock, battery, tray, media, CPU/RAM, network, notification button, power, etc.).
- `widget/QuickSettings.tsx` — large control panel (Wi-Fi, Bluetooth, audio, display).
- `widget/notifications/` — notification daemon integration. `store.ts` holds panel-visibility state; `NotificationPopup` (transient) and `NotificationPanel` (history) are separate windows. `settings/SettingsWindow.tsx` is the in-shell settings UI. Sub-packages: `rules/` (pure rule engine — match, dedup, template, validate, tested by Node), `history/` (persistence logic, tested), `cleanup/` (rule-driven background cleanup engine, tested). `ingest.ts` is the single ingestion point that runs rules on every incoming notification.
- `widget/orion/` — **the "Jarvis" launcher** (the user calls it "jarvis"; the code dir is `orion`). Bottom-slide panel with tabs, search, and sections. Toggle: `SUPER+ALT+Space`. `state.ts` holds its `SectionId` union and reactive state; `components/sections/` holds each section; `search/` is the fuzzy-search engine; `services/GitService.ts` backs the Git section; `ProfileManager.ts` persists sessions.
- `widget/calendar/` + `CalendarPanel.tsx` — calendar/agenda with event editing.
- `widget/WorkspaceOverview/` — workspace overview grid.
- OSDs: `OSD.tsx`, `MicOSD.tsx`, `PixelVolumeOSD.tsx`, `PixelMicOSD.tsx` — volume/brightness/mic overlays (the `Pixel*` variants are alternate styles). Auto-dismiss via timers stored in `state.tsx`.
- `widget/SettingsPanel.tsx` — general settings window opened from the QuickSettings gear (`settingsPanelVisible` in `state.tsx`). Same full-screen backdrop pattern as the notification settings window, but nav is a vertical list on the left. Three sections: `widget/power/EnergySection.tsx` ("Energía"), `widget/notifications/settings/SettingsTabs.tsx` (reused as-is, "Notificaciones"), and `widget/settings/PersonalizationSection.tsx` ("Personalización"). Don't confuse this with `widget/bar/PowerOptions.tsx` / `PowerButton.tsx`, which is the unrelated shutdown/reboot/logout bar menu.
- `widget/power/powerState.ts` — derives a "power-save" flag from the real battery level via `AstalBattery` (Hyprland has no power-save signal to hook). Config lives outside the ags config tree, at `~/.config/power-save/config.json`. Exposes `powerSaveActive` plus opt-in flags (`suspendNotifFilters`, `pauseWsPreviewInPowerSave`) other subsystems read to pause battery-consuming background work.
- `widget/settings/preferences.ts` — shell-wide user preferences (currently: workspace-preview toggle) that persist to `config/preferences.json`, unlike the RAM-only state in `widget/bar/functions/state.ts`. Add a new preference by adding a `createState`, reading it in `load()`, writing it in `save()`, and exposing a setter that calls `save()`.
- `widget/services/spotify/` — `SpotifyService.ts` talks to the Spotify Web API; `parse.ts` is the pure parsing logic (tested). Credentials (client id/secret/refresh token) live in plaintext at `config/spotify-creds.json` (chmod 600, git-ignored), set up once via `scripts/spotify-auth.sh` (interactive OAuth flow, not run automatically). This deliberately replaced an earlier Secret Service / KWallet setup that prompted for a wallet password on every boot under Hyprland.

## User-editable config

Runtime JSON lives in `config/` (`notifications.json`, `display.json`, `audioPresets.json`, `app_icons.json`, `system_state.json`) and, for Orion, in `~/.config/jarvis/git-repos.json`. Orion profiles persist to `~/.local/share/jarvis/profiles/`. These are data, not code — written/read at runtime by the relevant widgets.

`config/spotify-creds.json` also lives here but is a **secret** (plaintext Spotify client id/secret/refresh token, chmod 600) — it is git-ignored (see `.gitignore`) and must never be committed or copied into the repo.
