#!/usr/bin/env bash
# USB monitor — notifies on device connect and disconnect via udevadm.

udevadm monitor --udev --subsystem-match=usb 2>/dev/null | while IFS= read -r line; do

    # Only act on add/remove action lines
    [[ "$line" != *"UDEV  ["* ]] && continue
    [[ "$line" != *" add "* && "$line" != *" remove "* ]] && continue

    # Extract the sysfs path from the event line
    syspath=$(grep -oP '/devices/\S+' <<< "$line")
    [ -z "$syspath" ] && continue

    # Only care about the USB device node, not every sub-interface
    [[ "$syspath" != */usb*/*-* ]] && continue
    [[ "$syspath" == *:* ]] && continue  # skip interface nodes (contain colon)

    # Resolve vendor/model from udev database
    vendor=$(udevadm info "/sys${syspath}" 2>/dev/null | awk -F= '/^E: ID_VENDOR=/{print $2}')
    model=$(udevadm info  "/sys${syspath}" 2>/dev/null | awk -F= '/^E: ID_MODEL=/{print $2}')

    # Clean up underscores from encoded names
    vendor="${vendor//_/ }"
    model="${model//_/ }"

    if [ -n "$vendor" ] || [ -n "$model" ]; then
        label="${vendor:+$vendor }${model:-dispositivo desconocido}"
    else
        label="dispositivo desconocido"
    fi

    if [[ "$line" == *" add "* ]]; then
        notify-send -u normal "🔌 USB conectado" "$label" -t 8000
    else
        notify-send -u normal "🔌 USB desconectado" "$label" -t 8000
    fi

done
