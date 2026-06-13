#!/usr/bin/env bash
# Hyprland watchdog — reinicia el compositor si falla o deja de responder.
# Corre como servicio systemd de usuario, FUERA de la sesión de Hyprland.

HYPRLAND_UNIT="wayland-wm@hyprland.desktop.service"
LOG="$HOME/.config/hypr/logs/watchdog.log"
STARTUP_GRACE=45     # segundos de espera inicial para que Hyprland levante el socket
POLL=15          # segundos entre comprobaciones
HYPRCTL_TIMEOUT=5  # segundos máximos para que hyprctl responda
RESTART_COOLDOWN=45  # segundos de espera tras reiniciar antes de volver a monitorizar

# Rotar log si supera 1 MB
rotate_log() {
    if [[ -f "$LOG" ]] && [[ $(stat -c%s "$LOG" 2>/dev/null || echo 0) -gt 1048576 ]]; then
        mv "$LOG" "${LOG}.1"
    fi
}

log() {
    rotate_log
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

notify_user() {
    local urgency=$1 title=$2 body=$3 timeout=${4:-8000}
    local bus="unix:path=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus"
    DBUS_SESSION_BUS_ADDRESS="$bus" \
        notify-send --urgency="$urgency" --expire-time="$timeout" "$title" "$body" 2>/dev/null || true
}

restart_hyprland() {
    local reason=$1
    log "REINICIO: $reason"
    notify_user warning "🔄 Hyprland Watchdog" "Reiniciando compositor — $reason" 5000
    systemctl --user restart "$HYPRLAND_UNIT"
    log "Esperando ${RESTART_COOLDOWN}s para que Hyprland inicialice..."
    sleep "$RESTART_COOLDOWN"
    log "Monitorización reanudada."
}

log "=== Watchdog iniciado (PID $$) | unidad: $HYPRLAND_UNIT ==="
log "Esperando ${STARTUP_GRACE}s de grace period para que Hyprland inicialice el socket..."
sleep "$STARTUP_GRACE"
log "Grace period completado. Iniciando monitorización."

while true; do
    state=$(systemctl --user is-active "$HYPRLAND_UNIT" 2>/dev/null)

    case "$state" in
        active)
            # Proceso vivo — comprobar si responde
            if ! timeout "$HYPRCTL_TIMEOUT" hyprctl status &>/dev/null; then
                log "ALERTA: Hyprland activo pero sin respuesta a hyprctl (timeout ${HYPRCTL_TIMEOUT}s)"
                restart_hyprland "compositor colgado"
            fi
            ;;

        failed)
            # Salida con error — crash inesperado
            # Breve pausa para descartar transiciones de estado fugaces
            sleep 2
            if [[ "$(systemctl --user is-active "$HYPRLAND_UNIT" 2>/dev/null)" == "failed" ]]; then
                log "ALERTA: Hyprland en estado 'failed'"
                restart_hyprland "crash del compositor"
            fi
            ;;

        inactive|*)
            # Detenido limpiamente (logout del usuario) o aún no iniciado — no tocar
            ;;
    esac

    sleep "$POLL"
done
