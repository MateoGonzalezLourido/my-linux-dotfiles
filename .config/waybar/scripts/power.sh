#!/bin/bash
# ~/.config/waybar/scripts/power.sh
# Menú de apagado con wofi

OPTIONS="  lock\n  suspend\n  reboot\n⏻  shutdown\n  logout"

CHOICE=$(echo -e "$OPTIONS" | wofi \
    --dmenu \
    --prompt "" \
    --width 200 \
    --height 280 \
    --cache-file /dev/null \
    --hide-scroll \
    --no-actions)

case "$CHOICE" in
    *lock)      hyprlock ;;
    *suspend)   systemctl suspend ;;
    *reboot)    systemctl reboot ;;
    *shutdown)  systemctl poweroff ;;
    *logout)    hyprctl dispatch exit ;;
esac
