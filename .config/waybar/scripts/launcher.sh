#!/bin/bash
# ~/.config/waybar/scripts/launcher.sh
# Lanza tus scripts personales desde un menú wofi
# Para añadir scripts: agrega entradas al array SCRIPTS abajo

SCRIPTS_DIR="$HOME/.config/waybar/scripts/user"

# Crea el directorio si no existe
mkdir -p "$SCRIPTS_DIR"

# Lista scripts del directorio user/ y los muestra en wofi
CHOICE=$(ls "$SCRIPTS_DIR" 2>/dev/null | wofi \
    --dmenu \
    --prompt "scripts" \
    --width 300 \
    --height 400 \
    --cache-file /dev/null \
    --hide-scroll \
    --no-actions \
    --style "$HOME/.config/wofi/style.css")

if [ -n "$CHOICE" ]; then
    bash "$SCRIPTS_DIR/$CHOICE" &
fi
