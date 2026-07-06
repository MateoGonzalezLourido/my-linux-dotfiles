#!/usr/bin/env bash
# GiGiOS — instalador/mantenedor de symlinks.
# Enlaza las rutas canónicas XDG a los archivos reales dentro de ~/GiGiOS.
# Idempotente. No mueve ni borra datos de usuario: solo gestiona symlinks.
# Uso: bin/link.sh          (crea/repara symlinks)
#      bin/link.sh --check   (solo reporta estado, no modifica)
set -euo pipefail

GIGIOS="${GIGIOS:-$HOME/GiGiOS}"

# "ruta_relativa_en_GiGiOS::ruta_canonica_absoluta"
LINKS=(
  "ags::$HOME/.config/ags"
  "hypr::$HOME/.config/hypr"
  "inicializador::$HOME/.config/inicializador"
  "power-save::$HOME/.config/power-save"
  "jarvis::$HOME/.config/jarvis"
  "state/orion::$HOME/.local/share/orion"
  "wallpapers::$HOME/Wallpapers"
  "assets/face.png::$HOME/.face"
)

check_only=false
[[ "${1:-}" == "--check" ]] && check_only=true

status=0
for entry in "${LINKS[@]}"; do
  src="$GIGIOS/${entry%%::*}"
  dst="${entry##*::}"

  if [[ ! -e "$src" ]]; then
    echo "FALTA origen: $src (esperado para $dst)"; status=1; continue
  fi

  if [[ -L "$dst" && "$(readlink -f "$dst")" == "$(readlink -f "$src")" ]]; then
    echo "OK    $dst -> $src"; continue
  fi

  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "AVISO $dst es dir/archivo real (no symlink). Migralo a $src primero; no lo toco."
    status=1; continue
  fi

  if $check_only; then
    echo "FALTA symlink: $dst -> $src"; status=1; continue
  fi

  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
  echo "LINK  $dst -> $src"
done

exit $status
