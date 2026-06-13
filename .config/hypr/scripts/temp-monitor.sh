#!/usr/bin/env bash
# Temperature monitor daemon — notifies when CPU or GPU exceed WARN_TEMP,
# and again when they cool back below COOL_TEMP (hysteresis).

POLL_INTERVAL=10
WARN_TEMP=85
COOL_TEMP=80   # must drop below this to re-arm the alert

cpu_alerted=false
gpu_alerted=false

get_cpu_temp() {
    sensors -j coretemp-isa-0000 2>/dev/null \
        | python3 -c "
import sys, json
d = json.load(sys.stdin)
pkg = d.get('coretemp-isa-0000', {}).get('Package id 0', {})
val = pkg.get('temp1_input', 0)
print(int(val))
" 2>/dev/null || echo 0
}

get_gpu_temp() {
    local t
    t=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader 2>/dev/null | tr -d ' ')
    [[ "$t" =~ ^[0-9]+$ ]] && echo "$t" || echo 0
}

send_notif() {
    local urgency=$1 icon=$2 title=$3 body=$4
    notify-send \
        --app-name="Temperatura" \
        --urgency="$urgency" \
        --icon="$icon" \
        --expire-time=15000 \
        "$title" "$body"
}

while true; do
    cpu=$(get_cpu_temp)
    gpu=$(get_gpu_temp)

    # --- CPU ---
    if [ "$cpu" -ge "$WARN_TEMP" ] && [ "$cpu_alerted" = false ]; then
        send_notif critical temperature-hot \
            "CPU sobrecalentada: ${cpu}°C" \
            "La temperatura del procesador supera los ${WARN_TEMP}°C. Revisa el rendimiento o la ventilación."
        cpu_alerted=true
    elif [ "$cpu" -lt "$COOL_TEMP" ] && [ "$cpu_alerted" = true ]; then
        send_notif normal temperature \
            "CPU enfriada: ${cpu}°C" \
            "La temperatura del procesador volvió a niveles normales."
        cpu_alerted=false
    fi

    # --- GPU ---
    if [ "$gpu" -ge "$WARN_TEMP" ] && [ "$gpu_alerted" = false ]; then
        send_notif critical temperature-hot \
            "GPU sobrecalentada: ${gpu}°C" \
            "La temperatura de la GPU supera los ${WARN_TEMP}°C. Revisa la carga gráfica o la ventilación."
        gpu_alerted=true
    elif [ "$gpu" -lt "$COOL_TEMP" ] && [ "$gpu_alerted" = true ]; then
        send_notif normal temperature \
            "GPU enfriada: ${gpu}°C" \
            "La temperatura de la GPU volvió a niveles normales."
        gpu_alerted=false
    fi

    sleep "$POLL_INTERVAL"
done
