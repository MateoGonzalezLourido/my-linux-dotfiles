# Repository Guidelines

## Project Structure & Module Organization

This is an AGS v2/Astal desktop shell for Hyprland/Wayland, written in TypeScript and JSX for GTK4. `app.ts` is the entry point and creates top-level windows per monitor. Most UI code lives in `widget/`: `widget/bar/` contains bar modules, `widget/notifications/` contains notification UI plus pure logic, `widget/orion/` contains the Jarvis/Orion launcher, and `widget/calendar/` contains calendar views. Global state and panel orchestration are in `widget/state.tsx`. Styling is centered in `style.scss`; `out.css` and `out.css.map` are generated artifacts and should not be edited manually. Runtime JSON data lives **outside the repo** in `~/.config/gigios/` (written/read at runtime; `bin/link.sh` migrates any leftovers from the old in-repo `config/` dir). Generated GObject type stubs live in `@girs/` for editor/type support.

## Build, Test, and Development Commands

- `ags run ~/.config/ags/app.ts`: launch or reload the shell locally.
- `node --test widget/notifications/rules/*.test.ts widget/notifications/history/*.test.ts widget/notifications/cleanup/*.test.ts widget/notifications/settings/*.test.ts`: run the notification logic test suite.
- `node --test widget/notifications/rules/engine.evaluate.test.ts`: run a single test file while iterating.

There is no `package.json`, `tsconfig.json`, or project build step in this repository; AGS owns bundling, transpilation, and runtime loading.

## Coding Style & Naming Conventions

Follow the existing TypeScript/TSX style: functional widgets, explicit imports from `ags/gtk4`, `ags/gtk4/app`, and `gi://...` modules, and colocated feature files. Use `createState` for reactive state and add new panel visibility state to `panelStates` plus `closeAllPanels()` in `widget/state.tsx`. Keep feature-specific CSS class prefixes consistent with surrounding code, such as `.notif-*`, `.nb-*`, and `.ns-*`.

GTK CSS dimensions are minimums, not fixed sizes. Children of a horizontal `Gtk.Box` default to `valign=FILL`, so compact buttons can stretch to the tallest sibling and appear unaffected by smaller `min-height` or padding. Set `valign={Gtk.Align.CENTER}` (or the corresponding cross-axis alignment) on compact controls before changing their CSS dimensions.

## Testing Guidelines

Tests use Node's built-in test runner and are colocated with implementation files as `*.test.ts`. Prefer testing pure logic modules without GTK imports. When adding notification rule, history, cleanup, or settings behavior, add or update a focused test next to the relevant module.

## Commit & Pull Request Guidelines

Git history is not available from this checkout, so no repository-specific commit convention can be inferred. Use concise imperative commit messages, for example `Add notification cleanup test`. Pull requests should describe the user-visible change, list tests run, note AGS/manual verification for UI work, and include screenshots or short recordings for visual changes.

## Security & Configuration Tips

Treat the runtime JSON in `~/.config/gigios/` as user data and avoid committing local secrets or machine-specific paths. Keep generated files and editor stubs out of manual edits unless regeneration is the explicit task.
