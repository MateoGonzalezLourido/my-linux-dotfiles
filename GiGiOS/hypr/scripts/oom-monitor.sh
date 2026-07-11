#!/usr/bin/env bash
# System event monitor — kernel events, auth failures, SSH, file integrity.
# Tres monitores corren en paralelo via & + wait:
#   1. monitor_kernel  — journalctl -kf (SOLO kernel): OOM, panic, hung, I/O, GPU…
#   2. monitor_system  — journalctl -f filtrado por identificador: sudo, sshd,
#                        systemd (failed to start), systemd-coredump
#   3. monitor_files   — inotifywait sobre los directorios de configs críticas
#
# Notas de diseño (evitar falsos positivos):
#   - `-n 0` evita reprocesar el backlog del journal al arrancar (si no, cada
#     inicio de sesión reenviaba eventos viejos).
#   - Los eventos de kernel se anclan a `journalctl -k` en vez de hacer match de
#     subcadenas sobre TODO el journal (antes cualquier log de app con "i/o error"
#     o "gpu … error" disparaba una alerta de disco/GPU).
#   - El monitor de sistema se restringe con `-t` a los identificadores relevantes,
#     así "failed to start" solo cuenta cuando lo emite systemd, no una app.

# ── Ajustes de seguridad (sección "Seguridad" de ags) ─────────────────────────
# Cada clave activa/desactiva un tipo de evento. Se leen UNA sola vez aquí al
# arrancar (nada de polling), igual que battery-monitor.sh con preferences.json,
# así que un cambio en la UI solo surte efecto reiniciando el sistema o
# relanzando este script. Archivo ausente/ilegible → todo ON (comportamiento por
# defecto). Fuente: ags/widget/settings/securityPrefs.ts → security.json.
SEC_CONFIG="$HOME/.config/gigios/security.json"
sec_oomKiller=true  sec_kernelPanic=true   sec_hungTask=true   sec_diskError=true
sec_gpuError=true   sec_cpuThrottling=true sec_serviceFailure=true
sec_sudoAuth=true   sec_ssh=true           sec_appCrash=true   sec_fileIntegrity=true

if command -v jq >/dev/null 2>&1 && [[ -f "$SEC_CONFIG" ]]; then
    # Solo un `false` explícito desactiva; claves ausentes conservan el default ON.
    # Allowlist de claves para no fijar variables arbitrarias desde el JSON.
    while IFS='=' read -r _k _v; do
        [[ "$_v" == "false" ]] || continue
        case "$_k" in
            oomKiller|kernelPanic|hungTask|diskError|gpuError|cpuThrottling|\
            serviceFailure|sudoAuth|ssh|appCrash|fileIntegrity)
                printf -v "sec_$_k" '%s' false ;;
        esac
    done < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' "$SEC_CONFIG" 2>/dev/null)
fi

# ── Kernel monitor (SOLO kernel, anclado con -k) ──────────────────────────────
monitor_kernel() {
    # Si TODAS las categorías de kernel están desactivadas, no arrancamos el pipe.
    if [[ "$sec_oomKiller" == false && "$sec_kernelPanic" == false && \
          "$sec_hungTask" == false && "$sec_diskError" == false && \
          "$sec_gpuError" == false && "$sec_cpuThrottling" == false && \
          "$sec_appCrash" == false ]]; then
        return
    fi

    # Cooldown por proceso para no spamear si el mismo binario crashea en bucle
    declare -A _crash_cooldown

    journalctl -kf -n 0 --no-pager 2>/dev/null | while IFS= read -r line; do

        lower="${line,,}"

        # --- OOM killer ---
        if [[ "$sec_oomKiller" != false ]] && \
           [[ "$lower" == *"oom-killer"* || "$lower" == *"out of memory"* || "$lower" == *"killed process"* ]]; then
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
        elif [[ "$sec_kernelPanic" != false ]] && [[ "$lower" == *"kernel panic"* ]]; then
            notify-send -u critical "💥 Kernel Panic" "El sistema va a reiniciar" -t 0

        # --- Hung task ---
        elif [[ "$sec_hungTask" != false ]] && \
             [[ "$lower" == *"hung_task"* || "$lower" == *"blocked for more than"* ]]; then
            notify-send -u critical "⚠️ Proceso colgado" "$line" -t 15000

        # --- Disk I/O error ---
        elif [[ "$sec_diskError" != false ]] && [[ "$lower" == *"i/o error"* ]]; then
            notify-send -u critical "💾 Error de disco" "$line" -t 15000

        # --- GPU / NVIDIA error ---
        elif [[ "$sec_gpuError" != false ]] && \
             [[ "$lower" == *"nvrm"* || \
                ( "$lower" == *"nvidia"* && "$lower" == *"error"* ) || \
                ( "$lower" == *"gpu"* && "$lower" == *"error"* ) ]]; then
            notify-send -u critical "🖥️ Error GPU" "$line" -t 15000

        # --- CPU throttling ---
        elif [[ "$sec_cpuThrottling" != false ]] && [[ "$lower" =~ cpu.*throttl ]]; then
            notify-send -u warning "🌡️ CPU Throttling" "$line" -t 10000

        # --- App crash: segfault ---
        elif [[ "$sec_appCrash" != false ]] && [[ "$lower" == *"segfault"* ]]; then
            app="desconocida"
            pat_seg='kernel: ([^[]+)\[[0-9]+\]: segfault'
            [[ "$line" =~ $pat_seg ]] && app="${BASH_REMATCH[1]}"
            _now=$(date +%s)
            if (( _now - ${_crash_cooldown[$app]:-0} >= 10 )); then
                _crash_cooldown[$app]=$_now
                notify-send -u critical "App crasheada" "Proceso: $app (segfault)" -t 15000
            fi

        fi
    done
}

# ── System / auth monitor (filtrado por identificador) ────────────────────────
monitor_system() {
    if [[ "$sec_serviceFailure" == false && "$sec_sudoAuth" == false && \
          "$sec_ssh" == false && "$sec_appCrash" == false ]]; then
        return
    fi

    declare -A _crash_cooldown

    # -t restringe a los identificadores que nos interesan → menos volumen y sin
    # falsos positivos de apps que casualmente logueen "failed to start", etc.
    journalctl -f -n 0 --no-pager \
        -t sudo -t sshd -t systemd -t systemd-coredump 2>/dev/null |
    while IFS= read -r line; do

        lower="${line,,}"

        # --- Systemd service failure ---
        if [[ "$sec_serviceFailure" != false ]] && [[ "$lower" == *"failed to start"* ]]; then
            notify-send -u warning "⚙️ Servicio fallido" "$line" -t 10000

        # --- Sudo auth failure ---
        elif [[ "$sec_sudoAuth" != false ]] && \
             [[ "$lower" == *"sudo"* && \
                ( "$lower" == *"authentication failure"* || "$lower" == *"incorrect password"* ) ]]; then
            notify-send -u critical "🔐 Fallo sudo" "Intento fallido de sudo" -t 15000

        # --- SSH events ---
        elif [[ "$sec_ssh" != false ]] && \
             [[ "$lower" == *"sshd"* && \
                ( "$lower" == *"failed password"* || "$lower" == *"accepted"* ) ]]; then
            notify-send -u warning "🌐 SSH" "$line" -t 15000

        # --- App crash: coredump (systemd-coredump, userspace) ---
        elif [[ "$sec_appCrash" != false ]] && \
             [[ "$lower" == *"coredump"* && \
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
# Se vigilan los DIRECTORIOS padre y se filtra por nombre: así se detectan también
# los reemplazos atómicos (write-temp + rename) que hacen passwd/visudo/editores,
# que un watch sobre el inodo del archivo se perdería.
monitor_files() {
    [[ "$sec_fileIntegrity" == false ]] && return

    if ! command -v inotifywait &>/dev/null; then
        notify-send -u warning "oom-monitor" \
            "inotify-tools no instalado. Vigilancia de archivos desactivada." -t 10000
        return
    fi

    inotifywait -m -e close_write,moved_to,create --format '%w%f' \
        /etc/ 2>/dev/null |
    while IFS= read -r path; do
        case "$path" in
            /etc/passwd|/etc/sudoers|/etc/hosts)
                notify-send -u critical "🚨 Archivo crítico modificado" \
                    "Archivo: $path" -t 0 ;;
        esac
    done
}

# ── Run in parallel ───────────────────────────────────────────────────────────
monitor_kernel &
monitor_system &
monitor_files &
wait
