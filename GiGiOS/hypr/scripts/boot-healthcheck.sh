#!/usr/bin/env bash
# boot-healthcheck.sh — Universal boot health check for Hyprland sessions.
# Autodiscovers hardware; checks only relevant subsystems.
# Silent on clean boot. Notifies per category on problems only.

sleep 5  # Let the session fully initialize before checking

# ── Setup ─────────────────────────────────────────────────────────────────────

LOG="$HOME/.config/hypr/logs/boot-healthcheck.log"
mkdir -p "$(dirname "$LOG")"
BOOT_TS=$(date '+%Y-%m-%d %H:%M:%S')
ISSUES=0

has_cmd() { command -v "$1" &>/dev/null; }

log() { echo "[$BOOT_TS] $*" >> "$LOG"; }

notify_problem() {
    local urgency=$1 title=$2 body=$3
    DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus" \
        notify-send -h string:x-gigios-source:system --urgency="$urgency" --expire-time=0 "$title" "$body" 2>/dev/null
    log "[$urgency] $title — $body"
    (( ISSUES++ ))
}

log "=== Boot healthcheck START ==="

# ── Phase 1: Hardware autodiscovery ───────────────────────────────────────────

HAS_BATTERY=false
HAS_NVIDIA=false
HAS_NVME=false
HAS_SATA=false
HAS_SMART=false
HAS_FANS=false
HAS_SWAP=false
HAS_BLUETOOTH=false
HAS_AUDIO=false
HAS_NETWORK=false
HAS_USB=false

# Battery
ls /sys/class/power_supply/ 2>/dev/null | grep -qi "bat" \
    && HAS_BATTERY=true

# NVIDIA GPU (check PCI hardware, not loaded module)
if has_cmd lspci && lspci 2>/dev/null | grep -qi "NVIDIA"; then
    HAS_NVIDIA=true
elif grep -rlq "0x10de" /sys/bus/pci/devices/*/vendor 2>/dev/null; then
    HAS_NVIDIA=true
fi

# NVMe drives
ls /dev/nvme? &>/dev/null && HAS_NVME=true

# SATA drives
ls /dev/sd? &>/dev/null && HAS_SATA=true

# SMART support (needs smartctl + a real disk)
( $HAS_NVME || $HAS_SATA ) && has_cmd smartctl && HAS_SMART=true

# Fan sensors (at least one fan reporting numeric RPM). Cache `sensors`
# output here — the "fan detenido" check later reuses it instead of
# invoking `sensors` two more times for the same near-instant reading.
SENSORS_OUTPUT=""
if has_cmd sensors; then
    SENSORS_OUTPUT=$(sensors 2>/dev/null)
    grep -qiE "fan[0-9]+:[[:space:]]+[0-9]+ RPM" <<< "$SENSORS_OUTPUT" && HAS_FANS=true
fi

# Swap
swapon --show --noheadings 2>/dev/null | grep -q "." && HAS_SWAP=true

# Bluetooth adapter. Cache `rfkill list bluetooth` — the Bluetooth check
# later reuses it (different grep: "blocked: yes") instead of invoking it
# again.
RFKILL_BT_OUTPUT=""
if has_cmd rfkill; then
    RFKILL_BT_OUTPUT=$(rfkill list bluetooth 2>/dev/null)
    grep -qi "bluetooth" <<< "$RFKILL_BT_OUTPUT" && HAS_BLUETOOTH=true
fi

# Audio (ALSA sees at least one card). Cache `aplay -l` — the Audio check
# later reuses it instead of invoking it again.
APLAY_OUTPUT=""
if has_cmd aplay; then
    APLAY_OUTPUT=$(aplay -l 2>/dev/null)
    grep -q "^card" <<< "$APLAY_OUTPUT" && HAS_AUDIO=true
fi

# Network interfaces present. Cache `ip link show` — the network check later
# reuses it (different grep: "state UP" instead of just "exists") instead of
# invoking it again.
IP_LINK_OUTPUT=$(ip link show 2>/dev/null)
grep -q "^[0-9]" <<< "$IP_LINK_OUTPUT" && HAS_NETWORK=true

# USB subsystem
has_cmd lsusb && HAS_USB=true

log "Hardware discovered: battery=$HAS_BATTERY nvidia=$HAS_NVIDIA nvme=$HAS_NVME \
sata=$HAS_SATA fans=$HAS_FANS swap=$HAS_SWAP bt=$HAS_BLUETOOTH \
audio=$HAS_AUDIO net=$HAS_NETWORK usb=$HAS_USB"

# ── Phase 2: Checks ───────────────────────────────────────────────────────────

# ── Always: failed systemd services ──────────────────────────────────────────
failed=$(systemctl --failed --no-legend 2>/dev/null | grep -v "^$")
if [[ -n "$failed" ]]; then
    count=$(wc -l <<< "$failed")
    names=$(awk '{print $1}' <<< "$failed" | paste -sd ', ')
    notify_problem critical "Servicios fallidos" \
        "${count} servicio(s) no arrancaron: ${names}"
fi

# ── Always: errors at boot (deduped by source) ───────────────────────────────
# Filtra ruido conocido (ACPI, bluetooth init, firmware quirks).
# Deduplica por nombre de proceso/unidad para que N repeticiones = 1 problema.
kerr_sources=$(journalctl -b -p err --no-pager -q 2>/dev/null \
    | grep -Eiv \
        "acpi|bluetoothd|bluetooth.*hci|nvrm|nouveau|wmi|efi.*var|pstore|firmware" \
    | grep -v "^[[:space:]]*$" \
    | awk '{
        # field 5 = "process[PID]:" — strip brackets, PID, colon, parens
        f=$5; gsub(/[\[\]():]/,"",f); gsub(/[0-9]+/,"",f)
        # skip if only whitespace/empty after stripping
        if (f ~ /[a-zA-Z_-]/) print f
      }' \
    | sort -u)
kerr_count=$(grep -c "." <<< "$kerr_sources" 2>/dev/null || echo 0)
if (( kerr_count > 0 )); then
    kerr_names=$(tr '\n' ', ' <<< "$kerr_sources" | sed 's/, $//')
    notify_problem warning "Errores en el arranque" \
        "${kerr_count} fuente(s) con errores: ${kerr_names} — revisa: journalctl -b -p err"
fi

# ── Always: suspend/hibernate failure in previous boot ───────────────────────
# -b -1 mira el arranque anterior; si no existe, journalctl devuelve error → skip.
# Se captura una sola vez (es la llamada más cara del script, ~0.8s en un
# journal grande) y se reutiliza tanto para el chequeo de existencia como
# para el grep de reinicio forzado más abajo — antes eran dos invocaciones
# separadas de `journalctl -b -1` sobre los mismos datos.
PREV_BOOT_LOG=$(journalctl -b -1 --no-pager -q 2>/dev/null)
if [[ -n "$PREV_BOOT_LOG" ]]; then
    suspend_issues=()

    # Errores de suspensión/hibernación en el arranque anterior
    if journalctl -b -1 -p err --no-pager -q 2>/dev/null \
            | grep -qiE "suspend|hibernate|sleep"; then
        suspend_issues+=("errores de suspend/hibernate en journal anterior")
    fi

    # Servicios de suspensión que quedaron en failed
    for svc in systemd-suspend.service systemd-hibernate.service \
                systemd-hybrid-sleep.service systemd-suspend-then-hibernate.service; do
        if systemctl is-failed "$svc" &>/dev/null; then
            suspend_issues+=("${svc} en estado failed")
        fi
    done

    # Señales de reinicio forzado en el arranque anterior.
    # Excluye sddm-helper (embebe el log de Xorg con "nowatchdog" en cmdline).
    if grep -v "sddm" <<< "$PREV_BOOT_LOG" \
            | grep -qiE "watchdog (reset|triggered|timeout|bite)|hard reset|rebooted forcefully|emergency mode"; then
        suspend_issues+=("reinicio forzado o watchdog detectado")
    fi

    if (( ${#suspend_issues[@]} > 0 )); then
        detail=$(printf '%s; ' "${suspend_issues[@]}" | sed 's/; $//')
        notify_problem warning "Fallo de suspensión/hibernación" \
            "El arranque anterior terminó de forma no limpia — ${detail}"
    fi
fi

# ── Always: disk usage ───────────────────────────────────────────────────────
# Pure bash `read` word-splitting — no `awk` fork per line (nor for the
# initial filtering pass, which the original did as a separate awk stage).
while read -r fs _size _used _avail pct mnt; do
    [[ -n "$mnt" ]] || continue   # df wraps long device names onto their own line
    [[ "$fs" =~ ^(tmpfs|devtmpfs|efivarfs|udev) ]] && continue
    pct=${pct%\%}
    [[ "$pct" =~ ^[0-9]+$ ]] || continue
    if (( pct >= 90 )); then
        notify_problem critical "Disco casi lleno" \
            "${mnt} al ${pct}% — quedan menos del 10% libre"
    fi
done < <(df -h 2>/dev/null | tail -n +2)

# ── Always: boot time ────────────────────────────────────────────────────────
boot_line=$(systemd-analyze 2>/dev/null | grep "Startup finished")
if [[ -n "$boot_line" ]]; then
    total_str=$(grep -oP '= \K[^$]+' <<< "$boot_line" | tr -d ' ')
    # Handle "1min23.5s" or "23.786s"
    if grep -q "min" <<< "$total_str"; then
        mins=$(grep -oP '^\d+(?=min)' <<< "$total_str")
        secs=$(grep -oP 'min\K[\d.]+(?=s)' <<< "$total_str")
        total_secs=$(( mins * 60 + ${secs%.*} ))
    else
        total_secs=$(grep -oP '[\d.]+' <<< "$total_str" | awk '{printf "%d", $1}')
    fi
    if (( total_secs > 30 )); then
        notify_problem warning "Arranque lento" \
            "Tiempo total: ${total_str} (umbral: 30s) — revisa: systemd-analyze blame"
    fi
fi

# ── Always: network ──────────────────────────────────────────────────────────
if $HAS_NETWORK; then
    up_ifaces=$(grep "state UP" <<< "$IP_LINK_OUTPUT" | grep -v "lo:" \
        | awk -F': ' '{print $2}' | paste -sd ', ')
    if [[ -z "$up_ifaces" ]]; then
        notify_problem warning "Red inactiva" \
            "Ninguna interfaz en estado UP"
    else
        if ! timeout 5 ping -c 1 -W 3 1.1.1.1 &>/dev/null; then
            notify_problem warning "Sin conectividad" \
                "No se puede alcanzar 1.1.1.1 (interfaces activas: ${up_ifaces})"
        fi
    fi
else
    notify_problem warning "Sin interfaces de red" \
        "ip link no reporta ninguna interfaz"
fi

# ── NVIDIA ───────────────────────────────────────────────────────────────────
if $HAS_NVIDIA; then
    if ! lsmod 2>/dev/null | grep -q "^nvidia[[:space:]]"; then
        notify_problem critical "NVIDIA sin driver" \
            "GPU NVIDIA detectada pero el módulo 'nvidia' no está cargado en el kernel"
    elif has_cmd nvidia-smi && ! timeout 5 nvidia-smi &>/dev/null; then
        notify_problem critical "NVIDIA driver error" \
            "nvidia-smi falla — posible corrupción del driver o del módulo"
    fi
fi

# ── NVMe SMART ───────────────────────────────────────────────────────────────
# smartctl necesita acceso root; si falla por permisos, se omite sin error falso.
if $HAS_NVME && $HAS_SMART; then
    for dev in /dev/nvme?; do
        result=$(timeout 10 smartctl -H "$dev" 2>/dev/null)
        grep -qi "Permission denied\|unable to detect\|open device.*failed" <<< "$result" \
            && continue
        if grep -qi "FAILED" <<< "$result"; then
            notify_problem critical "NVMe SMART: fallo" \
                "${dev}: estado SMART FAILED — revisa con: sudo smartctl -a ${dev}"
        fi
    done
fi

# ── SATA SMART ───────────────────────────────────────────────────────────────
if $HAS_SATA && $HAS_SMART; then
    for dev in /dev/sd?; do
        result=$(timeout 10 smartctl -H "$dev" 2>/dev/null)
        grep -qi "Permission denied\|unable to detect\|doesn't support\|open device.*failed" \
            <<< "$result" && continue
        if grep -qi "FAILED" <<< "$result"; then
            notify_problem critical "SATA SMART: fallo" \
                "${dev}: estado SMART FAILED — revisa con: sudo smartctl -a ${dev}"
        fi
    done
fi

# ── Battery health ───────────────────────────────────────────────────────────
if $HAS_BATTERY; then
    for bat_path in /sys/class/power_supply/BAT*; do
        [[ -d "$bat_path" ]] || continue
        bat=$(basename "$bat_path")
        full=$(cat "$bat_path/energy_full"        2>/dev/null \
            || cat "$bat_path/charge_full"        2>/dev/null)
        design=$(cat "$bat_path/energy_full_design" 2>/dev/null \
            || cat "$bat_path/charge_full_design"   2>/dev/null)
        if [[ "$full" =~ ^[0-9]+$ && "$design" =~ ^[0-9]+$ && "$design" -gt 0 ]]; then
            health=$(( full * 100 / design ))
            if (( health < 80 )); then
                notify_problem warning "Batería degradada" \
                    "${bat}: salud al ${health}% de la capacidad original de diseño"
            fi
        fi
    done
fi

# ── Fan: parado con temperatura alta ──────────────────────────────────────────
# Reutiliza $SENSORS_OUTPUT (Fase 1) — evita invocar `sensors` dos veces más
# por la misma lectura casi instantánea, y de paso usa una única muestra
# consistente para correlacionar temp. de CPU y RPM de ventilador.
if $HAS_FANS; then
    cpu_temp=$(grep -A1 "Package id\|Tdie\|Tccd1" <<< "$SENSORS_OUTPUT" \
        | grep "°C" | grep -oP '[0-9]+\.[0-9]+' \
        | head -1 | awk '{printf "%d", $1}')
    if [[ "$cpu_temp" =~ ^[0-9]+$ ]] && (( cpu_temp > 70 )); then
        zero_rpm=$(grep -iE "fan[0-9]+:" <<< "$SENSORS_OUTPUT" | grep -cE "[[:space:]]+0 RPM")
        if (( zero_rpm > 0 )); then
            notify_problem critical "Ventilador parado" \
                "CPU a ${cpu_temp}°C pero ${zero_rpm} ventilador(es) reportan 0 RPM"
        fi
    fi
fi

# ── Audio ─────────────────────────────────────────────────────────────────────
# (El chequeo "aplay no ve tarjetas" ya lo cubre HAS_AUDIO en Fase 1 — si
# llegamos aquí es porque $APLAY_OUTPUT ya mostró una tarjeta.)
if $HAS_AUDIO; then
    if ! systemctl --user is-active pipewire &>/dev/null; then
        notify_problem warning "PipeWire inactivo" \
            "El servicio pipewire no está corriendo en la sesión de usuario"
    fi
fi

# ── Bluetooth ─────────────────────────────────────────────────────────────────
# Reutiliza $RFKILL_BT_OUTPUT (Fase 1) — mismo comando, distinto grep.
if $HAS_BLUETOOTH; then
    if ! systemctl is-active bluetooth &>/dev/null; then
        notify_problem warning "Bluetooth inactivo" \
            "bluetooth.service no está corriendo — inicia con: systemctl start bluetooth"
    fi
    blocked=$(grep -E "blocked: yes" <<< "$RFKILL_BT_OUTPUT" | head -1)
    if [[ -n "$blocked" ]]; then
        notify_problem warning "Bluetooth bloqueado" \
            "rfkill: $blocked — desbloquea con: rfkill unblock bluetooth"
    fi
fi

# ── USB errors at boot ────────────────────────────────────────────────────────
if $HAS_USB; then
    usb_errors=$(journalctl -b 2>/dev/null \
        | grep -ciE "usb.*error|usb.*failed|usb.*unable" || true)
    if (( usb_errors > 0 )); then
        notify_problem warning "Errores USB en el arranque" \
            "${usb_errors} error(s) USB en el journal — revisa: journalctl -b | grep -i 'usb.*error'"
    fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
if (( ISSUES == 0 )); then
    log "Todo OK — sin problemas detectados"
else
    log "Healthcheck completado: ${ISSUES} problema(s) notificado(s)"
fi

log "=== Boot healthcheck END ==="
