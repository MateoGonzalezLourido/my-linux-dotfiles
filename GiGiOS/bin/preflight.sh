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
if [[ -e "$GIGIOS/assets/face.png" ]]; then
  ok "avatar opcional presente"
else
  warn "sin assets/face.png (se usarán iniciales)"
fi

if [[ "$mode" == "--installed" ]]; then
  commands=(
    hyprctl ags sass jq rofi wofi cliphist wl-copy wl-paste brightnessctl
    playerctl wpctl pactl pw-metadata wf-recorder grim slurp hyprshot awww
    notify-send nmcli nm-connection-editor bluetoothctl blueman-manager
    btop kitty dolphin xdg-open clamscan firejail bwrap xdg-user-dir
  )
  for command in "${commands[@]}"; do
    command -v "$command" >/dev/null 2>&1 || fail "comando obligatorio no disponible: $command"
  done
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
      || fail "falta Astal${namespace} (instala libastal-meta)"
  done
  bundle="$(mktemp "${TMPDIR:-/tmp}/gigios-ags.XXXXXX")"
  if ags bundle "$GIGIOS/ags/app.ts" "$bundle" >/dev/null 2>&1; then
    ok "AGS resuelve todos los imports"
  else
    fail "AGS no puede empaquetar app.ts; revisa imports y bibliotecas Astal"
  fi
  rm -f "$bundle"
  "$GIGIOS/bin/link.sh" --check || fail "symlinks incompletos"
fi

if ((errors)); then
  printf '\n%d error(es), %d aviso(s).\n' "$errors" "$warnings" >&2
  exit 1
fi
printf '\nValidación correcta (%d aviso(s)).\n' "$warnings"
