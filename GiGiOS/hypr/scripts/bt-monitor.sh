#!/usr/bin/env bash
# Bluetooth connection-loss monitor — notifies only on an UNEXPECTED loss:
# not when you disconnect the device yourself (bluetoothctl, GNOME/KDE
# settings, blueman — anything that calls the standard BlueZ D-Bus API), and
# not when you turn Bluetooth off. Grace period: if the device reconnects
# within GRACE seconds, nothing is sent (covers brief dropouts/auto-reconnect).
#
# Single always-on dbus-monitor subscription — cheap while blocked, so there's
# no separate process to start/stop. What IS gated dynamically is the actual
# work: bluetoothctl queries and the grace-period timer only ever run when a
# device just became unexpectedly disconnected; a manual disconnect or a
# powered-off adapter is recognized and skipped before any of that runs.

GRACE=10                     # segundos de gracia antes de dar la pérdida por real
MANUAL_DISCONNECT_WINDOW=5   # ventana tras un Disconnect() propio para no avisar

declare -A manual_disconnect_time
current_mac=""

get_device_name() {
    bluetoothctl info "$1" 2>/dev/null | awk -F': ' '/^\s+Name:/{print $2; exit}'
}

is_still_lost() {
    local mac=$1 info
    info=$(bluetoothctl info "$mac" 2>/dev/null)
    grep -q "Connected: no" <<< "$info" && grep -q "Paired: yes" <<< "$info"
}

adapter_powered() {
    bluetoothctl show 2>/dev/null | grep -q "Powered: yes"
}

dbus-monitor --system \
    "type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',arg0='org.bluez.Device1'" \
    "type='method_call',interface='org.bluez.Device1',member='Disconnect'" \
    2>/dev/null | while IFS= read -r line; do

    # Extract device MAC from the signal/method-call path line
    # path=/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF → AA:BB:CC:DD:EE:FF
    if [[ "$line" =~ path=/org/bluez/hci[0-9]+/dev_([0-9A-F_]+) ]]; then
        current_mac="${BASH_REMATCH[1]//_/:}"
    fi

    # Alguien (bluetoothctl, GUI, script propio) pidió desconectar este
    # dispositivo por D-Bus — lo que sigue no es una pérdida inesperada.
    if [[ "$line" == "method call "* && "$line" == *"member=Disconnect"* ]] && [[ -n "$current_mac" ]]; then
        manual_disconnect_time["$current_mac"]=$EPOCHSECONDS
        continue
    fi

    # Detect "Connected" property — next line has the boolean value
    if [[ "$line" == *'"Connected"'* ]] && [[ -n "$current_mac" ]]; then
        IFS= read -r val_line
        mac="$current_mac"

        if [[ "$val_line" == *"boolean false"* ]]; then
            t=${manual_disconnect_time[$mac]:-0}
            if (( EPOCHSECONDS - t <= MANUAL_DISCONNECT_WINDOW )); then
                unset 'manual_disconnect_time[$mac]'
                continue  # desconexión manual — no avisar
            fi
            adapter_powered || continue  # se está apagando el bluetooth — no avisar

            # Snapshot the name now (device still in btd cache)
            name=$(get_device_name "$mac")
            (
                sleep "$GRACE"
                if is_still_lost "$mac" && adapter_powered; then
                    notify-send -h string:x-gigios-source:system -u critical "Bluetooth perdido" \
                        "Se perdió la conexión con: ${name:-$mac}" -t 0
                fi
            ) &

        elif [[ "$val_line" == *"boolean true"* ]]; then
            unset 'manual_disconnect_time[$mac]'
            name=$(get_device_name "$mac")
            notify-send -h string:x-gigios-source:system -u normal "Bluetooth conectado" \
                "${name:-$mac}" -t 6000
        fi
    fi

done
