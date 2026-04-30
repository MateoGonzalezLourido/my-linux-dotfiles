#!/bin/bash
THRESHOLD=40  # píxeles desde el borde superior para mostrar
HIDDEN=0

while true; do
    Y=$(hyprctl cursorpos | awk '{print $2}' | tr -d ',')
    if [ "$Y" -le "$THRESHOLD" ] 2>/dev/null && [ "$HIDDEN" = "1" ]; then
        pkill -SIGUSR1 waybar
        HIDDEN=0
    elif [ "$Y" -gt "$THRESHOLD" ] 2>/dev/null && [ "$HIDDEN" = "0" ]; then
        pkill -SIGUSR1 waybar
        HIDDEN=1
    fi
    sleep 0.3
done
