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
  "cache/power-save::$HOME/.config/power-save"
  "state/orion::$HOME/.local/share/orion"
)

# Orígenes que son datos de runtime y arrancan vacíos: se crean si faltan,
# en vez de fallar. Evita tener que versionar un .gitkeep sólo para el symlink.
CREATABLE=(
  "state/orion"
  "cache/power-save"
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

# ── Foto de perfil ───────────────────────────────────────────────────────────
# Copia única de runtime en el cache XDG (~/.cache/gigios/face.png); la leen tanto
# AGS (QuickSettings) como hyprlock. El master versionado es assets/face.png; el
# cache es desechable y no se versiona. Se copia (no symlink) para desacoplar el
# runtime del repo.
face_src="$GIGIOS/assets/face.png"
face_dst="$HOME/.cache/gigios/face.png"
if [[ ! -e "$face_src" ]]; then
  echo "OPCIONAL $face_src no existe; AGS mostrará iniciales y hyprlock omitirá el avatar"
elif [[ -f "$face_dst" ]] && cmp -s "$face_src" "$face_dst"; then
  echo "OK    $face_dst"
elif [[ "$mode" == check ]]; then
  echo "DIFIERE $face_dst (esperado copia de $face_src)"; status=1
else
  mkdir -p "$(dirname "$face_dst")"
  cp -f "$face_src" "$face_dst"
  echo "COPY  $face_dst <- $face_src"
fi

# ── Migración: ajustes de AGS -> ~/.config/gigios ────────────────────────────
# Antes los JSON de usuario/estado de AGS vivían en ~/.config/ags/config/ (dentro
# del symlink al repo, así que caían versionados). Ahora la UI de AGS escribe en
# ~/.config/gigios/, una carpeta real fuera del repo. Se mueve una sola vez lo que
# quede en la ruta vieja; no se pisa lo ya migrado.
#
# ags/config/ NO desapareció: sigue siendo la carpeta de datos versionados del
# shell (app_icons.json). Solo migran los JSON de usuario, así que KEEP_IN_REPO
# se queda donde está — sin esta lista la migración se lo llevaba a
# ~/.config/gigios/ y AGS dejaba de encontrarlo (workspaces sin iconos).
old_cfg="$HOME/.config/ags/config"
new_cfg="$HOME/.config/gigios"
KEEP_IN_REPO=(app_icons.json)
if [[ "$mode" != check ]]; then
  mkdir -p "$new_cfg"
fi
if [[ -d "$old_cfg" ]]; then
  shopt -s nullglob
  for f in "$old_cfg"/*; do
    name="$(basename "$f")"
    keep=0
    for k in "${KEEP_IN_REPO[@]}"; do
      [[ "$name" == "$k" ]] && keep=1
    done
    if (( keep )); then
      echo "KEEP  $f (dato versionado del repo)"
    elif [[ -e "$new_cfg/$name" ]]; then
      echo "SKIP  $new_cfg/$name (ya migrado)"
    elif [[ "$mode" == check ]]; then
      echo "PENDIENTE migrar $f -> $new_cfg/$name"; status=1
    else
      mv "$f" "$new_cfg/$name"
      echo "MOVE  $f -> $new_cfg/$name"
    fi
  done
  shopt -u nullglob
  if [[ "$mode" != check ]]; then
    rmdir "$old_cfg" 2>/dev/null || true
  fi
fi

# ── Git hooks: verificación de archivos antes de cada push ──────────────────
# core.hooksPath es config local de cada clon (no viaja con el repo), así que
# se re-aplica cada vez que se corre link.sh para que quede activo en toda
# máquina nueva sin un paso manual aparte. Ver .githooks/pre-push y
# bin/verify-files.sh en la raíz del repo.
if [[ "$mode" != check ]]; then
  repo_root="$(git -C "$GIGIOS" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$repo_root" && -d "$repo_root/.githooks" ]]; then
    current="$(git -C "$repo_root" config --local --get core.hooksPath || true)"
    if [[ "$current" != "$repo_root/.githooks" ]]; then
      git -C "$repo_root" config core.hooksPath "$repo_root/.githooks"
      echo "HOOK  core.hooksPath -> $repo_root/.githooks"
    fi
  fi
fi

if [[ "$mode" == force && -d "$LINK_BACKUP" ]]; then
  echo "Respaldos en: $LINK_BACKUP"
fi
exit $status
