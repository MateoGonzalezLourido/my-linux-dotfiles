#!/bin/bash
# ~/.config/waybar/scripts/wifi.sh
# Toggle del panel WiFi — mata si está abierto, abre si no

if pgrep -f "wifi-panel.py" > /dev/null; then
    pkill -f "wifi-panel.py"
else
    python3 ~/.config/waybar/scripts/wifi-panel.py &
fi
