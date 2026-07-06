#!/usr/bin/env bash
# System event monitor — kernel events, auth failures, SSH, file integrity.
# Two monitors run in parallel via & + wait:
#   1. monitor_journal  — single journalctl pipe (kernel + systemd unificados)
#   2. monitor_files    — inotifywait on critical config files

# ── Journal monitor (kernel + sistema/auth en un solo pipe) ───────────────────
monitor_journal() {
    # Cooldown por proceso para no spamear si el mismo binario crashea en bucle
    declare -A _crash_cooldown

    journalctl -f --no-pager 2>/dev/null | while IFS= read -r line; do

        lower="${line,,}"

        # --- OOM killer ---
        if [[ "$lower" == *"oom-killer"* || "$lower" == *"out of memory"* || "$lower" == *"killed process"* ]]; then
            process="desconocido"
            pat_killed='Killed process [0-9]+ \(([^)]+)\)'
            pat_kill='Kill process [0-9]+ \(([^)]+)\)'
            pat_invoked='([^[:space:]]+) invoked oom-killer'

            if [[ "$line" =~ $pat_killed ]]; then
                process="${BASH_REMATCH[1]}"
            elif [[ "$line" =~ $pat_kill ]]; then
                process="${BASH_REMATCH[1]}"
            elif [[ "$line" =~ $pat_invoked ]]; then
                process="${BASH_REMATCH[1]} (disparador)"
            fi

            notify-send -u critical "💀 OOM Killer" "Proceso: $process" -t 10000

        # --- Kernel panic ---
        elif [[ "$lower" == *"kernel panic"* ]]; then
            notify-send -u critical "💥 Kernel Panic" "El sistema va a reiniciar" -t 0

        # --- Hung task ---
        elif [[ "$lower" == *"hung_task"* || "$lower" == *"blocked for more than"* ]]; then
            notify-send -u critical "⚠️ Proceso colgado" "$line" -t 15000

        # --- Disk I/O error ---
        elif [[ "$lower" == *"i/o error"* ]]; then
            notify-send -u critical "💾 Error de disco" "$line" -t 15000

        # --- GPU / NVIDIA error ---
        elif [[ "$lower" == *"nvrm"* || \
                ( "$lower" == *"nvidia"* && "$lower" == *"error"* ) || \
                ( "$lower" == *"gpu"* && "$lower" == *"error"* ) ]]; then
            notify-send -u critical "🖥️ Error GPU" "$line" -t 15000

        # --- CPU throttling ---
        elif [[ "$lower" =~ cpu.*throttl ]]; then
            notify-send -u warning "🌡️ CPU Throttling" "$line" -t 10000

        # --- Systemd service failure ---
        elif [[ "$lower" == *"failed to start"* ]]; then
            notify-send -u warning "⚙️ Servicio fallido" "$line" -t 10000

        # --- Sudo auth failure ---
        elif [[ "$lower" == *"sudo"* && \
                ( "$lower" == *"authentication failure"* || "$lower" == *"incorrect password"* ) ]]; then
            notify-send -u critical "🔐 Fallo sudo" "Intento fallido de sudo" -t 15000

        # --- SSH events ---
        elif [[ "$lower" == *"sshd"* && \
                ( "$lower" == *"failed password"* || "$lower" == *"accepted"* ) ]]; then
            notify-send -u warning "🌐 SSH" "$line" -t 15000

        # --- App crash: segfault ---
        elif [[ "$lower" == *"segfault"* ]]; then
            app="desconocida"
            pat_seg='kernel: ([^[]+)\[[0-9]+\]: segfault'
            [[ "$line" =~ $pat_seg ]] && app="${BASH_REMATCH[1]}"
            _now=$(date +%s)
            if (( _now - ${_crash_cooldown[$app]:-0} >= 10 )); then
                _crash_cooldown[$app]=$_now
                notify-send -u critical "App crasheada" "Proceso: $app (segfault)" -t 15000
            fi

        # --- App crash: coredump ---
        elif [[ "$lower" == *"coredump"* && \
                ( "$lower" == *"dumped core"* || "$lower" == *"terminated abnormally"* ) ]]; then
            app="desconocida"
            pat_core='Process [0-9]+ \(([^)]+)\)'
            [[ "$line" =~ $pat_core ]] && app="${BASH_REMATCH[1]}"
            _now=$(date +%s)
            if (( _now - ${_crash_cooldown[$app]:-0} >= 10 )); then
                _crash_cooldown[$app]=$_now
                notify-send -u critical "App crasheada" "Proceso: $app (coredump)" -t 15000
            fi

        fi
    done
}

# ── File integrity monitor ────────────────────────────────────────────────────
monitor_files() {
    if ! command -v inotifywait &>/dev/null; then
        notify-send -u warning "oom-monitor" \
            "inotify-tools no instalado. Vigilancia de archivos desactivada." -t 10000
        return
    fi

    inotifywait -m -e close_write,moved_to,create \
        /etc/passwd /etc/sudoers /etc/hosts 2>/dev/null |
    while IFS=' ' read -r watchdir _events file; do
        notify-send -u critical "🚨 Archivo crítico modificado" \
            "Archivo: ${watchdir}${file}" -t 0
    done
}

# ── Run in parallel ───────────────────────────────────────────────────────────
monitor_journal &
monitor_files &
wait
