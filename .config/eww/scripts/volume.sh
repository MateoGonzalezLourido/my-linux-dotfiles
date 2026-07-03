#!/bin/bash
ACTION=$1  # "up", "down" o "mute"

if [ "$ACTION" = "up" ]; then
  wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+
  ICON="󰕾"
elif [ "$ACTION" = "down" ]; then
  wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-
  ICON="󰕾"
elif [ "$ACTION" = "mute" ]; then
  wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle
  ICON="󰝟"
fi

VALUE=$(wpctl get-volume @DEFAULT_AUDIO_SINK@ | awk '{printf "%d", $2 * 100}')
MUTED=$(wpctl get-volume @DEFAULT_AUDIO_SINK@ | grep -c MUTED)

if [ "$MUTED" -gt 0 ]; then
  ICON="󰝟"
  VALUE=0
fi

eww update osd-value=$VALUE
eww update osd-icon="$ICON"
eww update osd-label="Volume"
eww open osd

pkill -f "sleep 1.5.*osd-close" 2>/dev/null
(sleep 1.5 && eww close osd) &
