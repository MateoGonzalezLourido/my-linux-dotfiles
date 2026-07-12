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

Single global stylesheet `style.scss` (large, ~90KB). **`app.ts` imports `./out.css`, not the SCSS** — AGS does *not* compile SCSS at runtime, so editing `style.scss` has no visible effect until you regenerate the artifact: `sass style.scss out.css` from `ags/` (rewrites `out.css` + `out.css.map`). Dark catppuccin-inspired theme. Class-name prefixes scope features: `.nb-*`/`.np-*`/`.notif-*`/`.ns-*` for notifications, etc. Some self-contained widgets keep their own scss (`widget/orion/orion.scss`, `widget/WorkspaceOverview/style.scss`). UI uses JetBrainsMono Nerd Font glyphs throughout for icons.

Palette: `#08080c` bar bg; `#cba6f7` violet, `#89b4fa` blue, `#f38ba8` red, `#fab387` orange, `#f9e2af` yellow, `#a6e3a1` green, `#94e2d5` teal.

## Feature areas

- `widget/Bar.tsx` + `widget/bar/*` — the auto-hide bar and its modules (workspaces, clock, battery, tray, media, CPU/RAM, network, notification button, power, etc.). Auto-hide itself is a preference (`barAutoHideEnabled`, default on): when it's off every hide path short-circuits, `showNow()` drops the bar back down, and the window flips from `Exclusivity.NORMAL` to `EXCLUSIVE` so Hyprland reserves its 38px instead of letting a permanently-visible bar cover the top of every window. Applied hot — no reload. **That exclusive zone also moves every other top-anchored surface**: wlroots pushes any layer surface whose own exclusivity is `NORMAL` (QuickSettings, notification panel/popups, functions menu, both OSDs — including OVERLAY ones) below the reserved 38px, so their hand-rolled `marginTop` would stack on top of it and leave a double gap. They all go through `barTopMargin(px)` (`settings/preferences.ts`), which collapses the margin to 0 when auto-hide is off; `NotificationPopup.tsx` does the same imperatively via its `panelOffset()`. Windows with exclusivity `IGNORE` (Orion, calendar, power menu, settings) are unaffected — the compositor never shifts them.
- `widget/QuickSettings.tsx` — large control panel (Wi-Fi, Bluetooth, audio, display).
- `widget/notifications/` — notification daemon integration. `store.ts` holds panel-visibility state; `NotificationPopup` (transient) and `NotificationPanel` (history) are separate windows. `settings/SettingsWindow.tsx` is the in-shell settings UI. Sub-packages: `rules/` (pure rule engine — match, dedup, template, validate, tested by Node), `history/` (persistence logic, tested), `cleanup/` (rule-driven background cleanup engine, tested), `autoDnd/` (auto "No molestar": a single in-shell watcher — `watcher.ts`, started once via `initAutoDnd()` in `app.ts` — that flips `notifd.dontDisturb` while a game runs or a user-configured app is fullscreen; `detect.ts` is the pure predicate, tested). `ingest.ts` is the single ingestion point that runs rules on every incoming notification. **Persistence stays on JSON deliberately** (SQLite was evaluated and rejected: both stores are capped — 200 active / `HISTORY_CAP` 500 — the UI needs them fully in memory anyway, parse+stringify measures ~0.3 ms, and GJS has no SQLite binding, so the only cheap route would be forking the `sqlite3` CLI per write, which costs *more* than the file write). Both stores debounce 1.5 s and then go through `persist.ts` → `saveJsonAsync()`, which writes off the main loop with `replace_contents_bytes_async` (**not** `replace_contents_async` — that one doesn't retain the buffer, so GJS's GC can free it mid-write). The 200 cap is applied **in memory in `ingest.ts`**, not just when serializing: capping only at save time bounded the file but let the in-memory array grow all session; evicted entries get `disposeConditions()`d like the dedup path does.
- `widget/orion/` — **the "Jarvis" launcher** (the user calls it "jarvis"; the code dir is `orion`). Bottom-slide panel with tabs, search, and sections. Toggle: `SUPER+ALT+Space`. `state.ts` holds its `SectionId` union and reactive state; `components/sections/` holds each section; `search/` is the fuzzy-search engine; `services/GitService.ts` backs the Git section; `ProfileManager.ts` persists sessions.
- `widget/calendar/` + `CalendarPanel.tsx` — calendar/agenda with event editing.
- `widget/WorkspaceOverview/` — workspace overview grid.
- OSDs: `OSD.tsx` and `MicOSD.tsx` — volume/brightness and microphone overlays.
- `widget/SettingsPanel.tsx` — general settings window opened from the QuickSettings gear (`settingsPanelVisible` in `state.tsx`). Same full-screen backdrop pattern as the notification settings window, but nav is a vertical list on the left. Sections: `widget/power/EnergySection.tsx` ("Energía"), `widget/settings/SecuritySection.tsx` ("Seguridad"), `widget/notifications/settings/SettingsTabs.tsx` (reused as-is, "Notificaciones"), and `widget/settings/PersonalizationSection.tsx` ("Personalización"), among others. Don't confuse this with `widget/bar/PowerOptions.tsx` / `PowerButton.tsx`, which is the unrelated shutdown/reboot/logout bar menu.
- `widget/power/powerState.ts` — derives a "power-save" flag from the real battery level via `AstalBattery` (Hyprland has no power-save signal to hook). Config lives outside the ags config tree, at `~/.config/power-save/config.json`. Exposes `powerSaveActive` plus opt-in flags (`suspendNotifFilters`, `pauseWsPreviewInPowerSave`) other subsystems read to pause battery-consuming background work.
- `widget/power/gamingState.ts` — **bridges the "is a game running" signal to disk** so shell scripts (bash) can read it. Game detection (`isGame`, `widget/bar/games/detect.ts`) is already used by `GamesIndicator` and auto-DND, but each computes it in AGS memory and nothing persists it. This single watcher (started once from `app.ts` via `initGamingState()`, like `initAutoDnd()`) **reuses `isGame`** with the same event-driven wiring as `GamesIndicator` (`client-added`/`client-removed`/`event=="fullscreen"`, no polling) and writes `~/.config/gigios/runtime-state.json` `{ "gaming": bool }` on change. `hypr/scripts/oom-monitor.sh` reads it to pause the download scan while gaming. Also exports a reactive `isGaming` for potential in-shell consumers.
- `widget/bar/UpdatesButton.tsx` — renders **two independent bar icons** (immediately left of `NotificationButton`, inside `.bar-status-pair`): kernel (Tux, orange) and GPU drivers (green). Each is visible **only when its own category has pending updates** — ordinary package/dependency updates show nothing, by design (they were noise); they appear only as an "Otros: N paquetes" line inside the popover. Icons are glyph-only (no count badge). It owns no polling: `hypr/scripts/updates-monitor.sh` writes `~/.config/gigios/updates.json` and one shared `Gio.FileMonitor` (same pattern as the `bar-toggle` watcher in `state.tsx`) feeds both icons; missing/corrupt file = no updates = hidden. Each icon has its own `Gtk.Popover`, anchored via a `$` ref + `onClicked` — **not** a primary `Gtk.GestureClick`, which `Gtk.Button` swallows — listing its packages' `from → to` plus an "Actualizar" button that runs the distro's `updateCmd` in the first available terminal (kitty → foot → alacritty → wezterm → xterm). `openBarMenu()`/`closeBarMenu()` keep the auto-hide bar up while a popover is open. Gated in `Bar.tsx` by `updatesMonitorEnabled`. **Nerd Font glyphs must be written as real codepoints** — an editor/tool that drops the character leaves an empty string and the icon silently renders as nothing (that is how U+F17C was lost once). See the root `CLAUDE.md` for the script side (distro/GPU/kernel classification, package-DB watch, JSON schema).
- `widget/bar/ScreencastIndicator.tsx` — icono rojo pulsante (glifo `󰑊`, clase CSS `recording`
  compartida con `MicIndicator`) **entre `UpdatesButton` y `NotificationButton`** dentro de
  `.bar-status-pair`, visible solo mientras algo captura la pantalla. Va envuelto en su **propio
  `<box>`**: un `<With>` que se remonta en caliente (aquí lo hace el toggle de Personalización) se
  inserta al **final** de su contenedor, no en su sitio — el icono acababa junto a Power. El box
  fija el hueco. Mismo remedio que ya lleva `CpuRam` ahí al lado; si añades otro widget de barra
  conmutable, hazlo igual. Sin polling ni subprocesos:
  `hypr/scripts/screencast-monitor.sh` escribe `~/.config/gigios/screencast.json` y esto lo
  observa con un `Gio.FileMonitor` (patrón `UpdatesButton`). Tooltip: «Compartiendo pantalla ·
  Discord» / «Grabando pantalla · wf-recorder», una línea por tipo. **Sustituyó a `Recording.tsx`**,
  que hacía `pgrep -x wf-recorder` cada 2 s *por monitor* y no veía los screencasts por portal
  (Discord, OBS, navegador). Gatillado en `Bar.tsx` por `screencastIndicatorEnabled`, cuyo setter
  en `preferences.ts` es **maestro y en caliente**: lanza o mata el script.
- `widget/settings/preferences.ts` — shell-wide user preferences (currently: workspace-preview toggle) that persist to `~/.config/gigios/preferences.json`, unlike the RAM-only state in `widget/bar/functions/state.ts`. Add a new preference by adding a `createState`, reading it in `load()`, writing it in `save()`, and exposing a setter that calls `save()`.
- `widget/settings/securityPrefs.ts` + `widget/settings/SecuritySection.tsx` — "Seguridad" tab of `SettingsPanel.tsx`. One boolean toggle per event type scanned by `hypr/scripts/oom-monitor.sh` (OOM killer, kernel panic, hung tasks, hardware errors, unsigned kernel modules, disk/GPU errors, SMART health, service failures/crash storms, sudo/su/pkexec/polkit, SSH, app crashes, file-integrity watch, download scanner, sandboxed launcher), persisted to its own `~/.config/gigios/security.json` (kept separate from `preferences.json`). **Read-once-at-boot pattern**: the bash monitor reads this file a single time when it starts (same as `batteryMonitor`/`tempMonitor` in `preferences.ts`) — toggling here only takes effect after a reboot or manually restarting the script, which the UI states explicitly. Same add-a-preference recipe as `preferences.ts`: add the key to `SecurityKey` + `SECURITY_ITEMS`, it's then automatically rendered as a toggle row and automatically included in `load()`/`save()`. `SecuritySection.tsx` also renders `SandboxLaunchRow`, a path field + button that shells out to `hypr/scripts/run-untrusted.sh` to launch an arbitrary file through the same scan+contain flow described below. Beyond the boolean event toggles, `securityPrefs.ts` also holds **download-scanner resource prefs** (heterogeneous — 3 pause bools `dlPauseInPowerSave`/`dlPauseOnBattery`/`dlPauseWhileGaming`, default off, + `dlMaxScanGB` number, default 1) persisted in the same `security.json`, rendered in a dedicated `DownloadResourcesSection` subsection (pause switches via the reusable `SwitchRow`, a GB field, and a "🔍 Escanear Descargas ahora" force button → `hypr/scripts/scan-downloads.sh`). **Unlike the event toggles, these are live-read by the bash monitor every sweep** (no reboot).
- `widget/services/spotify/` — `SpotifyService.ts` talks to the Spotify Web API; `parse.ts` is the pure parsing logic (tested). Credentials (client id/secret/refresh token) live in plaintext at `~/.config/gigios/spotify-creds.json` (chmod 600, outside the repo), set up once via `scripts/spotify-auth.sh` (interactive OAuth flow, not run automatically). This deliberately replaced an earlier Secret Service / KWallet setup that prompted for a wallet password on every boot under Hyprland.

## User-editable config

Runtime JSON lives **outside the repo** in `~/.config/gigios/` (`notifications.json`, `display.json`, `audioPresets.json`, `app_icons.json`, `system_state.json`, `preferences.json`, `security.json`, `notif-*.json`, …) and, for Orion, in `~/.config/jarvis/git-repos.json`. Orion profiles persist to `~/.local/share/jarvis/profiles/`. These are data, not code — written/read at runtime by the relevant widgets. `bin/link.sh` migrates any leftovers from the old in-repo `config/` dir to `~/.config/gigios/`.

`security.json` is written by `widget/settings/securityPrefs.ts` and read once at startup by `hypr/scripts/oom-monitor.sh` — see the "Seguridad" bullet above and `hypr/scripts/oom-monitor.sh` itself for the full list of scanned events and the sandboxed-launch flow.

`~/.config/gigios/spotify-creds.json` is a **secret** (plaintext Spotify client id/secret/refresh token, chmod 600) living in that same dir — outside the repo, and must never be committed or copied into it.
