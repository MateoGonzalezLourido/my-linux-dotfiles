#!/usr/bin/env bash
# GiGiOS — instalador/mantenedor de symlinks.
# Enlaza las rutas canónicas XDG a los archivos reales dentro de ~/GiGiOS.
# Idempotente. No pierde datos.
#
# Uso:
#   bin/link.sh            crea/repara symlinks; NO pisa dirs/archivos reales
#   bin/link.sh --check    solo reporta estado (exit 0 si todo OK)
#   bin/link.sh --force    respalda lo que estorbe (a $LINK_BACKUP) y enlaza
#
# Variables:
#   GIGIOS       raíz (por defecto ~/GiGiOS)
#   LINK_BACKUP  destino de respaldos en --force (por defecto ~/.dotfiles-backup-<fecha>)
set -euo pipefail

GIGIOS="${GIGIOS:-$HOME/GiGiOS}"
LINK_BACKUP="${LINK_BACKUP:-$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)}"

# "ruta_relativa_en_GiGiOS::ruta_canonica_absoluta"
LINKS=(
  "ags::$HOME/.config/ags"
  "hypr::$HOME/.config/hypr"
  "inicializador::$HOME/.config/inicializador"
  "power-save::$HOME/.config/power-save"
  "state/orion::$HOME/.local/share/orion"
  "wallpapers::$HOME/Wallpapers"
  "assets/face.png::$HOME/.face"
)

# Orígenes que son datos de runtime y arrancan vacíos: se crean si faltan,
# en vez de fallar. Evita tener que versionar un .gitkeep sólo para el symlink.
CREATABLE=(
  "state/orion"
)

mode=link
case "${1:-}" in
  "")       mode=link ;;
  --check)  mode=check ;;
  --force)  mode=force ;;
  *) echo "uso: link.sh [--check|--force]" >&2; exit 2 ;;
esac

backup() {  # respalda $1 preservando su ruta relativa a $HOME
  local dst="$1" rel="${1#"$HOME"/}"
  mkdir -p "$LINK_BACKUP/$(dirname "$rel")"
  mv "$dst" "$LINK_BACKUP/$rel"
  echo "BACKUP $dst -> $LINK_BACKUP/$rel"
}

status=0
for entry in "${LINKS[@]}"; do
  src="$GIGIOS/${entry%%::*}"
  dst="${entry##*::}"

  if [[ ! -e "$src" ]]; then
    if [[ " ${CREATABLE[*]} " == *" ${entry%%::*} "* ]]; then
      mkdir -p "$src"; echo "MKDIR $src (dato de runtime)"
    else
      echo "FALTA origen: $src (esperado para $dst)"; status=1; continue
    fi
  fi

  # ¿ya es el symlink correcto?
  if [[ -L "$dst" && "$(readlink -f "$dst")" == "$(readlink -f "$src")" ]]; then
    echo "OK    $dst"; continue
  fi

  # existe algo en el destino que no es el symlink correcto
  if [[ -e "$dst" || -L "$dst" ]]; then
    if [[ "$mode" == check ]]; then
      echo "DIFIERE $dst (esperado -> $src)"; status=1; continue
    fi
    if [[ -L "$dst" ]]; then
      # symlink equivocado: ln -sfn lo reemplaza sin respaldar
      :
    elif [[ "$mode" == force ]]; then
      backup "$dst"
    else
      echo "AVISO $dst es dir/archivo real; usá --force para respaldarlo y enlazar. No lo toco."
      status=1; continue
    fi
  fi

  if [[ "$mode" == check ]]; then
    echo "FALTA symlink: $dst -> $src"; status=1; continue
  fi

  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
  echo "LINK  $dst -> $src"
done

if [[ "$mode" == force && -d "$LINK_BACKUP" ]]; then
  echo "Respaldos en: $LINK_BACKUP"
fi
exit $status
