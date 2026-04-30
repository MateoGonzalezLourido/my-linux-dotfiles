#!/bin/bash
WALLPAPER_DIR="$HOME/Wallpapers"
WALLPAPER=$(ls "$WALLPAPER_DIR"/*.{jpg,png} 2>/dev/null | shuf -n 1)

sleep 0.5
swww img "$WALLPAPER" \
    --transition-type random \
    --transition-duration 2 \
    --transition-fps 60 \
    --transition-step 90