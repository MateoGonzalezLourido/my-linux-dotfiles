#!/bin/bash
# ~/.config/waybar/scripts/eyecare.sh
# Toggle gamma cálido (reducción luz azul) via wlsunset
# Requiere: wlsunset (pacman -S wlsunset)

STATE_FILE="/tmp/waybar_eyecare_state"

status() {
    if [ -f "$STATE_FILE" ] && pgrep -x wlsunset > /dev/null; then
        echo '{"text": "󰈈 eyecare", "tooltip": "Eyecare ON — click para desactivar", "class": "active"}'
    else
        echo '{"text": "󰛨 eyecare", "tooltip": "Eyecare OFF — click para activar", "class": ""}'
    fi
}

toggle() {
    if pgrep -x wlsunset > /dev/null; then
        pkill wlsunset
        rm -f "$STATE_FILE"
        notify-send "👁 Eyecare" "Desactivado — gamma normal" --expire-time=2000
    else
        # Temperatura cálida: 4500K día, 3500K noche
        wlsunset -T 4500 -t 3500 &
        touch "$STATE_FILE"
        notify-send "👁 Eyecare" "Activado — gamma cálido" --expire-time=2000
    fi
}

case "$1" in
    status) status ;;
    toggle) toggle ;;
    *) status ;;
esac
