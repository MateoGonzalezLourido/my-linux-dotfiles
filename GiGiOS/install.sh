#!/usr/bin/env bash
# Instalador de dotfiles (repo bare) + GiGiOS.
# Clona el repo, hace checkout en $HOME (respaldando lo que choque) y crea los
# symlinks de GiGiOS. Pensado para una máquina nueva o recuperación.
#
# Uso:
#   curl -sSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/laptop/GiGiOS/install.sh | bash
#   DOTFILES_BRANCH=desktop curl -sSL <url> | bash    # otra rama
#
# Variables:
#   DOTFILES_REPO    URL del repo   (por defecto HTTPS público)
#   DOTFILES_BRANCH  rama a instalar (por defecto: laptop)
set -euo pipefail

REPO_URL="${DOTFILES_REPO:-https://github.com/MateoGonzalezLourido/my-linux-dotfiles.git}"
BRANCH="${DOTFILES_BRANCH:-laptop}"
DOTGIT="$HOME/.dotfiles"
BACKUP="$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)"

dotfiles() { git --git-dir="$DOTGIT" --work-tree="$HOME" "$@"; }
info() { printf '\033[1;36m::\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git no está instalado."

# --- 1. Clonar el repo bare (o reutilizar) ---
if [ -d "$DOTGIT" ]; then
  info "Ya existe $DOTGIT; hago fetch en vez de clonar."
else
  info "Clonando $REPO_URL (bare) en $DOTGIT ..."
  git clone --bare "$REPO_URL" "$DOTGIT"
fi

# refspec estándar para tener refs/remotes/origin/* y upstreams correctos
dotfiles config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
dotfiles config status.showUntrackedFiles no
info "Fetch de origin ..."
dotfiles fetch --prune origin

dotfiles rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null \
  || die "La rama '$BRANCH' no existe en origin. Probá DOTFILES_BRANCH=<rama>."

# --- 2. Checkout con backup de conflictos ---
info "Checkout de la rama '$BRANCH' ..."
if ! dotfiles checkout "$BRANCH" 2>/dev/null; then
  warn "Hay archivos existentes que chocan; los respaldo en $BACKUP"
  dotfiles checkout "$BRANCH" 2>&1 \
    | grep -E '^[[:space:]]+[^[:space:]]' \
    | sed 's/^[[:space:]]*//' \
    | while IFS= read -r f; do
        [ -e "$HOME/$f" ] || continue
        mkdir -p "$BACKUP/$(dirname "$f")"
        mv "$HOME/$f" "$BACKUP/$f"
        echo "  backup: $f"
      done
  dotfiles checkout "$BRANCH" || die "El checkout siguió fallando; revisá $BACKUP."
fi
dotfiles branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null 2>&1 || true
info "Dotfiles en su lugar (rama $BRANCH)."

# --- 3. Symlinks de GiGiOS (respaldando lo que estorbe) ---
LINK="$HOME/GiGiOS/bin/link.sh"
if [ -x "$LINK" ]; then
  info "Creando symlinks de GiGiOS ..."
  LINK_BACKUP="$BACKUP" bash "$LINK" --force || warn "link.sh reportó incidencias (ver arriba)."
else
  warn "No encontré $LINK. ¿El checkout trajo GiGiOS/bin/link.sh?"
fi

# --- 4. Notas finales ---
echo
info "Instalación completa."
echo "  • Rama:     $BRANCH"
[ -d "$BACKUP" ] && echo "  • Backups:  $BACKUP"
cat <<'EOF'
  • Secreto:  ~/.config/gigios/spotify-creds.json NO viene en el repo (git-ignored).
              Restaurá tu copia o corré  ~/GiGiOS/ags/scripts/spotify-auth.sh
  • Shell:    abrí una terminal nueva para tener el alias 'dotfiles'.
  • Push:     el remoto quedó en HTTPS; para pushear, cambialo a SSH:
              dotfiles remote set-url origin git@github.com:MateoGonzalezLourido/my-linux-dotfiles.git
  • Sesión:   en Hyprland → 'hyprctl reload' y relanzá ags para aplicar todo.
EOF
