#!/usr/bin/env bash
# Comprueba que el checkout contiene todo lo necesario y, opcionalmente, que la
# máquina instalada tiene las herramientas principales.
set -uo pipefail

GIGIOS="${GIGIOS:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
mode="${1:-}"
errors=0
warnings=0

ok() { printf 'OK      %s\n' "$*"; }
fail() { printf 'ERROR   %s\n' "$*" >&2; errors=$((errors + 1)); }
warn() { printf 'AVISO   %s\n' "$*"; warnings=$((warnings + 1)); }

required=(
  install.sh bin/link.sh bin/kitty-profile.sh bin/firefox-profile.sh bin/configurar-dolphin.sh ags/app.ts ags/style.scss ags/out.css
  mimeapps.list menus/applications.menu kdeglobals qt6ct/qt6ct.conf
  mime/packages/text-x-xresources.xml mime/packages/text-x-codigo.xml
  ags/widget/bar/games/evidence.ts ags/widget/bar/games/icon.ts
  ags/widget/bar/workspaceOrder.ts ags/widget/bar/workspaceOrder.test.ts
  ags/widget/bar/workspaceTooltip.ts ags/widget/bar/workspaceTooltip.test.ts
  ags/widget/bluetooth/estadoInicio.ts ags/widget/bluetooth/estadoInicio.test.ts
  ags/widget/bluetooth/tileState.ts ags/widget/bluetooth/tileState.test.ts
  ags/widget/display/brightness.ts
  ags/widget/mediaClient.ts ags/widget/mediaClient.test.ts
  ags/widget/mediaProgress.ts ags/widget/mediaProgress.test.ts
  ags/widget/notifications/DaemonConflictBanner.tsx ags/widget/notifications/daemonCheck.ts
  ags/widget/notifications/rules/engine.style.test.ts ags/widget/settings/ProfileAvatar.tsx
  ags/widget/settings/SecuritySection.tsx ags/widget/settings/securityPrefs.ts
  hypr/hyprland.conf hypr/monitor-settings.conf
  hypr/gpu/laptop-hibrida.conf hypr/gpu/sobremesa-nvidia.conf
  Wallpapers/sunset.jpg
  hypr/scripts/clipboard-history.sh hypr/scripts/limpiar-portapapeles.sh hypr/scripts/miniatura-portapapeles.sh hypr/scripts/scan-file.sh
  hypr/scripts/usb-eject.sh hypr/scripts/usb-repair.sh
  hypr/scripts/run-untrusted.sh hypr/scripts/compact-workspaces.sh
  hypr/scripts/toggle-gaps-borders.sh
  system/modules-load.d/i2c-dev.conf system/udev/99-gigios-usb-writeback.rules
  rofi/config.rasi
)
for path in "${required[@]}"; do
  [[ -f "$GIGIOS/$path" ]] || fail "falta $path"
done

# Todas las rutas activas cargadas por Hyprland deben formar parte del checkout.
while IFS= read -r source; do
  relative="${source#'~/.config/hypr/'}"
  [[ -f "$GIGIOS/hypr/$relative" ]] || fail "source de Hyprland ausente: $relative"
done < <(sed -nE 's/^[[:space:]]*source[[:space:]]*=[[:space:]]*(~\/\.config\/hypr\/[^[:space:]#]+).*/\1/p' "$GIGIOS/hypr/hyprland.conf")

while IFS= read -r reference; do
  case "$reference" in
    '~/.config/hypr/'*) target="$GIGIOS/hypr/${reference#'~/.config/hypr/'}" ;;
    '~/.config/inicializador/'*) target="$GIGIOS/inicializador/${reference#'~/.config/inicializador/'}" ;;
    *) continue ;;
  esac
  [[ -e "$target" ]] || fail "autostart ausente: $reference"
done < <(grep -oE '~/.config/(hypr|inicializador)/[^ ;]+' "$GIGIOS/hypr/autostart.conf" | sort -u)

while IFS= read -r script; do
  bash -n "$script" || fail "sintaxis Bash: ${script#"$GIGIOS"/}"
  [[ -x "$script" ]] || fail "no es ejecutable: ${script#"$GIGIOS"/}"
done < <(find "$GIGIOS/hypr/scripts" "$GIGIOS/ags/scripts" -type f -name '*.sh' -print)
for script in \
  "$GIGIOS/install.sh" "$GIGIOS/bin/link.sh" "$GIGIOS/bin/preflight.sh" \
  "$GIGIOS/bin/kitty-profile.sh" "$GIGIOS/bin/firefox-profile.sh" \
  "$GIGIOS/bin/configurar-dolphin.sh" \
  "$GIGIOS/inicializador/init.sh"; do
  bash -n "$script" || fail "sintaxis Bash: ${script#"$GIGIOS"/}"
  [[ -x "$script" ]] || fail "no es ejecutable: ${script#"$GIGIOS"/}"
done

[[ -s "$GIGIOS/ags/out.css" ]] || fail "ags/out.css falta o está vacío"
app_icons="$GIGIOS/ags/config/app_icons.json"
if [[ ! -s "$app_icons" ]]; then
  warn "sin ags/config/app_icons.json (los workspaces usarán iconos gráficos)"
elif command -v jq >/dev/null 2>&1; then
  jq -e 'type == "object" and length > 0 and all(to_entries[]; (.key | type == "string") and (.value | type == "string"))' \
    "$app_icons" >/dev/null 2>&1 \
    || warn "ags/config/app_icons.json no es un mapa válido (se usarán iconos gráficos)"
fi
if [[ -e "$HOME/.local/share/gigios/face.png" ]]; then
  ok "avatar opcional presente"
else
  warn "sin foto de perfil (se usarán iniciales; se pone en Ajustes > Cuenta)"
fi

if [[ "$mode" == "--installed" ]]; then
  # Formato comando:paquete oficial de Arch. Además de detectar la ausencia, deja un
  # comando de reparación directamente utilizable en Arch/CachyOS.
  commands=(
    hyprctl:hyprland hyprlock:hyprlock hypridle:hypridle hyprsunset:hyprsunset
    uwsm:uwsm sass:dart-sass jq:jq rofi:rofi magick:imagemagick
    cliphist:cliphist wl-copy:wl-clipboard wl-paste:wl-clipboard
    brightnessctl:brightnessctl ddcutil:ddcutil playerctl:playerctl wpctl:wireplumber
    pactl:libpulse pw-metadata:pipewire wf-recorder:wf-recorder grim:grim
    slurp:slurp hyprshot:hyprshot awww:awww awww-daemon:awww
    notify-send:libnotify nmcli:networkmanager
    nm-connection-editor:nm-connection-editor bluetoothctl:bluez-utils
    blueman-manager:blueman bc:bc inotifywait:inotify-tools
    dbus-monitor:dbus busctl:systemd udevadm:systemd rfkill:util-linux flock:util-linux pkexec:polkit
    udisksctl:udisks2 lsof:lsof ntfsfix:ntfsprogs fsck.fat:dosfstools fsck.exfat:exfatprogs
    modprobe:kmod btop:btop kitty:kitty firefox:firefox
    zsh:zsh stty:util-linux fzf:fzf eza:eza bat:bat duf:duf
    pkgfile:pkgfile fastfetch:fastfetch less:less man:man-db whatis:man-db
    wget:wget tar:tar expac:expac hwinfo:hwinfo nc:openbsd-netcat nvim:neovim
    code:code fc-match:fontconfig
    dolphin:dolphin kbuildsycoca6:kservice kwriteconfig6:kconfig qt6ct:qt6ct xdg-open:xdg-utils
    update-mime-database:shared-mime-info
    ark:ark 7z:7zip unrar:unrar elisa:elisa filelight:filelight
    gwenview:gwenview haruna:haruna kate:kate kfind:kfind
    kolourpaint:kolourpaint libreoffice:libreoffice-fresh okular:okular
    partitionmanager:partitionmanager simple-scan:simple-scan
    clamscan:clamav firejail:firejail bwrap:bubblewrap
    xdg-user-dir:xdg-user-dirs
  )
  for entry in "${commands[@]}"; do
    command="${entry%%:*}"
    package="${entry#*:}"
    command -v "$command" >/dev/null 2>&1 \
      || fail "falta '$command' (Arch/CachyOS: sudo pacman -S --needed $package)"
  done
  while IFS='|' read -r mime application; do
    grep -Fqx "$mime=$application;" "$GIGIOS/mimeapps.list" \
      || fail "asociación MIME ausente: $mime -> $application"
  done <<'EOF'
inode/directory|org.kde.dolphin.desktop
application/pdf|firefox.desktop
application/epub+zip|okularApplication_epub.desktop
image/png|org.kde.gwenview.desktop
video/mp4|org.kde.haruna.desktop
audio/mpeg|org.kde.elisa.desktop
text/plain|org.kde.kate.desktop
text/markdown|obsidian.desktop;org.kde.kate.desktop
text/x-xresources|org.kde.kate.desktop
text/x-csrc|code.desktop
text/x-configuration|code.desktop
text/x-typescript-jsx|code.desktop
application/x-executable|code.desktop
application/octet-stream|org.kde.kate.desktop
application/zip|org.kde.ark.desktop
application/vnd.openxmlformats-officedocument.wordprocessingml.document|libreoffice-writer.desktop
EOF
  grep -Fqx 'TerminalApplication=kitty' "$GIGIOS/kdeglobals" \
    || fail "kdeglobals no configura Kitty como terminal"
  grep -Fqx 'ColorScheme=BreezeDark' "$GIGIOS/kdeglobals" \
    || fail "kdeglobals no configura Breeze Dark como esquema de colores"
  awk '
    /^\[UiSettings\]$/ { en_ajustes=1; next }
    /^\[/ { en_ajustes=0 }
    en_ajustes && /^ColorScheme=BreezeDark$/ { encontrado=1 }
    END { exit !encontrado }
  ' "$GIGIOS/kdeglobals" \
    || fail "kdeglobals no activa Breeze Dark para KColorSchemeManager"
  grep -Fqx 'BackgroundNormal=20,22,24' "$GIGIOS/kdeglobals" \
    || fail "kdeglobals no contiene la paleta materializada de Breeze Dark"
  grep -Fqx 'env = QT_QPA_PLATFORMTHEME,qt6ct' "$GIGIOS/hypr/env.conf" \
    || fail "Hyprland no activa qt6ct como tema de plataforma Qt"
  grep -Fqx 'env = QT_SCALE_FACTOR,0.9' "$GIGIOS/hypr/env.conf" \
    || fail "Hyprland no configura la densidad compacta de las aplicaciones Qt"
  grep -Fqx 'color_scheme_path=/usr/share/qt6ct/colors/darker.conf' "$GIGIOS/qt6ct/qt6ct.conf" \
    || fail "qt6ct no configura la paleta oscura"
  grep -Fqx 'custom_palette=true' "$GIGIOS/qt6ct/qt6ct.conf" \
    || fail "qt6ct no activa la paleta personalizada"
  grep -Fqx 'style=Breeze' "$GIGIOS/qt6ct/qt6ct.conf" \
    || fail "qt6ct no configura el estilo Breeze"
  grep -Fqx 'general="Noto Sans,10,-1,5,50,0,0,0,0,0,Regular"' "$GIGIOS/qt6ct/qt6ct.conf" \
    || fail "qt6ct no configura la fuente general compacta"
  grep -Fqx 'fixed="Noto Sans Mono,10,-1,5,50,0,0,0,0,0,Regular"' "$GIGIOS/qt6ct/qt6ct.conf" \
    || fail "qt6ct no configura la fuente monoespaciada compacta"
  grep -Fqx 'Theme=Tela-circle-grey' "$GIGIOS/kdeglobals" \
    || fail "kdeglobals no configura Tela circle grey como tema de iconos"
  [[ -r /usr/share/color-schemes/BreezeDark.colors ]] \
    || fail "falta Breeze Dark (sudo pacman -S --needed breeze)"
  compgen -G '/usr/lib/qt6/plugins/styles/breeze*.so' >/dev/null \
    || fail "falta el plugin de estilo Breeze para Qt 6 (sudo pacman -S --needed breeze)"
  [[ -r /usr/share/qt6ct/colors/darker.conf ]] \
    || fail "falta la paleta oscura de qt6ct (sudo pacman -S --needed qt6ct)"
  [[ -r /usr/lib/qt6/plugins/platformthemes/libqt6ct.so ]] \
    || fail "falta el plugin de plataforma de qt6ct (sudo pacman -S --needed qt6ct)"
  if pacman -Q hyprland >/dev/null 2>&1 &&
    { pacman -Q hyprutils-git >/dev/null 2>&1 || pacman -Q hyprlang-git >/dev/null 2>&1; }; then
    fail "Hyprland estable está mezclado con bibliotecas -git; restaura hyprutils e hyprlang estables"
  fi
  [[ -r /usr/lib/qt6/plugins/kf6/thumbcreator/ffmpegthumbs.so ]] \
    || fail "falta el miniaturizador de vídeo (sudo pacman -S --needed ffmpegthumbs)"
  [[ -r /usr/lib/qt6/plugins/kf6/thumbcreator/gsthumbnail.so ]] \
    || fail "falta el miniaturizador de PDF (sudo pacman -S --needed kdegraphics-thumbnailers)"
  "$GIGIOS/bin/configurar-dolphin.sh" --check \
    || fail "el perfil ligero de Dolphin no está aplicado"
  if [[ ! -d /usr/share/icons/Tela-circle-grey && ! -d "$HOME/.local/share/icons/Tela-circle-grey" ]]; then
    fail "falta el tema Tela circle grey (sudo pacman -S --needed tela-circle-icon-theme-grey)"
  fi
  command -v ags >/dev/null 2>&1 \
    || fail "falta 'ags' (AUR: paru -S --needed aylurs-gtk-shell-git libastal-meta; también sirve yay)"
  [[ -r /usr/share/oh-my-zsh/oh-my-zsh.sh ]] \
    || fail "falta Oh My Zsh (CachyOS: sudo pacman -S --needed oh-my-zsh-git)"
  [[ -r /usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme ]] \
    || fail "falta Powerlevel10k (sudo pacman -S --needed zsh-theme-powerlevel10k)"
  for plugin in zsh-autosuggestions zsh-syntax-highlighting zsh-history-substring-search; do
    compgen -G "/usr/share/zsh/plugins/$plugin/*.zsh" >/dev/null \
      || fail "falta el plugin $plugin (sudo pacman -S --needed $plugin)"
  done
  for zsh_file in "$HOME/.zshenv" "$HOME/.config/zsh/.zshenv" "$HOME/.config/zsh/.zshrc" "$HOME/.config/zsh/functions/"*.zsh; do
    [[ -f "$zsh_file" ]] || { fail "falta configuración Zsh: $zsh_file"; continue; }
    zsh -n "$zsh_file" || fail "sintaxis Zsh: $zsh_file"
  done
  zsh -ic '
    [[ "$(bindkey -M emacs "^C")" == *fish_clear_commandline* ]] &&
    [[ "$(bindkey -M emacs $'"'"'\e[13;5u'"'"')" == *accept-line* ]] &&
    [[ "$POWERLEVEL9K_DIR_FOREGROUND" == 4 ]] &&
    [[ "$POWERLEVEL9K_PROMPT_CHAR_OK_VIINS_FOREGROUND" == 5 ]] &&
    [[ "$ZSH_HIGHLIGHT_STYLES[default]" == fg=6 ]] &&
    (( ${precmd_functions[(I)_fish_ctrl_c_for_zle]} )) &&
    (( ${preexec_functions[(I)_fish_ctrl_c_for_commands]} ))
  ' >/dev/null 2>&1 || fail "Zsh no cargó los bindings o la paleta de Fish"
  for fish_file in "$HOME/.config/fish/config.fish" "$HOME/.config/fish/functions/"*.fish; do
    [[ -f "$fish_file" ]] || { fail "falta configuración Fish: $fish_file"; continue; }
    fish -n "$fish_file" || fail "sintaxis Fish: $fish_file"
  done
  kitty_dir="${KITTY_CONFIG_DIRECTORY:-${XDG_CONFIG_HOME:-$HOME/.config}/kitty}"
  kitty_config="$kitty_dir/kitty.conf"
  kitty_selector="$kitty_dir/active-profile.conf"
  for kitty_file in \
    "$kitty_config" "$kitty_dir/base.conf" "$kitty_dir/theme.conf" \
    "$kitty_dir/profiles/laptop.conf" "$kitty_dir/profiles/desktop.conf"; do
    [[ -f "$kitty_file" ]] || fail "falta configuración Kitty: $kitty_file"
  done

  kitty_profile=
  kitty_expected=
  if [[ ! -L "$kitty_selector" ]]; then
    fail "falta el selector local de Kitty: $kitty_selector (ejecutá bin/kitty-profile.sh auto)"
  else
    kitty_target="$(readlink -f "$kitty_selector")"
    case "$kitty_target" in
      "$(readlink -f "$kitty_dir/profiles/laptop.conf")")
        kitty_profile=laptop
        kitty_expected='16,5,1,1,0,2000,0'
        ;;
      "$(readlink -f "$kitty_dir/profiles/desktop.conf")")
        kitty_profile=desktop
        kitty_expected='2,0,1,1,0,2000,5'
        ;;
      *) fail "el selector de Kitty apunta a un perfil desconocido: $kitty_target" ;;
    esac
  fi

  validate_kitty_options() {
    local path="$1" expected="$2" label="$3" validate_common="${4:-0}"
    KITTY_VALIDATE_CONFIG="$path" \
      KITTY_EXPECTED_OPTIONS="$expected" \
      KITTY_VALIDATE_COMMON="$validate_common" \
      kitty +runpy '
import os
import sys
from kitty.config import load_config

bad_lines = []
options = load_config(
    os.environ["KITTY_VALIDATE_CONFIG"],
    accumulate_bad_lines=bad_lines,
)
if bad_lines:
    for bad_line in bad_lines:
        print(bad_line, file=sys.stderr)
    raise SystemExit(1)
expected = tuple(int(value) for value in os.environ["KITTY_EXPECTED_OPTIONS"].split(","))
actual = (
    int(options.repaint_delay),
    int(options.input_delay),
    int(options.sync_to_monitor),
    int(options.cursor_trail),
    int(options.cursor_blink_interval[0]),
    int(options.scrollback_lines),
    int(options.scrollback_pager_history_size // (1024 * 1024)),
)
if actual != expected:
    print(f"valores efectivos {actual}; esperados {expected}", file=sys.stderr)
    raise SystemExit(1)
if os.environ["KITTY_VALIDATE_COMMON"] == "1":
    common_ok = (
        options.shell_integration == frozenset({"enabled"})
        and options.allow_remote_control == "no"
        and options.notify_on_cmd_finish.when == "invisible"
        and options.notify_on_cmd_finish.duration == 15.0
        and options.strip_trailing_spaces == "smart"
        and options.scrollback_fill_enlarged_window
        and options.tab_activity_symbol == "● "
    )
    if not common_ok:
        print("las mejoras comunes de Kitty no están activas", file=sys.stderr)
        raise SystemExit(1)
' >/dev/null 2>&1 || fail "Kitty no cargó correctamente $label"
  }

  validate_kitty_options "$kitty_dir/profiles/laptop.conf" '16,5,1,1,0,2000,0' "profiles/laptop.conf"
  validate_kitty_options "$kitty_dir/profiles/desktop.conf" '2,0,1,1,0,2000,5' "profiles/desktop.conf"
  if [[ -n "$kitty_profile" ]]; then
    validate_kitty_options "$kitty_config" "$kitty_expected" "kitty.conf con el perfil $kitty_profile" 1
  fi

  while IFS= read -r kitty_mapping; do
    awk '{$1=$1; print}' "$kitty_config" | grep -Fqx "$kitty_mapping" \
      || fail "falta el atajo de Kitty: $kitty_mapping"
  done <<'EOF'
map ctrl+enter send_text all \e[13;5u
map alt+enter send_text all \e\r
map ctrl+shift+z send_text all \e[122;6u
map ctrl+shift+enter new_window_with_cwd
map ctrl+shift+t new_tab_with_cwd
map ctrl+shift+n new_os_window_with_cwd
map ctrl+alt+z scroll_to_prompt -1
map ctrl+alt+x scroll_to_prompt 1
map ctrl+shift+g show_last_command_output
map ctrl+shift+h show_scrollback
map ctrl+shift+e open_url_with_hints
map ctrl+alt+l clear_terminal last_command active
EOF
  firefox_dir="${FIREFOX_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/firefox}"
  for firefox_file in \
    "$firefox_dir/base.js" \
    "$firefox_dir/profiles/laptop.js" \
    "$firefox_dir/profiles/desktop.js"; do
    [[ -f "$firefox_file" ]] || fail "falta configuración Firefox: $firefox_file"
  done

  while IFS='|' read -r firefox_file firefox_pref firefox_value; do
    grep -Fqx "user_pref(\"$firefox_pref\", $firefox_value);" "$firefox_dir/$firefox_file" \
      || fail "Firefox no tiene $firefox_pref=$firefox_value en $firefox_file"
  done <<'EOF'
profiles/laptop.js|dom.ipc.processCount|4
profiles/laptop.js|dom.ipc.processCount.webIsolated|2
profiles/laptop.js|browser.cache.memory.capacity|65536
profiles/laptop.js|browser.tabs.unloadOnLowMemory|true
profiles/laptop.js|browser.sessionstore.interval|60000
profiles/laptop.js|network.prefetch-next|false
profiles/laptop.js|general.smoothScroll|false
profiles/desktop.js|dom.ipc.processCount|6
profiles/desktop.js|dom.ipc.processCount.webIsolated|3
profiles/desktop.js|browser.cache.memory.capacity|131072
profiles/desktop.js|browser.tabs.unloadOnLowMemory|true
profiles/desktop.js|browser.sessionstore.interval|30000
profiles/desktop.js|network.prefetch-next|true
profiles/desktop.js|general.smoothScroll|true
EOF

  if grep -Eq \
    'user_pref\("(security\.OCSP\.enabled|browser\.safebrowsing\.(malware|phishing)\.enabled|media\.peerconnection\.enabled)",[[:space:]]*(0|false)\);|user_pref\("media\.hardware-video-decoding\.force-enabled",[[:space:]]*true\);' \
    "$firefox_dir/base.js" "$firefox_dir/profiles/"*.js; then
    fail "Firefox contiene una preferencia insegura o una aceleración forzada"
  fi
  while IFS='|' read -r firefox_pref firefox_value; do
    grep -Fqx "user_pref(\"$firefox_pref\", $firefox_value);" "$firefox_dir/base.js" \
      || fail "Firefox no restaura $firefox_pref=$firefox_value en base.js"
  done <<'EOF'
security.OCSP.enabled|1
browser.safebrowsing.malware.enabled|true
browser.safebrowsing.phishing.enabled|true
browser.safebrowsing.downloads.enabled|true
media.peerconnection.enabled|true
reader.parse-on-load.enabled|true
EOF
  "$GIGIOS/bin/firefox-profile.sh" status >/dev/null 2>&1 \
    || fail "el perfil de Firefox no está compuesto o enlazado correctamente"

  font_family="$(fc-match -f '%{family}' 'CaskaydiaCove Nerd Font Mono' 2>/dev/null)"
  [[ "$font_family" == *CaskaydiaCove* || "$font_family" == *Caskaydia\ Cove* ]] \
    || fail "falta CaskaydiaCove Nerd Font (sudo pacman -S --needed ttf-cascadia-code-nerd)"
  current_user="$(id -un)"
  login_shell="$(getent passwd "$current_user" | cut -d: -f7)"
  [[ "$(readlink -f "$login_shell" 2>/dev/null)" == "$(readlink -f "$(command -v zsh)")" ]] \
    || fail "Zsh no es el shell predeterminado de $current_user (actual: $login_shell)"
  if pacman -Si cachyos-fish-config >/dev/null 2>&1; then
    [[ -r /usr/share/cachyos-fish-config/cachyos-config.fish ]] \
      || fail "falta el perfil Fish de CachyOS (sudo pacman -S --needed cachyos-fish-config)"
    command -v cachyos-rate-mirrors >/dev/null 2>&1 \
      || fail "falta cachyos-rate-mirrors para los alias update/mirror"
  fi
  optional_commands=(nvidia-smi gh fd lshw glxinfo sensors smartctl magick)
  for command in "${optional_commands[@]}"; do
    command -v "$command" >/dev/null 2>&1 || warn "comando opcional no disponible: $command"
  done
  [[ -e /usr/share/xdg-desktop-portal/portals/hyprland.portal ]] \
    || fail "falta el portal de Hyprland (xdg-desktop-portal-hyprland)"
  [[ -e /usr/share/xdg-desktop-portal/portals/gtk.portal ]] \
    || fail "falta el portal GTK para selectores de archivos"
  [[ -e /usr/lib/girepository-1.0/GUdev-1.0.typelib ]] \
    || fail "falta el typelib GUdev (libgudev)"
  for namespace in Battery Bluetooth Hyprland Mpris Network Notifd Tray Wp; do
    compgen -G "/usr/lib/girepository-1.0/Astal${namespace}-*.typelib" >/dev/null \
      || fail "falta Astal${namespace} (AUR: paru -S --needed libastal-meta; también sirve yay)"
  done
  if command -v ags >/dev/null 2>&1; then
    bundle="$(mktemp "${TMPDIR:-/tmp}/gigios-ags.XXXXXX")"
    if ags bundle "$GIGIOS/ags/app.ts" "$bundle" >/dev/null 2>&1; then
      ok "AGS resuelve todos los imports"
    else
      fail "AGS no puede empaquetar app.ts; revisa imports y bibliotecas Astal"
    fi
    rm -f "$bundle"
  fi
  "$GIGIOS/bin/link.sh" --check || fail "symlinks incompletos"
fi

if ((errors)); then
  printf '\n%d error(es), %d aviso(s).\n' "$errors" "$warnings" >&2
  exit 1
fi
printf '\nValidación correcta (%d aviso(s)).\n' "$warnings"
