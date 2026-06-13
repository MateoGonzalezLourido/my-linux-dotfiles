#!/usr/bin/env bash
# Battery monitor daemon — sends notifications at critical discharge levels
# and when fully charged.

BATTERY=/sys/class/power_supply/BAT0
POLL_INTERVAL=30
THRESHOLDS=(15 10 8 6 4 2 1)

declare -A notified
declare -A notified_charging
charged_notified=false
prev_status=""
prev_capacity=0

# [A] Read every sysfs value once per tick with bash built-in redirects —
#     no subprocess forks; get_capacity and get_time_label use these globals.
read_battery() {
    read -r energy_now  < "$BATTERY/energy_now"  2>/dev/null || energy_now=0
    read -r energy_full < "$BATTERY/energy_full" 2>/dev/null || energy_full=1
    read -r power_now   < "$BATTERY/power_now"   2>/dev/null || power_now=0
    read -r status      < "$BATTERY/status"      2>/dev/null || status=Unknown
}

# Ceiling-rounded percentage using globals from read_battery, matching AGS.
get_capacity() {
    if (( energy_full <= 0 )); then
        local _cap
        read -r _cap < "$BATTERY/capacity" 2>/dev/null || _cap=0
        echo "$_cap"; return
    fi
    echo $(( (energy_now * 100 + energy_full - 1) / energy_full ))
}

# Human-readable time estimate using globals from read_battery (no I/O).
get_time_label() {
    (( power_now == 0 )) && { echo "tiempo desconocido"; return; }
    local delta seconds h m
    if [[ "$1" == "Discharging" ]]; then
        delta=$energy_now
    else
        delta=$(( energy_full - energy_now ))
    fi
    seconds=$(( delta * 3600 / power_now ))
    h=$(( seconds / 3600 ))
    m=$(( (seconds % 3600) / 60 ))
    (( h > 0 )) && echo "${h}h ${m}min" || echo "${m}min"
}

# [C] Sets globals $urgency and $icon for the given threshold level.
threshold_urgency() {
    if (( $1 <= 8 )); then
        urgency=critical; icon=battery-empty
    else
        urgency=normal;   icon=battery-caution
    fi
}

send_notif() {
    local urgency=$1 icon=$2 title=$3 body=$4
    notify-send \
        --app-name="Batería" \
        --urgency="$urgency" \
        --icon="$icon" \
        --expire-time=12000 \
        "$title" "$body"
}

while true; do
    read_battery
    capacity=$(get_capacity)

    # ── Status transitions ────────────────────────────────────────────────────
    # [E] Treating prev_status="" as a valid prior state lets the first-boot
    #     Discharging reset fall through the same path without a separate elif.
    if [[ "$status" != "$prev_status" ]]; then
        case "$status" in
            Charging)
                [[ -n "$prev_status" ]] && send_notif normal battery-good \
                    "Cargando batería" \
                    "Al ${capacity}% — tiempo para carga completa: ~$(get_time_label Charging)"
                notified_charging=()  # [B]
                ;;
            Discharging)
                [[ -n "$prev_status" ]] && send_notif normal battery-good \
                    "Desconectado de la corriente" \
                    "Al ${capacity}% — tiempo restante: ~$(get_time_label Discharging)"
                notified=()           # [B]
                charged_notified=false
                ;;
        esac
    fi

    # [D] Full-charge check unified — covers both Full status and Charging@100%.
    if [[ "$charged_notified" == false ]] && \
       [[ "$status" == "Full" || ("$status" == "Charging" && "$capacity" -ge 100) ]]; then
        send_notif normal battery-full \
            "Batería al 100% ✓" \
            "Completamente cargada. Puedes desconectar el cargador."
        charged_notified=true
    fi

    # ── Per-status threshold checks ───────────────────────────────────────────
    case "$status" in
        Charging)
            for thr in "${THRESHOLDS[@]}"; do
                if (( prev_capacity > thr && capacity <= thr )) \
                        && [[ -z "${notified_charging[$thr]}" ]]; then
                    notified_charging[$thr]=1
                    threshold_urgency "$thr"  # [C]
                    send_notif "$urgency" "$icon" \
                        "Batería baja mientras carga: ${capacity}%" \
                        "La carga baja incluso estando conectado — revisa el cargador"
                elif (( capacity > thr )); then
                    unset "notified_charging[$thr]"
                fi
            done
            ;;

        Discharging)
            time_left=$(get_time_label Discharging)
            for thr in "${THRESHOLDS[@]}"; do
                if (( capacity <= thr )) && [[ -z "${notified[$thr]}" ]]; then
                    notified[$thr]=1
                    threshold_urgency "$thr"  # [C]
                    send_notif "$urgency" "$icon" \
                        "Batería baja: ${capacity}%" \
                        "Tiempo restante aproximado: ~${time_left}"
                fi
            done
            ;;
    esac

    prev_status=$status
    prev_capacity=$capacity
    sleep "$POLL_INTERVAL"
done
