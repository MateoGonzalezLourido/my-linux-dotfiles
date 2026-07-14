# Repository Guidelines

## Project Structure & Module Organization

GiGiOS is a personal Hyprland/Wayland dotfiles tree. The real files live here and are installed to XDG locations with symlinks. `ags/` contains the AGS v2/Astal desktop shell in TypeScript/TSX; read `ags/AGENTS.md` before changing shell code. `hypr/` contains Hyprland, hyprlock, hypridle, GPU profiles, and monitor scripts. `inicializador/` contains startup state restoration. `Wallpapers/` is used directly by wallpaper scripts. `cache/power-save/` and `state/orion/` are runtime-backed symlink targets. `docs/` stores specs and plans.

## Build, Test, and Development Commands

- `bin/link.sh --check`: verify that XDG symlinks point back to this tree.
- `bin/link.sh`: create or repair symlinks without overwriting real files.
- `bin/link.sh --force`: back up conflicting files, then link them.
- `ags run ~/.config/ags/app.ts`: launch or reload the AGS shell after UI changes.
- `hyprctl reload`: apply Hyprland config changes.
- `node --test ags/widget/**/*.test.ts`: run colocated pure TypeScript tests. If shell globbing does not expand `**`, run the relevant `*.test.ts` files explicitly.

## Coding Style & Naming Conventions

Follow existing TypeScript/TSX style in `ags/`: functional widgets, explicit `ags/gtk4` and `gi://...` imports, and feature-local modules. Keep generated `ags/out.css` and `ags/out.css.map` out of manual edits; change `ags/style.scss` instead. Hyprland files use lowercase descriptive names ending in `.conf`; scripts use lowercase kebab-style names ending in `.sh`.

## Machine Profiles

Before adding or changing per-machine `laptop`/`desktop` settings for any
application, read `docs/anadir-perfiles-por-equipo.md` and follow its shared
layout and selector contract. This also applies when touching the installer,
`bin/preflight.sh`, generated active-profile files, ignore rules, or profile
documentation. Use the existing Kitty and Firefox implementations as the
reference cases; do not introduce a separate profile mechanism without
documenting why the shared pattern cannot support the application.

## Testing Guidelines

Tests use Node's built-in test runner and live beside implementation files as `*.test.ts`. Prefer tests for pure logic without GTK imports, especially notification rules, history, cleanup, settings migrations, display logic, and Spotify parsing. For UI changes, manually verify with `ags run ~/.config/ags/app.ts`.

## Commit & Pull Request Guidelines

This checkout has an empty `.git`; history comes from the bare repo at `~/.dotfiles`. Recent commits are short Spanish summaries, usually imperative or descriptive, such as `añadido gestion de cups en los ajustes`. Keep commits concise and scoped. Pull requests should describe user-visible changes, list commands run, note manual AGS/Hyprland verification, and include screenshots or recordings for visual changes.

## Security & Configuration Tips

Runtime data and secrets live outside the repo in `~/.config/gigios/`, including `spotify-creds.json`; never copy secrets into this tree. Treat machine-specific GPU profiles and user preferences as local configuration unless the change is intentionally shared.
