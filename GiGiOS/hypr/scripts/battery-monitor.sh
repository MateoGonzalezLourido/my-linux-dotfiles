#!/usr/bin/env bash
# Battery monitor daemon — notifies on charging/discharging transitions,
# on entering power-save mode (mirrors ags' threshold), on low-battery
# steps every 2% from 10% to 0% while discharging, and on reaching 100%
# while charging. No battery/power-save warnings are ever sent while charging.
#
# Perf notes: everything in the hot loop uses bash builtins only (no forks).
# The only external process spawned during steady-state polling is notify-send,
# and only when an actual notification fires. jq (to read the power-save
# threshold) is invoked at most once every THRESHOLD_REFRESH_SECS. The poll
# interval itself is adaptive — it widens whenever nothing time-sensitive is
# happening, to cut down on wakeups (and therefore idle power draw).

BATTERY=/sys/class/power_supply/BAT0
POWER_SAVE_CONFIG="$HOME/.config/power-save/config.json"
AGS_PREFS_CONFIG="$HOME/.config/gigios/preferences.json"
LOW_THRESHOLDS=(10 8 6 4 2 0)
DEFAULT_POWER_SAVE_THRESHOLD=15
THRESHOLD_REFRESH_SECS=600   # re-read power-save config at most every 10min

POLL_ACTIVE=30   # discharging and near/under a threshold — keep it responsive
POLL_IDLE=60     # discharging but comfortably above every threshold
POLL_CHARGING=90 # charging (not yet full) or already full — nothing urgent

declare -A notified
charged_notified=false
powersave_notified=false
prev_status=""
power_save_threshold=$DEFAULT_POWER_SAVE_THRESHOLD
last_threshold_check=-$THRESHOLD_REFRESH_SECS

# Ajuste "Monitor de batería" en Personalización (ags). Se lee UNA sola vez
# aquí al arrancar — nada de polling — así que activar/desactivar el ajuste
# solo surte efecto reiniciando este script (o en el próximo login).
if command -v jq >/dev/null 2>&1; then
    # NB: plain `.batteryMonitor // "true"` would be wrong — jq's `//` treats a
    # literal `false` as absent too, so it'd always resolve to "true".
    enabled=$(jq -r 'if has("batteryMonitor") then (.batteryMonitor|tostring) else "true" end' \
        "$AGS_PREFS_CONFIG" 2>/dev/null)
    [[ "$enabled" == "false" ]] && exit 0
fi

# [A] Read every sysfs value once per tick with bash built-in redirects —
#     no subprocess forks; get_capacity and get_time_label use these globals.
read_battery() {
    read -r energy_now  < "$BATTERY/energy_now"  2>/dev/null || energy_now=0
    read -r energy_full < "$BATTERY/energy_full" 2>/dev/null || energy_full=1
    read -r power_now   < "$BATTERY/power_now"   2>/dev/null || power_now=0
    read -r status      < "$BATTERY/status"      2>/dev/null || status=Unknown
}

# Ceiling-rounded percentage using globals from read_battery, matching AGS.
# Sets global $capacity — no echo/command-substitution, no subshell fork.
get_capacity() {
    if (( energy_full <= 0 )); then
        read -r capacity < "$BATTERY/capacity" 2>/dev/null || capacity=0
        return
    fi
    capacity=$(( (energy_now * 100 + energy_full - 1) / energy_full ))
}

# Human-readable time estimate using globals from read_battery (no I/O, no fork).
# Sets global $time_label.
get_time_label() {
    if (( power_now == 0 )); then
        time_label="tiempo desconocido"; return
    fi
    local delta seconds h m
    if [[ "$1" == "Discharging" ]]; then
        delta=$energy_now
    else
        delta=$(( energy_full - energy_now ))
    fi
    seconds=$(( delta * 3600 / power_now ))
    h=$(( seconds / 3600 ))
    m=$(( (seconds % 3600) / 60 ))
    if (( h > 0 )); then time_label="${h}h ${m}min"; else time_label="${m}min"; fi
}

# Mirrors ags' powerSaveActive threshold (~/.config/power-save/config.json).
# Only forks jq at most once every THRESHOLD_REFRESH_SECS — updates global
# $power_save_threshold in place, config changes are rare so this is plenty fresh.
refresh_power_save_threshold() {
    (( SECONDS - last_threshold_check < THRESHOLD_REFRESH_SECS )) && return
    last_threshold_check=$SECONDS
    local thr
    thr=$(jq -e '.thresholdPct' "$POWER_SAVE_CONFIG" 2>/dev/null) || thr=$DEFAULT_POWER_SAVE_THRESHOLD
    [[ "$thr" =~ ^[0-9]+$ ]] && power_save_threshold=$thr
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
    get_capacity

    # ── Status transitions ────────────────────────────────────────────────────
    # [E] Treating prev_status="" as a valid prior state lets the first-boot
    #     Discharging reset fall through the same path without a separate elif.
    if [[ "$status" != "$prev_status" ]]; then
        case "$status" in
            Charging)
                if [[ -n "$prev_status" ]]; then
                    get_time_label Charging
                    send_notif normal battery-good \
                        "Cargando batería" \
                        "${capacity}% — tiempo para carga completa: ~${time_label}"
                fi
                powersave_notified=false  # charging never shows power-save warnings
                ;;
            Discharging)
                if [[ -n "$prev_status" ]]; then
                    get_time_label Discharging
                    send_notif normal battery-good \
                        "Desconectado cargador" \
                        "${capacity}% — tiempo restante: ~${time_label}"
                fi
                notified=()           # [B]
                charged_notified=false
                powersave_notified=false
                ;;
        esac
    fi

    # [D] Full-charge check unified — covers both Full status and Charging@100%.
    if [[ "$charged_notified" == false ]] && \
       [[ "$status" == "Full" || ("$status" == "Charging" && "$capacity" -ge 100) ]]; then
        send_notif normal battery-full \
            "Carga completada"
        charged_notified=true
    fi

    # ── Discharge-only checks: power-save mode + low-battery steps ────────────
    # Prevención: mientras carga (o está llena) no se avisa ni de modo ahorro
    # ni de batería baja.
    near_threshold=false
    if [[ "$status" == "Discharging" ]]; then
        refresh_power_save_threshold

        if [[ "$powersave_notified" == false ]] \
                && (( capacity > 0 && capacity <= power_save_threshold )); then
            powersave_notified=true
            send_notif normal power-profile-power-saver-symbolic \
                "Modo ahorro de energía activado" \
                "Batería ${capacity}% (umbral: ${power_save_threshold}%)"
        elif (( capacity > power_save_threshold )); then
            powersave_notified=false
        fi

        get_time_label Discharging
        for thr in "${LOW_THRESHOLDS[@]}"; do
            if (( capacity <= thr )) && [[ -z "${notified[$thr]}" ]]; then
                notified[$thr]=1
                threshold_urgency "$thr"  # [C]
                send_notif "$urgency" "$icon" \
                    "Batería ${capacity}%" \
                    "Tiempo restante ~${time_label}"
            fi
        done

        # Within 10 points of the power-save threshold (or already under any
        # low-battery threshold) → keep the finer poll interval for accuracy.
        (( capacity <= power_save_threshold + 10 )) && near_threshold=true
    fi

    prev_status=$status

    # ── Adaptive poll interval — fewer wakeups when nothing urgent is near ────
    if [[ "$status" == "Discharging" ]]; then
        if [[ "$near_threshold" == true ]]; then
            sleep "$POLL_ACTIVE"
        else
            sleep "$POLL_IDLE"
        fi
    else
        sleep "$POLL_CHARGING"
    fi
done
