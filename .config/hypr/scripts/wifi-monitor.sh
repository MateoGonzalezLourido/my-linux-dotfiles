#!/usr/bin/env bash
# WiFi monitor — notifies on disconnect and reconnect.

# Auto-detect the first wireless interface
IFACE=$(iw dev 2>/dev/null | awk '/Interface/{print $2; exit}')
if [[ -z "$IFACE" ]]; then
    notify-send -u warning "wifi-monitor" "No se encontró ninguna interfaz WiFi. Saliendo." -t 10000
    exit 0
fi
POLL_INTERVAL=10

was_connected=true  # assume connected at start to avoid false "reconnected" on boot

is_connected() {
    [[ "$(cat /sys/class/net/$IFACE/operstate 2>/dev/null)" == "up" ]]
}

get_ssid() {
    iwgetid -r "$IFACE" 2>/dev/null || echo "desconocida"
}

while true; do
    if is_connected; then
        if [ "$was_connected" = false ]; then
            ssid=$(get_ssid)
            notify-send -u normal "📶 WiFi reconectado" "Red: $ssid" -t 8000
            was_connected=true
        fi
    else
        if [ "$was_connected" = true ]; then
            notify-send -u critical "📵 WiFi desconectado" "Se perdió la conexión en $IFACE" -t 0
            was_connected=false
        fi
    fi

    sleep "$POLL_INTERVAL"
done
