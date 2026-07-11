#!/usr/bin/env bash
# Instalador de dotfiles (repo bare) + GiGiOS para Arch Linux/CachyOS.
# Clona el repo, hace checkout en $HOME (respaldando lo que choque) y crea los
# symlinks de GiGiOS. Pensado para una máquina nueva o recuperación.
#
# Uso:
#   curl -sSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/laptop/GiGiOS/install.sh | bash
#   curl -sSL <url> | DOTFILES_BRANCH=desktop bash    # otra rama
#   curl -sSL <url> | INSTALL_PACKAGES=0 bash        # sin instalar paquetes
#
# Variables:
#   DOTFILES_REPO    URL del repo   (por defecto HTTPS público)
#   DOTFILES_BRANCH  rama a instalar (por defecto: laptop)
#   INSTALL_PACKAGES 1 instala las dependencias (por defecto); 0 las omite
set -euo pipefail

REPO_URL="${DOTFILES_REPO:-https://github.com/MateoGonzalezLourido/my-linux-dotfiles.git}"
BRANCH="${DOTFILES_BRANCH:-laptop}"
DOTGIT="$HOME/.dotfiles"
BACKUP="$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)"
INSTALL_PACKAGES="${INSTALL_PACKAGES:-1}"

dotfiles() { git --git-dir="$DOTGIT" --work-tree="$HOME" "$@"; }
info() { printf '\033[1;36m::\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

install_packages() {
  local official=(
    git curl python xdg-utils hyprland hyprlock hypridle hyprpolkitagent hyprsunset
    gjs gtk4-layer-shell gobject-introspection npm dart-sass
    ttf-meslo-nerd rofi wofi cliphist wl-clipboard brightnessctl playerctl
    qalculate-gtk wf-recorder grim slurp jq bc hyprshot
    network-manager-applet blueman fish kitty dolphin kde-cli-tools
    libpulse pipewire wireplumber libnotify awww
    smartmontools lm_sensors pciutils usbutils alsa-utils inotify-tools dbus
    networkmanager bluez bluez-utils xdg-user-dirs
    clamav firejail bubblewrap xxhash file
  )

  [[ "$INSTALL_PACKAGES" == 1 ]] || { warn "Dependencias omitidas (INSTALL_PACKAGES=$INSTALL_PACKAGES)."; return; }
  command -v pacman >/dev/null || die "La instalación automática solo admite Arch/CachyOS (falta pacman). Usá INSTALL_PACKAGES=0 y seguí hypr/SETUP.md."
  info "Instalando dependencias de repos oficiales ..."
  sudo pacman -S --needed "${official[@]}"

  if ! command -v ags >/dev/null; then
    if command -v paru >/dev/null; then
      info "Instalando AGS y las bibliotecas Astal desde AUR ..."
      paru -S --needed aylurs-gtk-shell-git libastal-meta
    elif command -v yay >/dev/null; then
      info "Instalando AGS y las bibliotecas Astal desde AUR ..."
      yay -S --needed aylurs-gtk-shell-git libastal-meta
    else
      die "AGS requiere AUR. Instalá paru o yay y repetí el instalador; también podés usar INSTALL_PACKAGES=0."
    fi
  fi
}

install_packages
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

# --- 4. Generar el CSS que importa app.ts ---
if command -v sass >/dev/null && [ -f "$HOME/GiGiOS/ags/style.scss" ]; then
  info "Compilando el CSS de AGS ..."
  sass --no-source-map "$HOME/GiGiOS/ags/style.scss" "$HOME/GiGiOS/ags/out.css"
else
  warn "No pude compilar AGS/out.css (falta sass o style.scss)."
fi

# --- 5. Reconstruir la caché de aplicaciones de KDE/Dolphin ---
if command -v kbuildsycoca6 >/dev/null; then
  info "Reconstruyendo la caché de aplicaciones de KDE 6 ..."
  kbuildsycoca6 --noincremental
elif command -v kbuildsycoca5 >/dev/null; then
  info "Reconstruyendo la caché de aplicaciones de KDE 5 ..."
  kbuildsycoca5 --noincremental
else
  warn "No encontré kbuildsycoca6 ni kbuildsycoca5; el menú 'Abrir con...' podría quedar vacío."
fi

# --- 6. Verificación y notas finales ---
if [ -x "$HOME/GiGiOS/bin/preflight.sh" ]; then
  info "Validando la instalación ..."
  HOME="$HOME" GIGIOS="$HOME/GiGiOS" "$HOME/GiGiOS/bin/preflight.sh" --installed \
    || warn "La validación encontró tareas pendientes (ver arriba)."
fi
echo
info "Instalación base completa."
echo "  • Rama:     $BRANCH"
[ -d "$BACKUP" ] && echo "  • Backups:  $BACKUP"
cat <<'EOF'
  • Secreto:  ~/.config/gigios/spotify-creds.json NO viene en el repo (git-ignored).
              Restaurá tu copia o corré  ~/GiGiOS/ags/scripts/spotify-auth.sh
  • Shell:    abrí una terminal nueva para tener el alias 'dotfiles'.
  • Push:     el remoto quedó en HTTPS; para pushear, cambialo a SSH:
              dotfiles remote set-url origin git@github.com:MateoGonzalezLourido/my-linux-dotfiles.git
  • Hardware: antes de iniciar Hyprland elegí el perfil GPU; ver hypr/SETUP.md.
  • Sistema:  ejecutá una vez 'sudo freshclam' y, si necesitás sensores, 'sudo sensors-detect'.
  • Sesión:   cerrá y abrí sesión; después comprobá con 'ags run ~/.config/ags/app.ts'.
EOF
