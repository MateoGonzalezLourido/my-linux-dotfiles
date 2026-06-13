#!/usr/bin/env bash
# RAM monitor daemon — notifies when usage exceeds WARN_PCT,
# and when it drops back below COOL_PCT (hysteresis).

POLL_INTERVAL=15
WARN_PCT=85
COOL_PCT=80

ram_alerted=false

get_ram_usage() {
    read -r total available < <(awk '
        /^MemTotal:/     { total = $2 }
        /^MemAvailable:/ { available = $2 }
        END { print total, available }
    ' /proc/meminfo)
    local used=$(( total - available ))
    echo $(( used * 100 / total ))
}

get_ram_info() {
    awk '
        /^MemTotal:/     { total = $2 }
        /^MemAvailable:/ { available = $2 }
        END {
            used = total - available
            printf "%d GB usados de %d GB\n", used/1024/1024, total/1024/1024
        }
    ' /proc/meminfo
}

send_notif() {
    notify-send \
        --app-name="RAM" \
        --urgency="$1" \
        --icon="$2" \
        --expire-time=15000 \
        "$3" "$4"
}

while true; do
    pct=$(get_ram_usage)

    if [ "$pct" -ge "$WARN_PCT" ] && [ "$ram_alerted" = false ]; then
        info=$(get_ram_info)
        send_notif critical dialog-warning \
            "RAM alta: ${pct}% usado" \
            "${info}. Considera cerrar aplicaciones."
        ram_alerted=true
    elif [ "$pct" -lt "$COOL_PCT" ] && [ "$ram_alerted" = true ]; then
        info=$(get_ram_info)
        send_notif normal dialog-information \
            "RAM normalizada: ${pct}% usado" \
            "${info}."
        ram_alerted=false
    fi

    sleep "$POLL_INTERVAL"
done
