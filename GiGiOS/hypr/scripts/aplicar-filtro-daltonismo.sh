#!/usr/bin/env bash
# Aplica una corrección de color global sin sondeo. AGS lo invoca al cambiar el
# ajuste y Hyprland en cada arranque/recarga para restaurar la preferencia.
set -u

config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
preferencias="$config_root/gigios/preferences.json"
directorio_shaders="$config_root/hypr/shaders"
modo="${1:-}"

if [[ -z "$modo" ]]; then
  if [[ -r "$preferencias" ]] && command -v jq >/dev/null 2>&1; then
    modo="$(jq -r '.modoDaltonismo // "ninguno"' "$preferencias" 2>/dev/null)"
  else
    modo="ninguno"
  fi
fi

case "$modo" in
  ninguno)
    exec hyprctl keyword decoration:screen_shader ""
    ;;
  protanopia|deuteranopia|tritanopia)
    shader="$directorio_shaders/daltonismo-$modo.frag"
    [[ -r "$shader" ]] || {
      printf 'No se encuentra el shader de daltonismo: %s\n' "$shader" >&2
      exit 1
    }
    exec hyprctl keyword decoration:screen_shader "$shader"
    ;;
  *)
    printf 'Modo de daltonismo no válido: %s\n' "$modo" >&2
    exit 2
    ;;
esac
