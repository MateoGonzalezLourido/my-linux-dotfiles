#!/usr/bin/env bash
# Bluetooth connection-loss monitor.
# Uses dbus-monitor (BlueZ PropertiesChanged) for instant detection.
# Grace period: if the device reconnects within GRACE seconds, no notification
# is sent (covers brief dropouts and auto-reconnects).

GRACE=10  # seconds to wait before declaring the connection truly lost

get_device_name() {
    bluetoothctl info "$1" 2>/dev/null | awk -F': ' '/^\s+Name:/{print $2; exit}'
}

is_still_lost() {
    local mac=$1
    local info
    info=$(bluetoothctl info "$mac" 2>/dev/null)
    grep -q "Connected: no" <<< "$info" && grep -q "Paired: yes" <<< "$info"
}

current_mac=""

dbus-monitor --system \
    "type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',arg0='org.bluez.Device1'" \
    2>/dev/null | while IFS= read -r line; do

    # Extract device MAC from the signal path line
    # path=/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF → AA:BB:CC:DD:EE:FF
    if [[ "$line" =~ path=/org/bluez/hci[0-9]+/dev_([0-9A-F_]+) ]]; then
        current_mac="${BASH_REMATCH[1]//_/:}"
    fi

    # Detect "Connected" property — next line has the boolean value
    if [[ "$line" == *'"Connected"'* ]] && [[ -n "$current_mac" ]]; then
        IFS= read -r val_line
        mac="$current_mac"

        if [[ "$val_line" == *"boolean false"* ]]; then
            # Snapshot the name now (device still in btd cache)
            name=$(get_device_name "$mac")
            (
                sleep "$GRACE"
                if is_still_lost "$mac"; then
                    notify-send -u critical "🔵 Bluetooth perdido" \
                        "Se perdió la conexión con: ${name:-$mac}" -t 0
                fi
            ) &

        elif [[ "$val_line" == *"boolean true"* ]]; then
            name=$(get_device_name "$mac")
            notify-send -u normal "🔵 Bluetooth conectado" \
                "${name:-$mac}" -t 6000
        fi
    fi

done
