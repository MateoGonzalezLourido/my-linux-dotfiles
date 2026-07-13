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

run_interactive() {
  [[ -r /dev/tty ]] \
    || die "Esta operación necesita una terminal interactiva. Descarga install.sh y ejecútalo con bash en vez de usar un pipe."
  "$@" </dev/tty
}

case "$INSTALL_PACKAGES" in
  0|1) ;;
  *) die "INSTALL_PACKAGES debe valer 0 (omitir paquetes) o 1 (instalarlos); recibido: '$INSTALL_PACKAGES'." ;;
esac

install_packages() {
  local official=(
    git curl python xdg-utils base-devel util-linux polkit
    hyprland hyprlock hypridle hyprpolkitagent hyprsunset uwsm
    xdg-desktop-portal-hyprland xdg-desktop-portal-gtk qt6-wayland
    gjs gtk4-layer-shell gobject-introspection npm dart-sass
    ttf-meslo-nerd rofi cliphist wl-clipboard brightnessctl ddcutil playerctl
    qalculate-gtk wf-recorder grim slurp jq bc hyprshot btop
    nm-connection-editor blueman fish kitty dolphin kservice
    libpulse pipewire pipewire-audio pipewire-pulse pipewire-alsa wireplumber
    gst-plugin-pipewire libnotify awww upower libgudev
    smartmontools lm_sensors pciutils usbutils alsa-utils inotify-tools dbus
    networkmanager bluez bluez-utils xdg-user-dirs
    clamav firejail bubblewrap xxhash file cups geoclue
    mesa-utils lshw fd github-cli imagemagick
  )

  [[ "$INSTALL_PACKAGES" == 1 ]] || {
    warn "Dependencias omitidas (INSTALL_PACKAGES=0); se validarán antes de finalizar."
    return
  }
  command -v pacman >/dev/null || die "La instalación automática solo admite Arch/CachyOS (falta pacman). Usá INSTALL_PACKAGES=0 y seguí hypr/SETUP.md."
  command -v sudo >/dev/null || die "Falta sudo. Instálalo y concede permisos al usuario antes de continuar."
  info "Instalando dependencias de repos oficiales ..."
  run_interactive sudo pacman -S --needed "${official[@]}"

  local astal_ready=1 namespace
  command -v ags >/dev/null || astal_ready=0
  for namespace in Battery Bluetooth Hyprland Mpris Network Notifd Tray Wp; do
    compgen -G "/usr/lib/girepository-1.0/Astal${namespace}-*.typelib" >/dev/null \
      || astal_ready=0
  done
  if [[ "$astal_ready" != 1 ]]; then
    if command -v paru >/dev/null; then
      info "Instalando AGS y las bibliotecas Astal desde AUR ..."
      run_interactive paru -S --needed aylurs-gtk-shell-git libastal-meta
    elif command -v yay >/dev/null; then
      info "Instalando AGS y las bibliotecas Astal desde AUR ..."
      run_interactive yay -S --needed aylurs-gtk-shell-git libastal-meta
    else
      die "AGS/Astal requieren AUR. Instalá paru o yay y repetí el instalador; también podés usar INSTALL_PACKAGES=0."
    fi
  fi

  info "Activando los servicios que usa el panel de red y Bluetooth ..."
  sudo systemctl enable --now NetworkManager.service bluetooth.service \
    || warn "No pude activar NetworkManager/Bluetooth ahora; actívalos antes de iniciar Hyprland."
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

# --- 2. Checkout/actualización con backup de conflictos ---
# -B es importante al reutilizar ~/.dotfiles: un checkout normal de una rama
# local existente no la avanza después del fetch y dejaría instalada una versión
# antigua. La copia desplegada debe seguir exactamente origin/$BRANCH.
info "Actualizando el checkout a origin/$BRANCH ..."
if ! dotfiles checkout -B "$BRANCH" "origin/$BRANCH" 2>/dev/null; then
  warn "Hay archivos existentes que chocan; los respaldo en $BACKUP"
  checkout_error="$(dotfiles checkout -B "$BRANCH" "origin/$BRANCH" 2>&1 || true)"
  while IFS= read -r f; do
    [ -e "$HOME/$f" ] || continue
    mkdir -p "$BACKUP/$(dirname "$f")"
    mv "$HOME/$f" "$BACKUP/$f"
    echo "  backup: $f"
  done < <(
    printf '%s\n' "$checkout_error" \
      | grep -E '^[[:space:]]+[^[:space:]]' \
      | sed 's/^[[:space:]]*//'
  )
  dotfiles checkout -B "$BRANCH" "origin/$BRANCH" \
    || die "El checkout siguió fallando; revisá $BACKUP."
fi
dotfiles branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null 2>&1 || true
info "Dotfiles en su lugar (rama $BRANCH)."

# --- 3. Symlinks de GiGiOS (respaldando lo que estorbe) ---
LINK="$HOME/GiGiOS/bin/link.sh"
if [ -x "$LINK" ]; then
  info "Creando symlinks de GiGiOS ..."
  LINK_BACKUP="$BACKUP" bash "$LINK" --force || die "No se pudieron crear todos los enlaces. Revisa los mensajes anteriores."
else
  die "No encontré $LINK. El checkout no contiene GiGiOS/bin/link.sh."
fi

# --- 4. Generar el CSS que importa app.ts ---
SCSS="$HOME/GiGiOS/ags/style.scss"
CSS="$HOME/GiGiOS/ags/out.css"

[[ -f "$SCSS" ]] || die "Falta $SCSS. El checkout de GiGiOS está incompleto; vuelve a ejecutar el instalador o comprueba la rama '$BRANCH'."
if ! command -v sass >/dev/null 2>&1; then
  die "Falta el comando 'sass'. En Arch/CachyOS instálalo con: sudo pacman -S --needed dart-sass"
fi

info "Compilando el CSS de AGS ..."
if ! sass_error="$(sass --no-source-map "$SCSS" "$CSS" 2>&1)"; then
  printf '\033[1;31m-- Error de Sass --\033[0m\n%s\n' "$sass_error" >&2
  die "Sass no pudo compilar $SCSS. Reprodúcelo con: sass --no-source-map '$SCSS' '$CSS'"
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

# --- 6. Ficheros de sistema (/etc) ---
# NO se symlinkean, se copian: udev y systemd leen /etc antes de que $HOME esté montado, y
# apuntar /etc a un directorio escribible por el usuario sería una escalada silenciosa.
# Sin este paso la instalación arranca igual, pero con dos fallos mudos:
#   • sin la regla udev, una copia a un USB "termina" con cientos de MB aún en RAM y retirar
#     el pendrive pierde los datos de verdad (ver CLAUDE.md, sección USB);
#   • sin i2c-dev no existen los nodos /dev/i2c-*, así que ddcutil no ve el monitor y el
#     slider de brillo desaparece en un sobremesa (en un portátil da igual: usa sysfs).
SYSTEM_DIR="$HOME/GiGiOS/system"
if [ -d "$SYSTEM_DIR" ] && command -v sudo >/dev/null; then
  info "Instalando los ficheros de sistema en /etc (pide sudo) ..."
  if sudo install -Dm644 "$SYSTEM_DIR/udev/99-gigios-usb-writeback.rules" \
       /etc/udev/rules.d/99-gigios-usb-writeback.rules; then
    sudo udevadm control --reload-rules \
      || warn "No pude recargar udev; la regla de USB se aplicará al reiniciar."
  else
    warn "No pude instalar la regla udev de USB. Instálala a mano (ver CLAUDE.md, sección USB)."
  fi
  if sudo install -Dm644 "$SYSTEM_DIR/modules-load.d/i2c-dev.conf" \
       /etc/modules-load.d/i2c-dev.conf; then
    # modules-load.d solo actúa en el arranque: cargarlo ahora evita tener que reiniciar
    # para que el brillo por DDC/CI funcione ya en esta sesión.
    sudo modprobe i2c-dev || warn "No pude cargar i2c-dev ahora; se cargará al reiniciar."
  else
    warn "No pude instalar i2c-dev.conf; el brillo por DDC/CI no funcionará hasta hacerlo."
  fi
else
  warn "Omito los ficheros de /etc (falta sudo o $SYSTEM_DIR). Brillo DDC/CI y escrituras a USB quedan sin configurar."
fi

# --- 7. Verificación y notas finales ---
if [ -x "$HOME/GiGiOS/bin/preflight.sh" ]; then
  info "Validando la instalación ..."
  HOME="$HOME" GIGIOS="$HOME/GiGiOS" "$HOME/GiGiOS/bin/preflight.sh" --installed \
    || die "La validación final falló. La instalación no está completa."
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
