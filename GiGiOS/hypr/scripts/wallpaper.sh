#!/bin/bash
# Gestor de wallpaper de GiGiOS. Tres modos:
#   wallpaper.sh            -> arranque: respeta randomOnStart de la config
#   wallpaper.sh --random   -> fuerza uno aleatorio ahora (botón "Aleatorio" de Orion)
#   wallpaper.sh <ruta>     -> aplica ese archivo (clic en una miniatura de Orion)
# En todos los casos, tras aplicar guarda `current` en la config.
#
# Config: ~/.config/gigios/wallpaper.json  ->  { "randomOnStart": bool, "current": path }
#   - randomOnStart: lo escribe AGS (toggle). Ausente/archivo inexistente => true.
#   - current:       lo escribe este script cada vez que aplica un fondo.
# El reparto (bash=current, AGS=randomOnStart) evita que uno pise el campo del otro:
# ambos hacen read-modify-write preservando el otro campo.

WALLPAPER_DIR="$HOME/GiGiOS/Wallpapers"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/gigios/wallpaper.json"

pick_random() {
    ls "$WALLPAPER_DIR"/*.{jpg,jpeg,png,webp} 2>/dev/null | shuf -n 1
}

save_current() {
    local wp="$1"
    command -v jq >/dev/null 2>&1 || return 0
    mkdir -p "$(dirname "$CONFIG")"
    if [[ -f "$CONFIG" ]]; then
        local tmp
        tmp="$(mktemp)"
        if jq --arg c "$wp" '.current = $c' "$CONFIG" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$CONFIG"
        else
            rm -f "$tmp"
        fi
    else
        jq -n --arg c "$wp" '{randomOnStart: true, current: $c}' > "$CONFIG"
    fi
}

apply() {
    local wp="$1"
    [[ -z "$wp" || ! -f "$wp" ]] && return 1
    awww img "$wp" \
        --transition-type random \
        --transition-duration 1 \
        --transition-fps 60 \
        --transition-step 90
    # Rofi usa el mismo fondo que el escritorio, sin duplicar el archivo.
    mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/gigios"
    ln -sfn "$wp" "${XDG_CACHE_HOME:-$HOME/.cache}/gigios/rofi-wallpaper"
    save_current "$wp"
}

read_random_on_start() {
    # OJO: NO usar `.randomOnStart // true`: el operador `//` de jq trata `false`
    # como vacío, así que `false // true` daría `true` y apagar el toggle nunca
    # surtiría efecto. Sólo queremos el default `true` cuando la clave falta/es null.
    if command -v jq >/dev/null 2>&1 && [[ -f "$CONFIG" ]]; then
        jq -r 'if .randomOnStart == false then "false" else "true" end' "$CONFIG" 2>/dev/null
    else
        echo true
    fi
}

read_current() {
    if command -v jq >/dev/null 2>&1 && [[ -f "$CONFIG" ]]; then
        jq -r '.current // ""' "$CONFIG" 2>/dev/null
    fi
}

case "$1" in
    --random)
        apply "$(pick_random)"
        ;;
    "")
        # Modo arranque: espera a que awww-daemon esté listo.
        sleep 0.5
        if [[ "$(read_random_on_start)" == "true" ]]; then
            apply "$(pick_random)"
        else
            current="$(read_current)"
            if [[ -n "$current" && -f "$current" ]]; then
                apply "$current"
            else
                apply "$(pick_random)"   # sin fondo guardado válido => uno al azar
            fi
        fi
        ;;
    *)
        # Ruta específica.
        apply "$1"
        ;;
esac
