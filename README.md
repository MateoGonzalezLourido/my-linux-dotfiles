# my-linux-dotfiles

Personal dotfiles for a full Arch Linux / CachyOS desktop (It may work without problems on other OS), managed as a **bare git repo**
(`~/.dotfiles`) whose work-tree is `$HOME` — every file in this repository lives at its real,
final path in the home directory. No stow, no copying: `git --git-dir=~/.dotfiles
--work-tree=~ checkout` puts everything exactly where it belongs.

The centerpiece is **[GiGiOS](GiGiOS/)** — a complete Hyprland/Wayland desktop rice (custom AGS
shell, a Lua-native Hyprland config, and a suite of background daemons for security, power and USB
safety). Everything else in this repo is the shell/terminal/tooling layer it runs on top of.
---

## 📦 Quick install (Arch Linux / CachyOS)

One command bootstraps the whole machine — packages, this repo checked out into `$HOME`, every
symlink GiGiOS needs, and the `/etc` fragments that require root:

```sh
curl -fsSL https://raw.githubusercontent.com/mglourido/my-linux-dotfiles/main/GiGiOS/install.sh | bash
```

The same command **updates** an already-installed machine (fetches, fast-forwards, re-verifies
symlinks). See **[GiGiOS/README.md](GiGiOS/README.md)** for what gets installed, override
variables (`KITTY_PROFILE`, `FIREFOX_PROFILE`, `INSTALL_PACKAGES`, `DOTFILES_BRANCH`), and a
detailed feature tour of the desktop itself; **[GiGiOS/docs/SETUP.md](GiGiOS/docs/SETUP.md)** for
the full step-by-step + troubleshooting.
Collision files are automatically backed up.

## 🗂️ What's in here (updated 31/08/2026)

`.config/` here holds only the pieces that are **plain dotfiles** (shell, terminal, Firefox,
fastfetch, MangoHud) — everything Hyprland/AGS-related lives under `GiGiOS/` and is symlinked into
`~/.config` by `GiGiOS/bin/link.sh` instead, since it needs more than a straight checkout (profile
selection, machine-local JSON state, `/etc` fragments). See
[`GiGiOS/docs/anadir-perfiles-por-equipo.md`](GiGiOS/docs/anadir-perfiles-por-equipo.md) for why
per-machine variants (Kitty, Firefox) are handled that way instead of just branching the repo.

## 🐚 Shell & terminal

- **zsh** (`.config/zsh/`) is the daily driver: Powerlevel10k prompt, fzf/eza/bat/duf wrappers,
  history-substring-search, syntax highlighting, autosuggestions, plus a small
  `functions/fish-parity.zsh` that ports over a few fish conveniences.
- **fish** (`.config/fish/`) is CachyOS's default shell and kept in parity for anyone who ends up
  there instead — same directory-jump helpers (`ffcd`/`ffch`/`ffe`/`ffec`), same history bindings.
- **Kitty** auto-selects a low-power or a responsive profile depending on whether the machine has
  a battery (laptop vs. desktop) — see the GiGiOS README for the detection mechanism, shared with
  Firefox's per-machine profile selector.

## 🔒 Repo-wide security: the pre-push hook

Dotfiles repos are an easy place for a stray binary, installer or macro-laden document to slip in
— by accident or from a compromised download. This repo ships a `.githooks/pre-push` hook (wired
in automatically by `GiGiOS/bin/link.sh` via `core.hooksPath`, so there's no manual setup step) that
runs `bin/verify-files.sh` on every `git ls-files` before a push:

- Checks every tracked file's **real type by magic bytes** (`file -b`), not by extension — a
  `.gitignore` filtering `*.exe`/`*.zip`/etc. only stops someone who didn't bother renaming the
  file; this catches an executable renamed to `.txt` too.
- If `clamscan` (ClamAV) is available, also runs a real signature scan. A genuine detection (rc 1)
  blocks the push; any other non-zero exit (missing signature DB, etc.) just warns — a half-set-up
  scanner isn't grounds to block every push.
- Legitimate files that get flagged can be force-added (`git add -f`) — the hook will keep warning
  about them on future pushes on purpose (it only looks at content, not at whether it's already
  tracked). Full detail and manual usage: [`DEVELOPMENT.md`](DEVELOPMENT.md).

## ✅ Continuous integration

Every push/PR runs (`.github/workflows/gigios-validate.yml`):

- `GiGiOS/bin/preflight.sh` — validates files, scripts, required commands and symlink targets.
- The pure-TypeScript test suite under `GiGiOS/ags/widget/**/*.test.ts` (Node's built-in test
  runner — no AGS/Hyprland runtime needed to run these).

## 📖 More documentation

- **[`GiGiOS/README.md`](GiGiOS/README.md)** — the desktop itself: features, installation,
  performance numbers.
- **[`GiGiOS/docs/SETUP.md`](GiGiOS/docs/SETUP.md)** — full install walkthrough + troubleshooting.
- **[`GiGiOS/CLAUDE.md`](GiGiOS/CLAUDE.md)** and **[`GiGiOS/ags/CLAUDE.md`](GiGiOS/ags/CLAUDE.md)**
  — the deep architectural notes: not just *what* things do, but *why* they're built that way.
- **[`DEVELOPMENT.md`](DEVELOPMENT.md)** — repo-maintenance notes (this hook, mainly).
