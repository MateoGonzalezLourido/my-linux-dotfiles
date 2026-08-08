#!/usr/bin/env bash
# Instalador de dotfiles (repo bare) + GiGiOS para Arch Linux/CachyOS.
# Clona el repo, hace checkout en $HOME (respaldando lo que choque) y crea los
# symlinks de GiGiOS. Pensado para una máquina nueva o recuperación.
#
# Uso:
#   curl -sSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/main/GiGiOS/install.sh | bash
#   curl -sSL <url> | DOTFILES_BRANCH=guides bash     # otra rama del repo (no per-equipo: eso va por *_PROFILE)
#   curl -sSL <url> | INSTALL_PACKAGES=0 bash        # sin instalar paquetes
#   curl -sSL <url> | KITTY_PROFILE=desktop bash      # forzar perfil de Kitty
#   curl -sSL <url> | FIREFOX_PROFILE=desktop bash    # forzar perfil de Firefox
#
# Variables:
#   DOTFILES_REPO    URL del repo   (por defecto HTTPS público)
#   DOTFILES_BRANCH  rama a instalar (por defecto: main)
#   INSTALL_PACKAGES 1 instala las dependencias (por defecto); 0 las omite
#   KITTY_PROFILE    auto, laptop o desktop (por defecto: auto)
#   FIREFOX_PROFILE  auto, laptop o desktop (por defecto: auto)
set -euo pipefail

REPO_URL="${DOTFILES_REPO:-https://github.com/MateoGonzalezLourido/my-linux-dotfiles.git}"
BRANCH="${DOTFILES_BRANCH:-main}"
DOTGIT="$HOME/.dotfiles"
BACKUP="$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)"
INSTALL_PACKAGES="${INSTALL_PACKAGES:-1}"
KITTY_PROFILE="${KITTY_PROFILE:-auto}"
FIREFOX_PROFILE="${FIREFOX_PROFILE:-auto}"

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
case "$KITTY_PROFILE" in
  auto|laptop|desktop) ;;
  *) die "KITTY_PROFILE debe ser auto, laptop o desktop; recibido: '$KITTY_PROFILE'." ;;
esac
case "$FIREFOX_PROFILE" in
  auto|laptop|desktop) ;;
  *) die "FIREFOX_PROFILE debe ser auto, laptop o desktop; recibido: '$FIREFOX_PROFILE'." ;;
esac
(( EUID != 0 )) || die "No ejecutes este instalador como root; usa tu usuario normal (sudo se pedirá cuando haga falta)."

install_packages() {
  local official=(
    git curl python xdg-utils shared-mime-info base-devel util-linux polkit
    less man-db wget tar expac hwinfo openbsd-netcat neovim
    # pacman-contrib: da `checkupdates` a updates-monitor.sh (sincroniza su propia BD
    # temporal en vez de leer la del sistema). Sin él el monitor sigue funcionando
    # cayendo a `pacman -Qu`, pero eso exige una BD ya sincronizada por el usuario.
    pacman-contrib
    # Mantén esta pila en paquetes estables. qt6ct + Breeze proporcionan el
    # tema Qt; hyprqt6engine-git no es necesario y fuerza bibliotecas -git.
    hyprland hyprlock hypridle hyprpolkitagent hyprsunset uwsm
    # hyprcursor: Hyprland ya depende de la librería, pero el paso 10 usa el
    # BINARIO hyprcursor-util (mismo paquete) para generar la mitad hyprcursor
    # del tema de puntero. Se pide explícito para que sea una dependencia
    # declarada del instalador y no un efecto colateral de otro paquete.
    hyprcursor
    xdg-desktop-portal-hyprland xdg-desktop-portal-gtk qt6-wayland qt6ct
    gjs gtk4-layer-shell gobject-introspection npm dart-sass
    ttf-meslo-nerd ttf-cascadia-code-nerd noto-fonts-emoji
    rofi rofimoji wtype cliphist wl-clipboard imagemagick brightnessctl ddcutil playerctl
    qalculate-gtk wf-recorder grim slurp jq bc hyprshot btop
    # libcanberra: reproduce el `sound-name` de las notificaciones (alarmas y temporizador del
    # panel de reloj). Sin él la alerta se ve pero no suena, sin error visible.
    libcanberra
    # cava: la FFT de la onda de Spotify de la barra. Sin él la onda no falla, cae a su
    # animación procedimental — así que es una mejora, no un requisito.
    cava
    nm-connection-editor blueman fish
    # kconfig: da kreadconfig6/kwriteconfig6, que usa bin/configurar-dolphin.sh (paso 4
    # de este instalador) y bin/preflight.sh ya exige explícitamente.
    kitty firefox dolphin kservice kconfig breeze ffmpegthumbs kdegraphics-thumbnailers
    ark 7zip unrar elisa filelight gwenview haruna kate kfind kolourpaint
    libreoffice-fresh libreoffice-fresh-es okular partitionmanager simple-scan
    tela-circle-icon-theme-grey
    zsh oh-my-zsh-git zsh-completions zsh-autosuggestions
    zsh-syntax-highlighting zsh-history-substring-search zsh-theme-powerlevel10k
    fzf eza bat duf pkgfile fastfetch
    libpulse pipewire pipewire-audio pipewire-pulse pipewire-alsa wireplumber
    gst-plugin-pipewire libnotify awww upower libgudev
    smartmontools lm_sensors pciutils usbutils udisks2 lsof ntfsprogs dosfstools exfatprogs
    alsa-utils inotify-tools dbus kmod
    networkmanager bluez bluez-utils xdg-user-dirs
    clamav firejail bubblewrap xxhash file cups geoclue gamemode
    mesa-utils lshw github-cli
  )

  [[ "$INSTALL_PACKAGES" == 1 ]] || {
    warn "Dependencias omitidas (INSTALL_PACKAGES=0); se validarán antes de finalizar."
    return
  }
  command -v pacman >/dev/null || die "La instalación automática solo admite Arch/CachyOS (falta pacman). Usá INSTALL_PACKAGES=0 y seguí docs/SETUP.md."
  command -v sudo >/dev/null || die "Falta sudo. Instálalo y concede permisos al usuario antes de continuar."

  # Pacman acepta paquetes -git como proveedores de hyprutils/hyprlang. Si ya
  # están presentes, instalar Hyprland estable puede abrir un diálogo de
  # conflictos o, peor, conservar una mezcla con ABI incompatible. No se
  # desinstalan solos porque una máquina puede usar hyprland-git a propósito.
  local paquete
  local -a pila_hyprland_incompatible=()
  for paquete in hyprland-git hyprqt6engine-git hyprutils-git hyprlang-git; do
    pacman -Qq "$paquete" >/dev/null 2>&1 && pila_hyprland_incompatible+=("$paquete")
  done
  if (( ${#pila_hyprland_incompatible[@]} )); then
    warn "Hay paquetes incompatibles con la pila estable que instala GiGiOS:"
    printf '  - %s\n' "${pila_hyprland_incompatible[@]}" >&2
    die "No modifico esa pila automáticamente. Sigue la recuperación de docs/SETUP.md y repite el instalador."
  fi

  # CachyOS ofrece su perfil Pure de Fish y el actualizador de mirrors. En Arch
  # puro esos paquetes no existen, así que sólo se agregan cuando el repositorio
  # configurado los proporciona. VS Code se instala sólo si ningún paquete ya
  # aporta el comando `code` (por ejemplo visual-studio-code-bin).
  # bibata-cursor-theme vive en chaotic-aur, no en los repos oficiales: va aquí y
  # no en la lista dura porque en un Arch puro haría fallar el `pacman -S` ENTERO
  # y con él el resto de dependencias. Sin él, el paso 10 avisa y el escritorio
  # arranca igual con el puntero de XCursor.
  local optional_official
  for optional_official in cachyos-fish-config cachyos-rate-mirrors bibata-cursor-theme; do
    pacman -Si "$optional_official" >/dev/null 2>&1 && official+=("$optional_official")
  done
  command -v code >/dev/null 2>&1 || official+=(code)
  info "Instalando dependencias de repos oficiales ..."
  run_interactive sudo pacman -S --needed "${official[@]}"

  info "Actualizando el índice local de pkgfile para sugerir paquetes cuando falte un comando ..."
  run_interactive sudo pkgfile --update \
    || warn "No pude actualizar pkgfile; command-not-found funcionará después de ejecutar 'sudo pkgfile --update'."

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

configure_default_shell() {
  local zsh_path current_shell current_user
  zsh_path="$(command -v zsh 2>/dev/null || true)"
  [[ -n "$zsh_path" ]] || die "Zsh no está instalado; no puedo activar la configuración restaurada."
  grep -Fxq "$zsh_path" /etc/shells \
    || die "$zsh_path no figura en /etc/shells; añádelo antes de continuar."

  current_user="$(id -un)"
  current_shell="$(getent passwd "$current_user" | cut -d: -f7)"
  if [[ "$current_shell" == "$zsh_path" ]]; then
    info "Zsh ya es el shell predeterminado de $current_user."
    return
  fi

  info "Estableciendo Zsh como shell predeterminado de $current_user ..."
  run_interactive chsh -s "$zsh_path" \
    || die "No pude cambiar el shell a $zsh_path. Ejecutá: chsh -s '$zsh_path'"
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

# --- 4. Aplicar el perfil ligero de Dolphin ---
DOLPHIN_CONFIGURATOR="$HOME/GiGiOS/bin/configurar-dolphin.sh"
if [ -x "$DOLPHIN_CONFIGURATOR" ]; then
  info "Configurando miniaturas y comportamiento de Dolphin ..."
  "$DOLPHIN_CONFIGURATOR" aplicar \
    || die "No se pudo aplicar el perfil de Dolphin."
else
  die "No encontré $DOLPHIN_CONFIGURATOR. El checkout no contiene el configurador de Dolphin."
fi

# --- 5. Seleccionar el perfil de rendimiento de Kitty ---
KITTY_SELECTOR="$HOME/GiGiOS/bin/kitty-profile.sh"
if [ -x "$KITTY_SELECTOR" ]; then
  info "Seleccionando el perfil de Kitty ($KITTY_PROFILE) ..."
  "$KITTY_SELECTOR" "$KITTY_PROFILE" \
    || die "No se pudo activar el perfil de Kitty '$KITTY_PROFILE'."
else
  die "No encontré $KITTY_SELECTOR. El checkout no contiene el selector de perfiles de Kitty."
fi

# --- 6. Seleccionar y aplicar el perfil de rendimiento de Firefox ---
FIREFOX_SELECTOR="$HOME/GiGiOS/bin/firefox-profile.sh"
if [ -x "$FIREFOX_SELECTOR" ]; then
  info "Seleccionando el perfil de Firefox ($FIREFOX_PROFILE) ..."
  "$FIREFOX_SELECTOR" "$FIREFOX_PROFILE" \
    || die "No se pudo activar el perfil de Firefox '$FIREFOX_PROFILE'."
else
  die "No encontré $FIREFOX_SELECTOR. El checkout no contiene el selector de perfiles de Firefox."
fi

# --- 7. Generar el CSS que importa app.ts ---
SCSS="$HOME/GiGiOS/ags/estilos/style.scss"
CSS="$HOME/GiGiOS/ags/estilos/out.css"
APP_ICONS="$HOME/GiGiOS/ags/config/app_icons.json"

[[ -f "$SCSS" ]] || die "Falta $SCSS. El checkout de GiGiOS está incompleto; vuelve a ejecutar el instalador o comprueba la rama '$BRANCH'."
if [[ ! -s "$APP_ICONS" ]]; then
  warn "Falta $APP_ICONS o está vacío; los workspaces usarán iconos gráficos."
elif command -v jq >/dev/null 2>&1; then
  jq -e 'type == "object" and length > 0 and all(to_entries[]; (.key | type == "string") and (.value | type == "string"))' \
    "$APP_ICONS" >/dev/null \
    || warn "$APP_ICONS no contiene un mapa válido; los workspaces usarán iconos gráficos."
fi
if ! command -v sass >/dev/null 2>&1; then
  die "Falta el comando 'sass'. En Arch/CachyOS instálalo con: sudo pacman -S --needed dart-sass"
fi

info "Compilando el CSS de AGS ..."
if ! sass_error="$(sass --no-source-map "$SCSS" "$CSS" 2>&1)"; then
  printf '\033[1;31m-- Error de Sass --\033[0m\n%s\n' "$sass_error" >&2
  die "Sass no pudo compilar $SCSS. Reprodúcelo con: sass --no-source-map '$SCSS' '$CSS'"
fi

# --- 8. Reconstruir las bases MIME y de aplicaciones de KDE/Dolphin ---
if command -v update-mime-database >/dev/null; then
  info "Reconstruyendo la base MIME del usuario ..."
  update-mime-database "$HOME/.local/share/mime"
else
  warn "No encontré update-mime-database; los tipos MIME propios no estarán disponibles."
fi

if command -v kbuildsycoca6 >/dev/null; then
  info "Reconstruyendo la caché de aplicaciones de KDE 6 ..."
  kbuildsycoca6 --noincremental
elif command -v kbuildsycoca5 >/dev/null; then
  info "Reconstruyendo la caché de aplicaciones de KDE 5 ..."
  kbuildsycoca5 --noincremental
else
  warn "No encontré kbuildsycoca6 ni kbuildsycoca5; el menú 'Abrir con...' podría quedar vacío."
fi

# --- 9. Ficheros de sistema (/etc) ---
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
  # Botón de encendido: se lo cedemos a Hyprland. Sin esto logind lo maneja él
  # (HandlePowerKey=poweroff de fábrica), a nivel de asiento y sin pasar por el
  # compositor, así que el bind se ejecuta pero el apagado de logind lo tapa y la
  # acción elegida en Ajustes > Energía no se nota nunca (fallo mudo).
  if sudo install -Dm644 "$SYSTEM_DIR/logind.conf.d/99-gigios-powerkey.conf" \
       /etc/systemd/logind.conf.d/99-gigios-powerkey.conf; then
    # `reload` y no `restart`: reiniciar logind puede llevarse la sesión por delante.
    sudo systemctl reload systemd-logind \
      || warn "No pude recargar systemd-logind; el botón de encendido usará la acción de logind hasta reiniciar."
  else
    warn "No pude ceder el botón de encendido a Hyprland; seguirá apagando el equipo (ver CLAUDE.md, sección del botón de encendido)."
  fi
  # TLP: perfiles conmutables Normal/Ahorro. Solo si TLP está instalado (en un
  # equipo sin TLP la función queda oculta en Ajustes > Energía). Todo lo que toca
  # root es root-owned: helper en /usr/local/bin, perfiles en /etc/gigios/tlp, y la
  # regla sudoers acotada al comando exacto. NO se toca /etc/tlp.conf aquí: eso lo
  # hace el helper cuando el usuario elige un perfil.
  if command -v tlp >/dev/null 2>&1; then
    sudo install -Dm755 "$SYSTEM_DIR/tlp/gigios-tlp-apply.sh" /usr/local/bin/gigios-tlp-apply \
      && sudo install -Dm644 "$SYSTEM_DIR/tlp/normal.conf" /etc/gigios/tlp/normal.conf \
      && sudo install -Dm644 "$SYSTEM_DIR/tlp/ahorro.conf" /etc/gigios/tlp/ahorro.conf \
      || warn "No pude instalar los perfiles TLP de GiGiOS."
    # La regla sudoers se genera con el usuario real y se valida con visudo ANTES de
    # instalarla: una regla sudoers malformada puede romper sudo en toda la máquina.
    tlp_sudoers_tmp="$(mktemp)"
    sed "s/__GIGIOS_USER__/$(id -un)/" "$SYSTEM_DIR/tlp/sudoers-gigios-tlp" > "$tlp_sudoers_tmp"
    if sudo visudo -cf "$tlp_sudoers_tmp" >/dev/null; then
      sudo install -Dm440 "$tlp_sudoers_tmp" /etc/sudoers.d/gigios-tlp \
        || warn "No pude instalar /etc/sudoers.d/gigios-tlp; el cambio de perfil pedirá contraseña."
    else
      warn "La regla sudoers de TLP no validó; no la instalo. El cambio de perfil pedirá contraseña."
    fi
    rm -f "$tlp_sudoers_tmp"
  else
    info "TLP no está instalado; omito los perfiles conmutables de energía (se activarán al instalar 'tlp')."
  fi
  # ClamAV: botón "Actualizar firmas" de Ajustes > Seguridad > Antivirus. Mismo esquema que TLP
  # (helper root-owned + regla sudoers acotada al comando exacto) porque /var/lib/clamav es de
  # `clamav` y habilitar el servicio de actualización es de root. Sin esto el botón no se pinta;
  # la actualización sigue pudiendo hacerse a mano con `sudo freshclam`.
  if command -v freshclam >/dev/null 2>&1; then
    sudo install -Dm755 "$SYSTEM_DIR/clamav/gigios-clamav-update.sh" /usr/local/bin/gigios-clamav-update \
      || warn "No pude instalar el helper de ClamAV; el botón de firmas no aparecerá en Ajustes."
    clamav_sudoers_tmp="$(mktemp)"
    sed "s/__GIGIOS_USER__/$(id -un)/" "$SYSTEM_DIR/clamav/sudoers-gigios-clamav" > "$clamav_sudoers_tmp"
    if sudo visudo -cf "$clamav_sudoers_tmp" >/dev/null; then
      sudo install -Dm440 "$clamav_sudoers_tmp" /etc/sudoers.d/gigios-clamav \
        || warn "No pude instalar /etc/sudoers.d/gigios-clamav; actualizar firmas pedirá contraseña."
    else
      warn "La regla sudoers de ClamAV no validó; no la instalo. Actualizar firmas pedirá contraseña."
    fi
    rm -f "$clamav_sudoers_tmp"
    # Sin firmas, el escáner de descargas no puede analizar nada; dejarlo automático desde ya.
    sudo systemctl enable --now clamav-freshclam.service >/dev/null 2>&1 \
      || info "No pude habilitar clamav-freshclam.service (¿otro nombre en esta distro?)."
  else
    info "ClamAV no está instalado; omito el helper de firmas (se activará al instalar 'clamav')."
  fi
  # Limpieza de disco: Ajustes > Almacenamiento > Liberar espacio. Tercer helper con el mismo
  # esquema (root-owned + sudoers acotado), y aquí el NOPASSWD es lo que hace posible la
  # AUTOLIMPIEZA desatendida: un diálogo de contraseña que aparece solo, de madrugada, no lo lee
  # nadie. Por eso el helper solo expone verbos cuyo efecto se regenera (caché de pacman, journal,
  # /var/tmp, huérfanos); vaciar la caché entera y borrar instantáneas siguen pidiendo contraseña
  # por pkexec desde su botón. Sin esto, esas limpiezas salen como "falta el ayudante" en la UI y
  # el resto (todo lo que vive bajo $HOME) sigue funcionando.
  sudo install -Dm755 "$SYSTEM_DIR/limpieza/gigios-limpieza.sh" /usr/local/bin/gigios-limpieza \
    || warn "No pude instalar el helper de limpieza; las limpiezas de sistema pedirán instalarlo."
  limpieza_sudoers_tmp="$(mktemp)"
  sed "s/__GIGIOS_USER__/$(id -un)/" "$SYSTEM_DIR/limpieza/sudoers-gigios-limpieza" > "$limpieza_sudoers_tmp"
  if sudo visudo -cf "$limpieza_sudoers_tmp" >/dev/null; then
    sudo install -Dm440 "$limpieza_sudoers_tmp" /etc/sudoers.d/gigios-limpieza \
      || warn "No pude instalar /etc/sudoers.d/gigios-limpieza; la autolimpieza no podrá tocar caché ni journal."
  else
    warn "La regla sudoers de limpieza no validó; no la instalo. La autolimpieza quedará limitada a tu carpeta personal."
  fi
  rm -f "$limpieza_sudoers_tmp"
else
  warn "Omito los ficheros de /etc (falta sudo o $SYSTEM_DIR). Brillo DDC/CI y escrituras a USB quedan sin configurar."
fi

# --- 10. Mitad hyprcursor del tema de puntero ---
# El compositor dibuja su cursor con hyprcursor; XWayland y los toolkits siguen
# con XCursor. Un tema de paquete solo trae la mitad XCursor, y libhyprcursor
# ante un nombre que no encuentra no falla: coge el primer tema con manifest.hl
# que haya, por orden de lectura del directorio. Sin esto, el tema que elija el
# usuario en Ajustes no tendría mitad hyprcursor y el compositor acabaría
# dibujando OTRO tema. Esto le añade esa mitad a $CURSOR_THEME, dejando un único
# nombre válido para las dos variables.
#
# NO se elige el tema aquí: eso es `temaCursor` en ~/.config/gigios/devices.json,
# que escribe el usuario desde Ajustes > Dispositivos > Puntero. Generar el tema
# es preparar el terreno; cambiarle el puntero a alguien que no lo ha pedido, no.
CURSOR_GEN="$HOME/GiGiOS/bin/generar-hyprcursor.sh"
CURSOR_THEME="${CURSOR_THEME:-Bibata-Modern-Ice}"
if [ -x "$CURSOR_GEN" ]; then
  info "Preparando el tema de puntero '$CURSOR_THEME' para hyprcursor ..."
  # No es fatal: sin esto el escritorio arranca igual, solo que con el puntero
  # de XCursor. Un tema que no esté instalado (otra distro, otro nombre) no debe
  # tumbar una instalación por lo demás correcta.
  "$CURSOR_GEN" "$CURSOR_THEME" \
    || warn "No pude generar el tema hyprcursor '$CURSOR_THEME'. Elegí otro con '$CURSOR_GEN --list' y volvé a correrlo."
fi

# --- 11. Verificación y notas finales ---
configure_default_shell

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
  • Secretos: ~/.config/gigios/spotify-creds.json y ~/.config/gigios/google-calendar-creds.json
              NO vienen en el repo (git-ignored). Restaurá tus copias o corré
              ~/GiGiOS/ags/scripts/spotify-auth.sh y ~/GiGiOS/ags/scripts/google-calendar-auth.sh
  • Shell:    Zsh quedó como predeterminado; abrí una terminal nueva para cargarlo.
  • Kitty:    el perfil se eligió según KITTY_PROFILE; cambiá con ~/GiGiOS/bin/kitty-profile.sh.
  • Firefox:  el perfil se eligió según FIREFOX_PROFILE; reiniciá Firefox tras cambiarlo.
  • Push:     el remoto quedó en HTTPS; para pushear, cambialo a SSH:
              dotfiles remote set-url origin git@github.com:MateoGonzalezLourido/my-linux-dotfiles.git
  • Hardware: antes de iniciar Hyprland elegí el perfil GPU; ver docs/SETUP.md.
  • Puntero:  elegí el tema en Ajustes > Dispositivos > Puntero. Sin elegirlo, el
              compositor usa el puntero de XCursor; para añadir soporte hyprcursor
              a otro tema, ~/GiGiOS/bin/generar-hyprcursor.sh --list.
  • Antivirus: las firmas de ClamAV las descarga clamav-freshclam, que quedó habilitado;
              tarda unos minutos la primera vez. Ajustes > Seguridad > Antivirus enseña la
              fecha, permite actualizarlas al momento y apagar la actualización automática.
  • Disco:    Ajustes > Almacenamiento analiza qué ocupa el equipo y cataloga las apps por
              tamaño; "Liberar espacio" limpia y, si lo activás, lo hace solo. La autolimpieza
              nace APAGADA y con todas las casillas sin marcar: nada se borra sin pedirlo.
  • Sistema:  si necesitás sensores, ejecutá 'sudo sensors-detect'.
  • Sesión:   cerrá y abrí sesión; después comprobá con 'ags run ~/.config/ags/app.ts'.
EOF
