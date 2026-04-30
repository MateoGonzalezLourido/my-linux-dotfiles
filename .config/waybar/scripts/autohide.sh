#!/bin/bash
# ~/.config/waybar/scripts/autohide.sh

THRESHOLD=50
HIDDEN=0

# Ensure waybar is running
pgrep -x waybar > /dev/null || waybar &

while true; do
    # Get cursor Y position
    CURSOR_INFO=$(hyprctl cursorpos 2>/dev/null)
    [[ -z "$CURSOR_INFO" ]] && sleep 1 && continue
    
    Y=$(echo "$CURSOR_INFO" | awk '{print $2}' | tr -d ',')
    
    # Get counts from Hyprland
    CLIENTS_JSON=$(hyprctl clients -j 2>/dev/null)
    [[ -z "$CLIENTS_JSON" ]] && WINDOWS=0 && FLOATING=0 || {
        WINDOWS=$(echo "$CLIENTS_JSON" | jq '. | length')
        FLOATING=$(echo "$CLIENTS_JSON" | jq '[.[] | select(.floating == true)] | length')
    }
    
    SHOULD_SHOW=1
    
    if [ "$Y" -gt "$THRESHOLD" ]; then
        # Mouse is OUT
        if [ "$WINDOWS" -eq 0 ]; then
            SHOULD_SHOW=0
        fi
        
        # Mini window (floating) rule
        if [ "$FLOATING" -gt 0 ]; then
            SHOULD_SHOW=1
        fi
    fi
    
    # Toggle logic
    if [ "$SHOULD_SHOW" -eq 1 ] && [ "$HIDDEN" -eq 1 ]; then
        pkill -SIGUSR1 waybar
        HIDDEN=0
    elif [ "$SHOULD_SHOW" -eq 0 ] && [ "$HIDDEN" -eq 0 ]; then
        pkill -SIGUSR1 waybar
        HIDDEN=1
    fi
    
    sleep 0.2
done


