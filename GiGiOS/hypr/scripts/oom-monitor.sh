#!/usr/bin/env bash
# System event monitor — kernel events, auth failures, SSH, file integrity,
# disk health y estado de servicios. Los monitores corren en paralelo via & + wait:
#   1. monitor_kernel  — journalctl -kf (SOLO kernel): OOM, panic, hung, I/O, GPU,
#                        errores de hardware (MCE/ECC), módulos sin firmar…
#   2. monitor_system  — journalctl -f filtrado por identificador: sudo, sshd, su,
#                        pkexec, polkitd, systemd (failed to start), systemd-coredump
#   3. monitor_files   — inotifywait sobre configs/persistencia críticas
#   4. monitor_smart   — polling de SMART (smartctl): disco a punto de fallar
#   5. monitor_units   — polling de `systemctl --failed`: unidades caídas
#
# Notas de diseño (evitar falsos positivos):
#   - `-n 0` evita reprocesar el backlog del journal al arrancar (si no, cada
#     inicio de sesión reenviaba eventos viejos).
#   - Los eventos de kernel se anclan a `journalctl -k` en vez de hacer match de
#     subcadenas sobre TODO el journal (antes cualquier log de app con "i/o error"
#     o "gpu … error" disparaba una alerta de disco/GPU).
#   - El monitor de sistema se restringe con `-t` a los identificadores relevantes,
#     así "failed to start" solo cuenta cuando lo emite systemd, no una app.
#   - Los monitores de polling siembran su estado en la primera pasada sin
#     notificar, para no avisar de fallos preexistentes al arrancar.

# ── Ajustes de seguridad (sección "Seguridad" de ags) ─────────────────────────
# Cada clave activa/desactiva un tipo de evento. Se leen UNA sola vez aquí al
# arrancar (nada de polling de la config), igual que battery-monitor.sh con
# preferences.json, así que un cambio en la UI solo surte efecto reiniciando el
# sistema o relanzando este script. Archivo ausente/ilegible → todo ON (por
# defecto). Fuente: ags/widget/settings/securityPrefs.ts → security.json.
SEC_CONFIG="$HOME/.config/gigios/security.json"
sec_oomKiller=true   sec_kernelPanic=true   sec_hungTask=true    sec_hwErrors=true
sec_kernelModules=true sec_cpuThrottling=true sec_diskError=true sec_diskHealth=true
sec_gpuError=true    sec_serviceFailure=true sec_serviceHealth=true
sec_sudoAuth=true    sec_privEsc=true       sec_ssh=true         sec_appCrash=true
sec_fileIntegrity=true sec_downloadScan=true sec_sandboxLaunch=true

if command -v jq >/dev/null 2>&1 && [[ -f "$SEC_CONFIG" ]]; then
    # Solo un `false` explícito desactiva; claves ausentes conservan el default ON.
    # Allowlist de claves para no fijar variables arbitrarias desde el JSON.
    while IFS='=' read -r _k _v; do
        [[ "$_v" == "false" ]] || continue
        case "$_k" in
            oomKiller|kernelPanic|hungTask|hwErrors|kernelModules|cpuThrottling|\
            diskError|diskHealth|gpuError|serviceFailure|serviceHealth|sudoAuth|\
            privEsc|ssh|appCrash|fileIntegrity|downloadScan|sandboxLaunch)
                printf -v "sec_$_k" '%s' false ;;
        esac
    done < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' "$SEC_CONFIG" 2>/dev/null)
fi

# Lanzador aislado (contención + análisis) que dispara el botón de la notificación.
RUN_UNTRUSTED="$HOME/.config/hypr/scripts/run-untrusted.sh"
# Escaneo a demanda (para archivos grandes que el barrido se salta).
SCAN_FILE="$HOME/.config/hypr/scripts/scan-file.sh"

# ¿Es "lanzable"? Bit de ejecución, tipo de instalador conocido o binario ELF.
# Se usa en monitor_downloads para avisar solo de lo que podrías ejecutar.
is_runnable() {
    local f="$1"
    [[ -f "$f" ]] || return 1
    [[ -x "$f" ]] && return 0
    case "${f,,}" in
        *.appimage|*.run|*.sh|*.bin|*.exe|*.msi|*.deb|*.rpm|*.desktop) return 0 ;;
    esac
    [[ "$(head -c4 "$f" 2>/dev/null)" == $'\x7fELF' ]]
}

# ── Kernel monitor (SOLO kernel, anclado con -k) ──────────────────────────────
monitor_kernel() {
    # Si TODAS las categorías de kernel están desactivadas, no arrancamos el pipe.
    if [[ "$sec_oomKiller" == false && "$sec_kernelPanic" == false && \
          "$sec_hungTask" == false && "$sec_diskError" == false && \
          "$sec_gpuError" == false && "$sec_cpuThrottling" == false && \
          "$sec_hwErrors" == false && "$sec_kernelModules" == false && \
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

        # --- Hardware error (MCE / ECC / EDAC) ---
        elif [[ "$sec_hwErrors" != false ]] && \
             [[ "$lower" == *"machine check"* || "$lower" == *"mce:"* || \
                "$lower" == *"hardware error"* || "$lower" == *"edac"* || \
                "$lower" == *"memory error"* ]]; then
            notify-send -u critical "🧠 Error de hardware" "$line" -t 15000

        # --- Módulo de kernel sin firmar / fuera del árbol (posible rootkit) ---
        elif [[ "$sec_kernelModules" != false ]] && \
             [[ "$lower" == *"tainting kernel"* || "$lower" == *"module verification failed"* || \
                "$lower" == *"loading out-of-tree module"* || "$lower" == *"unsigned module"* ]]; then
            notify-send -u critical "🧩 Módulo de kernel sin firmar" "$line" -t 15000

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
          "$sec_ssh" == false && "$sec_appCrash" == false && \
          "$sec_privEsc" == false && "$sec_serviceHealth" == false ]]; then
        return
    fi

    declare -A _crash_cooldown
    declare -a _coredump_times=()   # ventana deslizante para detectar tormentas
    _storm_last=0

    # -t restringe a los identificadores que nos interesan → menos volumen y sin
    # falsos positivos de apps que casualmente logueen "failed to start", etc.
    journalctl -f -n 0 --no-pager \
        -t sudo -t sshd -t su -t pkexec -t polkitd -t systemd -t systemd-coredump 2>/dev/null |
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

        # --- Escalada de privilegios (pkexec / su / polkit) ---
        elif [[ "$sec_privEsc" != false ]] && \
             [[ "$lower" == *"pkexec"* || \
                ( "$lower" == *"(su:auth)"* && "$lower" == *"authentication failure"* ) || \
                ( "$lower" == *"polkit"* && "$lower" == *"failed to authenticate"* ) ]]; then
            notify-send -u critical "🔓 Escalada de privilegios" "$line" -t 15000

        # --- SSH events ---
        elif [[ "$sec_ssh" != false ]] && \
             [[ "$lower" == *"sshd"* && \
                ( "$lower" == *"failed password"* || "$lower" == *"accepted"* ) ]]; then
            notify-send -u warning "🌐 SSH" "$line" -t 15000

        # --- App crash: coredump (systemd-coredump, userspace) ---
        #     La notificación por-app va bajo appCrash; la detección de "tormenta"
        #     (varios coredumps en <60s) va bajo serviceHealth. Procesamos la línea
        #     si CUALQUIERA de los dos está activo.
        elif [[ "$sec_appCrash" != false || "$sec_serviceHealth" != false ]] && \
             [[ "$lower" == *"coredump"* && \
                ( "$lower" == *"dumped core"* || "$lower" == *"terminated abnormally"* ) ]]; then
            app="desconocida"
            pat_core='Process [0-9]+ \(([^)]+)\)'
            [[ "$line" =~ $pat_core ]] && app="${BASH_REMATCH[1]}"
            _now=$(date +%s)

            if [[ "$sec_appCrash" != false ]] && (( _now - ${_crash_cooldown[$app]:-0} >= 10 )); then
                _crash_cooldown[$app]=$_now
                notify-send -u critical "App crasheada" "Proceso: $app (coredump)" -t 15000
            fi

            if [[ "$sec_serviceHealth" != false ]]; then
                _coredump_times+=("$_now")
                pruned=()
                for t in "${_coredump_times[@]}"; do (( _now - t < 60 )) && pruned+=("$t"); done
                _coredump_times=("${pruned[@]}")
                if (( ${#_coredump_times[@]} >= 3 )) && (( _now - _storm_last >= 60 )); then
                    _storm_last=$_now
                    notify-send -u critical "🌩️ Tormenta de crashes" \
                        "${#_coredump_times[@]} volcados de core en <60s. Algo va muy mal." -t 0
                fi
            fi

        fi
    done
}

# ── File integrity monitor ────────────────────────────────────────────────────
# Se vigilan los DIRECTORIOS padre y se filtra por nombre: así se detectan también
# los reemplazos atómicos (write-temp + rename) que hacen passwd/visudo/editores,
# que un watch sobre el inodo del archivo se perdería. Cubre configs de auth,
# claves SSH y los sitios típicos de persistencia (systemd, autostart, cron).
monitor_files() {
    [[ "$sec_fileIntegrity" == false ]] && return

    if ! command -v inotifywait &>/dev/null; then
        notify-send -u warning "oom-monitor" \
            "inotify-tools no instalado. Vigilancia de archivos desactivada." -t 10000
        return
    fi

    # inotifywait ABORTA entero si no puede vigilar UNA sola ruta, así que solo
    # añadimos las que el usuario puede vigilar de verdad: existentes y con permiso
    # de lectura+ejecución sobre el directorio (-r -x). Esto excluye dirs root-only
    # como /etc/sudoers.d (750 root) o /boot (700) cuando corremos sin privilegios
    # — no se puede vigilar lo que el kernel no nos deja ver. La vigilancia del
    # propio /etc (755) sí capta modificaciones de /etc/passwd, sudoers, shadow…
    # porque el evento se entrega a nivel de directorio (no hace falta leer el
    # fichero). Las subcarpetas root-only quedan sin cubrir sin ejecutar como root.
    local watch_paths=()
    local d
    for d in /etc /etc/pam.d /etc/sudoers.d /etc/ssh /etc/cron.d /etc/systemd/system \
             /boot "$HOME/.ssh" "$HOME/.config/autostart" "$HOME/.config/systemd/user"; do
        [[ -d "$d" && -r "$d" && -x "$d" ]] && watch_paths+=("$d")
    done
    [[ ${#watch_paths[@]} -gt 0 ]] || return

    inotifywait -m -e close_write,moved_to,create --format '%w%f' \
        "${watch_paths[@]}" 2>/dev/null |
    while IFS= read -r path; do
        case "$path" in
            /etc/passwd|/etc/shadow|/etc/group|/etc/gshadow|/etc/hosts|/etc/sudoers|/etc/ld.so.preload|/etc/ssh/sshd_config)
                notify-send -u critical "🚨 Archivo crítico modificado" \
                    "Archivo: $path" -t 0 ;;
            /etc/sudoers.d/*|/etc/pam.d/*|/etc/cron.d/*|/etc/systemd/system/*|"$HOME"/.config/autostart/*|"$HOME"/.config/systemd/user/*)
                notify-send -u critical "🚨 Posible persistencia" \
                    "Nuevo/modificado: $path" -t 0 ;;
            "$HOME"/.ssh/authorized_keys|"$HOME"/.ssh/authorized_keys2)
                notify-send -u critical "🔑 Clave SSH autorizada modificada" \
                    "Archivo: $path" -t 0 ;;
            /boot/*)
                notify-send -u warning "🥾 Cambio en /boot" \
                    "Archivo: $path (kernel/initramfs)" -t 15000 ;;
        esac
    done
}

# ── Disk health monitor (SMART, polling) ──────────────────────────────────────
# smartctl suele necesitar privilegios para leer los datos SMART. Si no puede
# (falta el binario o no hay permisos), avisa UNA vez y deja de intentarlo. La
# salud SMART cambia despacio → sondeo cada hora. `-H` da el veredicto global y
# `-A` con WHEN_FAILED=FAILING_NOW cubre atributos pre-fail cayendo ahora mismo.
monitor_smart() {
    [[ "$sec_diskHealth" == false ]] && return
    command -v smartctl >/dev/null 2>&1 || return
    command -v lsblk >/dev/null 2>&1 || return

    local warned_perm=false
    declare -A _smart_notified
    local disk dev report

    while :; do
        while read -r disk; do
            [[ -z "$disk" ]] && continue
            dev="/dev/$disk"
            report=$(smartctl -H -A "$dev" 2>/dev/null)
            if [[ -z "$report" ]]; then
                if [[ "$warned_perm" == false ]]; then
                    warned_perm=true
                    notify-send -u warning "💽 Salud de disco" \
                        "smartctl no puede leer SMART (¿faltan privilegios?)." -t 10000
                fi
                continue
            fi
            if grep -qiE 'result:[[:space:]]*FAILED|FAILING_NOW' <<< "$report"; then
                if [[ -z "${_smart_notified[$dev]:-}" ]]; then
                    _smart_notified[$dev]=1
                    notify-send -u critical "💽 Disco a punto de fallar" \
                        "$dev: SMART reporta fallo inminente. Haz copia de seguridad YA." -t 0
                fi
            fi
        done < <(lsblk -dno NAME,TYPE 2>/dev/null | awk '$2=="disk" && $1 !~ /^(zram|loop|ram|dm-|sr)/{print $1}')
        sleep 3600
    done
}

# ── Service health monitor (unidades en estado failed, polling) ───────────────
# Más amplio que "failed to start": detecta unidades que caen en failed en
# CUALQUIER momento (watchdog, crash tras arrancar, OOM del servicio…), tanto del
# bus de sistema como del de usuario. La primera pasada solo siembra el estado,
# para no notificar los fallos preexistentes al arrancar (criterio de -n 0).
monitor_units() {
    [[ "$sec_serviceHealth" == false ]] && return
    command -v systemctl >/dev/null 2>&1 || return

    declare -A _known
    local seeded=false unit scope flag current

    while :; do
        current=""
        for scope in system user; do
            flag=""
            [[ "$scope" == user ]] && flag="--user"
            while read -r unit; do
                [[ -z "$unit" ]] && continue
                current+="$scope/$unit"$'\n'
                if [[ "$seeded" == true && -z "${_known[$scope/$unit]:-}" ]]; then
                    notify-send -u critical "⚙️ Servicio en fallo" \
                        "Unidad ($scope): $unit" -t 15000
                fi
                _known["$scope/$unit"]=1
            done < <(systemctl $flag --failed --no-legend --plain 2>/dev/null | awk '{print $1}')
        done
        # Olvida las unidades ya recuperadas, para volver a avisar si recaen.
        for unit in "${!_known[@]}"; do
            grep -qxF "$unit" <<< "$current" || unset "_known[$unit]"
        done
        seeded=true
        sleep 120
    done
}

# ── Download scanner (~/Downloads, sondeo recursivo) ──────────────────────────
# Hace DOS cosas sobre la carpeta de descargas:
#   1) AVISA de ejecutables nuevos (AppImage, .run, .exe para Wine, binarios +x…)
#      —"Mark of the Web"— para que los verifiques antes de lanzarlos.
#   2) ANALIZA con ClamAV TODOS los archivos nuevos (no solo ejecutables): un
#      virus puede venir en un .com, un documento, dentro de un instalador, etc.
#      Sin esto, algo como el fichero de prueba EICAR (.com, sin +x) no se miraba.
#
# Usa un BARRIDO recursivo con find (NO inotify): `inotifywait -r` no vigila las
# subcarpetas creadas después de arrancar, y el caso típico —descargar un .rar/
# .zip y extraerlo a una carpeta nueva— caía justo en ese punto ciego. El sondeo
# ve cualquier archivo a cualquier profundidad, sin importar cuándo apareció.
#
# Dedup persistente en ~/.cache/gigios/download-seen (clave = ruta|tamaño). Para
# el AVISO de ejecutables, la primera vez que corre (sin estado) solo SIEMBRA lo
# ya existente sin avisar (no inundar). El ANÁLISIS antivirus SÍ escanea también
# lo existente en el primer barrido: una alerta de malware no es spam.

# Aviso de un único ejecutable nuevo (con botón "Lanzar aislado" si procede).
download_alert() {
    local f="$1"
    if [[ "$sec_sandboxLaunch" != false && -x "$RUN_UNTRUSTED" ]]; then
        # notify-send --wait -A bloquea hasta el clic/cierre → subshell en 2º plano.
        ( act=$(notify-send -a "Seguridad" --wait -t 45000 \
            -A "launch=🛡️ Lanzar aislado" -u warning \
            "⬇️ Ejecutable nuevo en Descargas" \
            "$(basename "$f") — verifícalo antes de lanzarlo.")
          [[ "$act" == "launch" ]] && "$RUN_UNTRUSTED" "$f" ) &
    else
        notify-send -u warning "⬇️ Ejecutable nuevo en Descargas" \
            "$(basename "$f") — verifícalo antes de lanzarlo." -t 12000
    fi
}

monitor_downloads() {
    [[ "$sec_downloadScan" == false ]] && return
    command -v find >/dev/null 2>&1 || return

    # Carpeta de descargas locale-aware (aquí es ~/Descargas, no ~/Downloads).
    # xdg-user-dir devuelve $HOME si no está configurada → lo tratamos como vacío.
    local dir="" cand
    command -v xdg-user-dir >/dev/null 2>&1 && dir=$(xdg-user-dir DOWNLOAD 2>/dev/null)
    [[ -n "$dir" && "$dir" != "$HOME" && -d "$dir" ]] || dir=""
    if [[ -z "$dir" ]]; then
        for cand in "$HOME/Downloads" "$HOME/Descargas"; do
            [[ -d "$cand" ]] && { dir="$cand"; break; }
        done
    fi
    [[ -n "$dir" ]] || return

    # Motor antivirus. Preferimos clamscan (standalone, funciona con solo tener la
    # base de firmas) sobre clamdscan, que necesita el daemon clamd corriendo y si
    # no está devuelve error silencioso (no detectaría nada).
    local clam=()
    if command -v clamscan >/dev/null 2>&1; then
        clam=(clamscan --no-summary)
    elif command -v clamdscan >/dev/null 2>&1; then
        clam=(clamdscan --fdpass --no-summary)
    fi
    local scan_max=314572800   # 300 MiB: no auto-escaneamos archivos enormes

    local seen_file="$HOME/.cache/gigios/download-seen"
    mkdir -p "$(dirname "$seen_file")" 2>/dev/null
    declare -A _seen
    local seeded=false key f sz listfile line vfile vsig mb
    local -a new_exec scan_batch big_files
    if [[ -f "$seen_file" ]]; then
        seeded=true
        while IFS= read -r key; do [[ -n "$key" ]] && _seen["$key"]=1; done < "$seen_file"
    fi

    while :; do
        new_exec=(); scan_batch=(); big_files=()
        while IFS= read -r f; do
            [[ -f "$f" ]] || continue
            sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
            key="$f|$sz"
            [[ -n "${_seen[$key]:-}" ]] && continue
            _seen["$key"]=1
            printf '%s\n' "$key" >> "$seen_file"
            # Análisis antivirus: TODO archivo nuevo bajo el tope (incluso al sembrar).
            if (( ${#clam[@]} && sz > 0 && sz < scan_max )); then
                scan_batch+=("$f")
            elif (( ${#clam[@]} && sz >= scan_max )) && [[ "$seeded" == true ]]; then
                # Demasiado grande para el auto-análisis: se avisa (con la opción de
                # escanearlo a mano). Solo cuando ya sembrado, para no avisar de lo
                # que ya tenías (p. ej. un .rar viejo) en el primer barrido.
                big_files+=("$f")
            fi
            # Aviso de ejecutable: solo los "lanzables" y solo cuando ya sembrado.
            [[ "$seeded" == true ]] && is_runnable "$f" && new_exec+=("$f")
        done < <(find "$dir" -type f 2>/dev/null)

        # Archivos demasiado grandes para el auto-análisis: aviso con botón para
        # escanearlos igualmente (o desde Ajustes › Seguridad).
        for f in "${big_files[@]}"; do
            mb=$(( $(stat -c%s "$f" 2>/dev/null || echo 0) / 1048576 ))
            if [[ -x "$SCAN_FILE" ]]; then
                ( act=$(notify-send -a "Seguridad" --wait -t 45000 \
                    -A "scan=🔍 Escanear igualmente" -u warning \
                    "⬇️ Archivo grande sin analizar" \
                    "$(basename "$f") (${mb} MB) supera el tope de auto-análisis. Escanéalo aquí o en Ajustes › Seguridad.")
                  [[ "$act" == "scan" ]] && "$SCAN_FILE" "$f" ) &
            else
                notify-send -u warning "⬇️ Archivo grande sin analizar" \
                    "$(basename "$f") (${mb} MB) — escanéalo desde Ajustes › Seguridad." -t 12000
            fi
        done

        # 1) Aviso de ejecutables nuevos. ≤4 → individual con botón; más → resumen.
        if (( ${#new_exec[@]} )); then
            if (( ${#new_exec[@]} <= 4 )); then
                for f in "${new_exec[@]}"; do download_alert "$f"; done
            else
                notify-send -u warning "⬇️ ${#new_exec[@]} ejecutables nuevos en Descargas" \
                    "En $(basename "$(dirname "${new_exec[0]}")")/ y otros. Revísalos antes de ejecutarlos (juego, instalador o crack)." -t 15000
            fi
        fi

        # 2) Análisis antivirus en LOTE (una sola invocación de ClamAV; --file-list
        #    evita reventar ARG_MAX y recargar la base de firmas por fichero).
        if (( ${#scan_batch[@]} )); then
            listfile=$(mktemp)
            printf '%s\n' "${scan_batch[@]}" > "$listfile"
            "${clam[@]}" --file-list="$listfile" 2>/dev/null | while IFS= read -r line; do
                [[ "$line" == *" FOUND" ]] || continue     # "/ruta: Firma FOUND"
                vfile="${line%%: *}"
                vsig="${line##*: }"; vsig="${vsig% FOUND}"
                notify-send -u critical "🦠 Malware detectado en Descargas" \
                    "$(basename "$vfile"): $vsig — NO lo ejecutes. Ruta: $vfile" -t 0
            done
            rm -f "$listfile"
        fi

        seeded=true
        sleep 30
    done
}

# ── Run in parallel ───────────────────────────────────────────────────────────
monitor_kernel &
monitor_system &
monitor_files &
monitor_smart &
monitor_units &
monitor_downloads &
wait
