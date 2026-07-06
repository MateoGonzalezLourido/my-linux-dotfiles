#!/usr/bin/env bash
# USB monitor — notifies on device connect/disconnect via udevadm.
# Fully event-driven: `udevadm monitor` blocks on the kernel/udev uevent
# socket, zero polling. Using --property (-p) means vendor/model/devtype
# arrive inline with the event itself, so — unlike a plain `udevadm monitor`
# followed by a separate `udevadm info` re-query per device — no extra
# subprocess forks happen while parsing; the only fork per real event is
# notify-send.
#
# DEVTYPE=usb_device (vs. usb_interface) is udev's own, canonical way to tell
# a physical device apart from its per-interface sub-nodes — the same test
# used internally by udev rules — so we don't need syspath glob heuristics.

action=""
devtype=""
vendor=""
model=""

reset_event() {
    action=""; devtype=""; vendor=""; model=""
}

notify_usb() {
    local verb=$1
    local label="${vendor:+$vendor }${model:-dispositivo desconocido}"
    notify-send -u normal "USB $verb" "$label" -t 8000
}

reset_event
while IFS= read -r line; do
    case "$line" in
        "UDEV  ["*)
            reset_event
            ;;
        "ACTION="*)
            action=${line#ACTION=}
            ;;
        "DEVTYPE="*)
            devtype=${line#DEVTYPE=}
            ;;
        "ID_VENDOR_FROM_DATABASE="*)
            vendor=${line#ID_VENDOR_FROM_DATABASE=}
            ;;
        "ID_VENDOR="*)
            [[ -z "$vendor" ]] && vendor=${line#ID_VENDOR=}
            ;;
        "ID_MODEL_FROM_DATABASE="*)
            model=${line#ID_MODEL_FROM_DATABASE=}
            ;;
        "ID_MODEL="*)
            [[ -z "$model" ]] && model=${line#ID_MODEL=}
            ;;
        "")
            # Línea en blanco = fin del bloque de propiedades de este evento.
            if [[ "$devtype" == "usb_device" ]]; then
                vendor="${vendor//_/ }"
                model="${model//_/ }"
                case "$action" in
                    add)    notify_usb "conectado" ;;
                    remove) notify_usb "desconectado" ;;
                esac
            fi
            reset_event
            ;;
    esac
done < <(udevadm monitor --udev --subsystem-match=usb --property 2>/dev/null)
