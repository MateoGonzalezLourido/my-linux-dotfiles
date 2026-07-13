#!/usr/bin/env bash
# WiFi monitor daemon — notifies on disconnect, on reconnect, and when a
# captive portal needs a login. Fully event-driven via `nmcli monitor`
# (blocks on NetworkManager's D-Bus signals): zero polling, zero forks while
# idle — the only work done is when an actual event fires.

IFACE=$(nmcli -t -f DEVICE,TYPE device 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}')
if [[ -z "$IFACE" ]]; then
    notify-send -h string:x-gigios-source:system -u critical "wifi-monitor" "No se encontró ninguna interfaz WiFi. Saliendo." -t 10000
    exit 0
fi

was_connected=true    # asumimos conectado al arrancar — evita un falso "reconectado" en el boot
portal_notified=false

# Perfil de conexión activo en la interfaz — para NM suele coincidir con el
# SSID en redes WiFi auto-creadas. Sin escaneo, sin forks extra (una sola
# consulta D-Bus vía nmcli, y solo cuando ocurre una reconexión real).
get_ssid() {
    nmcli -g GENERAL.CONNECTION device show "$IFACE" 2>/dev/null
}

notify_disconnected() {
    notify-send -h string:x-gigios-source:system -u critical "WiFi desconectado" "Se perdió la conexión en $IFACE" -t 0
}

notify_reconnected() {
    notify-send -h string:x-gigios-source:system -u normal "WiFi reconectado" "Red: $(get_ssid)" -t 8000
}

notify_portal() {
    notify-send -h string:x-gigios-source:system -u critical "Portal cautivo detectado" \
        "Abre el navegador para iniciar sesión y acceder a internet" -t 0
}

# La línea global "Connectivity is now 'X'" de `nmcli monitor` refleja la
# conectividad general de NetworkManager (la de su conexión primaria), no la
# de $IFACE en concreto — si vas por cable, o tienes wifi + ethernet a la vez,
# ese evento puede venir del cable. Por eso, ante cualquier cambio de
# conectividad consultamos la conectividad POR INTERFAZ de nuestra wifi
# (IP4-CONNECTIVITY de $IFACE) y solo avisamos si el portal es el de wifi.
check_portal() {
    local row state conn
    row=$(nmcli -t -f DEVICE,STATE,IP4-CONNECTIVITY device status 2>/dev/null \
        | awk -F: -v d="$IFACE" '$1==d{print $2":"$3}')
    state=${row%%:*}
    conn=${row##*:}
    if [[ "$state" == "connected" && "$conn" == "portal" ]]; then
        if [[ "$portal_notified" == false ]]; then
            notify_portal
            portal_notified=true
        fi
    else
        portal_notified=false
    fi
}

# Reintenta si `nmcli monitor` muere (p.ej. NetworkManager se reinicia) en
# vez de dejar el daemon colgado para siempre.
while true; do
    while IFS= read -r line; do
        case "$line" in
            "$IFACE: connected")
                if [[ "$was_connected" == false ]]; then
                    notify_reconnected
                    was_connected=true
                fi
                check_portal  # por si el portal ya está activo justo al reconectar
                ;;
            "$IFACE: disconnected")
                if [[ "$was_connected" == true ]]; then
                    notify_disconnected
                    was_connected=false
                fi
                portal_notified=false
                ;;
            "Connectivity is now "*)
                check_portal
                ;;
        esac
    # LC_ALL=C: los mensajes de estado de `monitor` son palabras clave en
    # inglés fijas independientemente del locale — es lo que casamos en el
    # case de arriba. Los textos que sí ve el usuario (notify-send) van en
    # español, definidos en las funciones notify_* de este script.
    done < <(LC_ALL=C nmcli monitor)
    sleep 2
done
