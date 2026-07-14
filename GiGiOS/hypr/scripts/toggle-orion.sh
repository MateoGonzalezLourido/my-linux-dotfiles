#!/usr/bin/env bash

# Orion está activado por defecto para conservar el comportamiento previo si
# todavía no existe preferences.json. Si el usuario lo desactiva, no enviamos
# el toggle a AGS porque, deliberadamente, no habrá una ventana registrada.
prefs="${XDG_CONFIG_HOME:-$HOME/.config}/gigios/preferences.json"

if [[ -f "$prefs" ]]; then
  if command -v jq >/dev/null 2>&1; then
    jq -e '.orion == false' "$prefs" >/dev/null 2>&1 && exit 0
  elif grep -Eq '"orion"[[:space:]]*:[[:space:]]*false' "$prefs"; then
    exit 0
  fi
fi

# Durante una recarga, el script enlazado puede actualizarse antes que la
# instancia de AGS. Conservar el toggle directo como respaldo evita dejar el
# atajo inservible en esa breve ventana.
respuesta="$(ags request toggle-orion 2>/dev/null)" || exec ags toggle orion
[[ "$respuesta" == "ok" ]] || exec ags toggle orion
