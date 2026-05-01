#!/bin/bash
# ~/.config/waybar/scripts/autohide.sh

THRESHOLD=50
HIDDEN=0

# Ensure waybar is running
pgrep -x waybar > /dev/null || waybar &

while true; do
    CURSOR_INFO=$(hyprctl cursorpos 2>/dev/null)
    if [[ -z "$CURSOR_INFO" ]]; then
        sleep 1
        continue
    fi
    
    # Extract Y coordinate purely in bash (no awk/tr subshells)
    Y="${CURSOR_INFO#*, }"
    
    SHOULD_SHOW=1
    
    if [ "$Y" -gt "$THRESHOLD" ]; then
        SHOULD_SHOW=0
        
        # Only query clients if we are out of threshold.
        # Use grep instead of jq for massive performance boost.
        if hyprctl clients 2>/dev/null | grep -q "floating: 1"; then
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
    
    sleep 0.3
done


