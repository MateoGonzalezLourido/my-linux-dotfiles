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
  install.sh bin/link.sh ags/app.ts ags/style.scss ags/out.css
  ags/widget/settings/SecuritySection.tsx ags/widget/settings/securityPrefs.ts
  hypr/hyprland.conf hypr/gpu/laptop-hibrida.conf hypr/gpu/sobremesa-nvidia.conf
  Wallpapers/sunset.jpg
  hypr/scripts/clipboard-history.sh hypr/scripts/scan-file.sh
  hypr/scripts/run-untrusted.sh hypr/scripts/compact-workspaces.sh
  hypr/scripts/toggle-gaps-borders.sh
  rofi/clipboard-solarized.rasi
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
for script in "$GIGIOS/install.sh" "$GIGIOS/bin/link.sh" "$GIGIOS/bin/preflight.sh" "$GIGIOS/inicializador/init.sh"; do
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
if [[ -e "$GIGIOS/assets/face.png" ]]; then
  ok "avatar opcional presente"
else
  warn "sin assets/face.png (se usarán iniciales)"
fi

if [[ "$mode" == "--installed" ]]; then
  # Formato comando:paquete oficial de Arch. Además de detectar la ausencia, deja un
  # comando de reparación directamente utilizable en Arch/CachyOS.
  commands=(
    hyprctl:hyprland hyprlock:hyprlock hypridle:hypridle hyprsunset:hyprsunset
    uwsm:uwsm sass:dart-sass jq:jq rofi:rofi
    cliphist:cliphist wl-copy:wl-clipboard wl-paste:wl-clipboard
    brightnessctl:brightnessctl ddcutil:ddcutil playerctl:playerctl wpctl:wireplumber
    pactl:libpulse pw-metadata:pipewire wf-recorder:wf-recorder grim:grim
    slurp:slurp hyprshot:hyprshot awww:awww awww-daemon:awww
    notify-send:libnotify nmcli:networkmanager
    nm-connection-editor:nm-connection-editor bluetoothctl:bluez-utils
    blueman-manager:blueman bc:bc inotifywait:inotify-tools
    dbus-monitor:dbus rfkill:util-linux pkexec:polkit btop:btop kitty:kitty
    zsh:zsh stty:util-linux fzf:fzf eza:eza bat:bat duf:duf
    pkgfile:pkgfile fastfetch:fastfetch less:less man:man-db whatis:man-db
    wget:wget tar:tar expac:expac hwinfo:hwinfo nc:openbsd-netcat nvim:neovim
    code:code fc-match:fontconfig
    dolphin:dolphin kbuildsycoca6:kservice xdg-open:xdg-utils
    clamscan:clamav firejail:firejail bwrap:bubblewrap
    xdg-user-dir:xdg-user-dirs
  )
  for entry in "${commands[@]}"; do
    command="${entry%%:*}"
    package="${entry#*:}"
    command -v "$command" >/dev/null 2>&1 \
      || fail "falta '$command' (Arch/CachyOS: sudo pacman -S --needed $package)"
  done
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
  kitty +runpy 'from kitty.config import load_config; load_config()' >/dev/null 2>&1 \
    || fail "Kitty no puede cargar ~/.config/kitty/kitty.conf"
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
