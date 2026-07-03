#!/bin/bash
ACTION=$1  # "up" o "down"

if [ "$ACTION" = "up" ]; then
  brightnessctl set 5%+
else
  brightnessctl set 5%-
fi

VALUE=$(brightnessctl info | grep -oP '\d+(?=%)')

eww update osd-value=$VALUE
eww update osd-icon="󰃞"
eww update osd-label="Brightness"
eww open osd

# Cierra tras 1.5s (resetea el timer si se llama de nuevo)
pkill -f "sleep 1.5.*osd-close" 2>/dev/null
(sleep 1.5 && eww close osd) &
