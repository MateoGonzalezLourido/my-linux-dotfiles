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
# defecto). Fuente: ags/modulos/ajustes/securityPrefs.ts → security.json.
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

# ── Escalonado de arranque (ver hypr/autostart.conf) ──────────────────────────
# Este script NO se retrasa entero desde autostart.conf, y esa asimetría es el
# diseño: sus 6 sub-monitores no corren el mismo riesgo si empiezan tarde.
#
#   - kernel/system/files → SIN retardo. Siguen el journal con `-n 0` (que salta el
#     backlog a propósito, para no reenviar eventos viejos en cada login) e inotify,
#     que tampoco guarda lo pasado. Un OOM, un `sudo` fallido o un cambio en
#     /etc/shadow ocurridos durante un retardo NO se recuperan después: serían una
#     ventana ciega de seguridad, justo lo que este script existe para evitar.
#   - smart/units/downloads → SÍ. Son SONDEOS: leen un estado que sigue ahí cuando
#     los mires, así que retrasarlos no pierde nada, solo los aparta del pico de
#     arranque. Son además los caros (smartctl a cada disco; hash + ClamAV a las
#     descargas, que recarga ~200 MB de firmas por invocación).
#
# Segundos, relativos al arranque del script. Se aplican DENTRO de cada función y
# después de sus guardas, para no dejar un `sleep` colgando por un monitor apagado.
DELAY_UNITS=25      # primera pasada solo siembra: no notifica nada, retrasarla es invisible
DELAY_SMART=45      # un disco muriéndose lo sigue estando 45 s después
DELAY_DOWNLOADS=60  # el más caro del script; nada se descarga en el primer minuto de sesión

# ── Escaladas de confianza (allowlist de privEsc) ─────────────────────────────
# GameMode (Feral) escala por pkexec CADA VEZ que un juego arranca y otra vez
# cuando termina: cambia el governor de la CPU (cpugovctl), el split_lock
# (procsysctl) y los relojes de la GPU (gpuclockctl). Son escaladas esperadas y
# frecuentísimas, así que jugar significaba una lluvia de avisos críticos "🔓
# Escalada de privilegios" que enseñaban al usuario a ignorar la categoría
# entera — justo lo contrario de lo que queremos de una alerta de seguridad.
# Se comparan como GLOB (no regex) contra el COMMAND= que loguea pkexec, que
# viene con argumentos: "/usr/lib/gamemode/cpugovctl set performance".
#
# NO se puede exponer esto en security.json: ags/modulos/ajustes/securityPrefs.ts
# reconstruye ese JSON desde cero al guardar, así que una clave añadida a mano
# desaparecería al tocar cualquier switch de la UI. Para añadir excepciones,
# amplía esta lista. Ojo: cada patrón es un agujero permanente en la vigilancia,
# porque una ruta *escribible por el usuario* aquí es una escalada silenciosa.
PRIVESC_ALLOW=(
    '/usr/lib/gamemode/*'
    '/usr/libexec/gamemode/*'
    '/usr/lib/*/gamemode/*'   # multiarch (Debian/Ubuntu)
)

# ¿El comando de este pkexec es una escalada de confianza?
privesc_trusted() {
    local cmd="$1" pat
    [[ -n "$cmd" ]] || return 1
    for pat in "${PRIVESC_ALLOW[@]}"; do
        # shellcheck disable=SC2053  # $pat sin comillas A PROPÓSITO: es un glob.
        [[ "$cmd" == $pat ]] && return 0
    done
    return 1
}

# Lanzador aislado (contención + análisis) que dispara el botón de la notificación.
RUN_UNTRUSTED="$HOME/.config/hypr/scripts/run-untrusted.sh"
# Escaneo a demanda (para archivos grandes que el barrido se salta).
SCAN_FILE="$HOME/.config/hypr/scripts/scan-file.sh"
# Estado "jugando" que escribe AGS (servicios/energia/gamingState.ts) y umbral de ahorro.
RUNTIME_STATE="$HOME/.config/gigios/runtime-state.json"
POWER_CONFIG="$HOME/.config/power-save/config.json"

# Gate compartido de "estoy jugando" (lee ese mismo RUNTIME_STATE). Lo usan los dos
# sub-monitores de SONDEO —monitor_smart y monitor_units— para no competir con un
# juego. Los tres SEGUIDORES de eventos (kernel/system/files) NO lo usan a propósito:
# congelarlos dejaría una ventana ciega de seguridad y no ahorraría nada, porque
# bloqueados en journalctl/inotifywait ya cuestan ~0 % de CPU. monitor_downloads
# mantiene su propia pausa (dlPauseWhileGaming), que es más específica y ya tiene UI.
# Ver lib/gaming-gate.sh para el razonamiento completo.
if ! source "$HOME/.config/hypr/scripts/lib/gaming-gate.sh" 2>/dev/null; then
    gaming_gate_wait() { :; }   # sin la librería, los monitores siguen como siempre
fi

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

# ── Estado de energía (leído del kernel, sin depender de AGS) ──────────────────
# La pila de un PERIFÉRICO no es "el PC va con batería", y confundirlas rompía esto
# en un sobremesa. `/sys/class/power_supply/` no lista solo la batería del portátil:
# aquí el ratón inalámbrico (Logitech G305) aparece como `hidpp_battery_0` y reporta
# `status=Discharging` SIEMPRE — un ratón sin cable siempre tira de su pila. Como las
# dos funciones de abajo recorrían el directorio entero y se quedaban con la primera
# que casara, este sobremesa se creía "a batería" de forma permanente y `_battery_pct`
# devolvía la carga del RATÓN. Con `dlPauseOnBattery` activado eso habría pausado el
# escáner de descargas para siempre, en silencio y sin nada que lo delatara en la UI.
#
# El kernel ya lo distingue: publica `scope=Device` para las pilas de periféricos
# (ratón, teclado, cascos) y `scope=System` —o ningún `scope`, como los BAT0 de
# portátil— para la del equipo. Se filtra también por `type=Battery` para no contar
# el adaptador de corriente (`type=Mains`).
_is_system_battery() {   # $1 = directorio del power_supply
    local dir=$1 scope="" type=""
    [[ -r "$dir/scope" ]] && scope=$(<"$dir/scope")
    [[ "$scope" == Device ]] && return 1          # pila de periférico → no cuenta
    [[ -r "$dir/type" ]] && type=$(<"$dir/type")
    [[ -n "$type" && "$type" != Battery ]] && return 1   # Mains/USB → no es batería
    return 0
}
_on_battery() {   # 0 = con batería (descargando)
    local s
    for s in /sys/class/power_supply/*/status; do
        [[ -r "$s" ]] || continue
        _is_system_battery "${s%/status}" || continue
        [[ "$(<"$s")" == Discharging ]] && return 0
    done
    return 1
}
_battery_pct() {  # imprime el % de la primera batería DEL SISTEMA legible (100 si no hay)
    local c
    for c in /sys/class/power_supply/*/capacity; do
        [[ -r "$c" ]] || continue
        _is_system_battery "${c%/capacity}" || continue
        cat "$c"; return
    done
    echo 100
}

# ¿Debe pausarse el escaneo AUTOMÁTICO de descargas AHORA? Reevalúa condiciones en
# vivo. Los flags de qué-pausa-está-activada (dl_pause_*) los fija _dl_sweep por
# barrido y los ve por ámbito dinámico. Fail-open: si algo no se puede leer, no
# pausa (mejor escanear de más que de menos). El botón de forzado NO llama a esto.
_dl_paused() {
    # Juego: flag que escribe AGS.
    if [[ "${dl_pause_juego:-false}" == true ]]; then
        [[ "$(jq -r '.gaming // false' "$RUNTIME_STATE" 2>/dev/null)" == true ]] && return 0
    fi
    # Batería / ahorro: solo tiene sentido si estás desenchufado.
    if [[ "${dl_pause_bateria:-false}" == true || "${dl_pause_ahorro:-false}" == true ]] && _on_battery; then
        [[ "${dl_pause_bateria:-false}" == true ]] && return 0
        if [[ "${dl_pause_ahorro:-false}" == true ]]; then
            local pct thr
            pct=$(_battery_pct)
            thr=$(jq -r '.thresholdPct // 15' "$POWER_CONFIG" 2>/dev/null)
            [[ "$thr" =~ ^[0-9]+$ ]] || thr=15
            [[ "$pct" =~ ^[0-9]+$ ]] || pct=100
            (( pct <= thr )) && return 0
        fi
    fi
    return 1
}

# ── Disco: de dónde viene un error de E/S ─────────────────────────────────────
# El kernel nombra el bloque de dos formas en las líneas de error de E/S:
#   Buffer I/O error on dev sdb1, logical block 786432, lost async page write
#   blk_update_request: I/O error, dev sdb, sector 6293504 op 0x1:(WRITE)
# Saca "sdb1"/"sdb" (o nvme0n1p2, mmcblk0p1); vacío si la línea no nombra ninguno.
_io_dev() {
    local pat='(on dev|, dev) ([a-zA-Z0-9_-]+)'
    [[ "$1" =~ $pat ]] && printf '%s' "${BASH_REMATCH[2]}"
}

# Partición → disco padre (sdb1→sdb, nvme0n1p2→nvme0n1). Si el nodo aún existe lo
# resolvemos por sysfs; si el dispositivo YA desapareció (el caso que nos importa)
# no queda symlink que seguir, así que caemos al recorte textual del sufijo.
_disk_base() {
    local d=$1 parent
    [[ -e /sys/block/$d ]] && { printf '%s' "$d"; return; }
    if [[ -e /sys/class/block/$d ]]; then
        parent=$(basename "$(readlink -f "/sys/class/block/$d/..")")
        [[ -e /sys/block/$parent ]] && { printf '%s' "$parent"; return; }
    fi
    case "$d" in
        nvme*|mmcblk*|loop*) printf '%s' "${d%p[0-9]*}" ;;
        *)                   printf '%s' "${d%%[0-9]*}" ;;
    esac
}

# ¿Es un disco interno de verdad? Solo entonces un error de E/S significa "tu disco
# está fallando". Dos negativas, ambas necesarias:
#   - el nodo ya no existe → lo arrancaste en caliente; los errores son el rastro de
#     la escritura pendiente que no llegó, no un disco enfermo.
#   - removable=1 (pendrive, SD) → aunque siga enchufado, no es el disco del sistema.
# El nodo puede sobrevivir unos ms al desconecte (udev aún no lo ha retirado), por eso
# no basta con comprobar la existencia: el flag removable cubre esa carrera.
_disk_is_internal() {
    local base=$1
    [[ -n "$base" && -e /sys/block/$base ]] || return 1
    [[ "$(<"/sys/block/$base/removable" 2>/dev/null)" == 1 ]] && return 1
    return 0
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
    # Íd. por dispositivo de bloque: un disco muriéndose (o un pendrive arrancado a
    # medio escribir) suelta decenas de líneas por segundo, una notificación cada una.
    declare -A _io_cooldown

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

            notify-send -h string:x-gigios-source:system -u critical "💀 OOM Killer" "Proceso: $process" -t 10000

        # --- Kernel panic ---
        elif [[ "$sec_kernelPanic" != false ]] && [[ "$lower" == *"kernel panic"* ]]; then
            notify-send -h string:x-gigios-source:system -u critical "💥 Kernel Panic" "El sistema va a reiniciar" -t 0

        # --- Hung task ---
        elif [[ "$sec_hungTask" != false ]] && \
             [[ "$lower" == *"hung_task"* || "$lower" == *"blocked for more than"* ]]; then
            notify-send -h string:x-gigios-source:system -u critical "⚠️ Proceso colgado" "$line" -t 15000

        # --- Error de E/S de disco ---
        #     OJO: no todo "i/o error" es un disco enfermo. Arrancar un pendrive sin
        #     expulsarlo, con escrituras aún en la caché, hace que el kernel escupa un
        #     "Buffer I/O error on dev sdb1 … lost async page write" por cada página que
        #     no llegó — antes cada una de ellas era una crítica "💾 Error de disco".
        #     (Por eso solo pasaba al MOVER archivos: sin nada sucio pendiente, no hay
        #     writeback que fallar y el kernel no loguea nada.) Clasificamos por
        #     dispositivo antes de alarmar.
        elif [[ "$sec_diskError" != false ]] && [[ "$lower" == *"i/o error"* ]]; then
            _dev=$(_io_dev "$line")
            _base=$(_disk_base "$_dev")
            _now=$(date +%s)
            _key="${_base:-desconocido}"

            if (( _now - ${_io_cooldown[$_key]:-0} >= 30 )); then
                _io_cooldown[$_key]=$_now
                if [[ -z "$_base" ]] || _disk_is_internal "$_base"; then
                    # Disco interno (o línea que no nombra dispositivo → no la tragamos).
                    notify-send -h string:x-gigios-source:system -u critical \
                        "💾 Error de disco" "$line" -t 15000
                else
                    # Extraíble: aviso de datos, no de hardware.
                    notify-send -h string:x-gigios-source:system -u normal \
                        "⏏️ Extracción insegura" \
                        "Se quitó ${_dev} con escrituras pendientes. Puede haber archivos incompletos o el sistema de ficheros marcado como sucio. Expúlsalo antes de retirarlo." \
                        -t 12000
                fi
            fi

        # --- Hardware error (MCE / ECC / EDAC) ---
        elif [[ "$sec_hwErrors" != false ]] && \
             [[ "$lower" == *"machine check"* || "$lower" == *"mce:"* || \
                "$lower" == *"hardware error"* || "$lower" == *"edac"* || \
                "$lower" == *"memory error"* ]]; then
            notify-send -h string:x-gigios-source:system -u critical "🧠 Error de hardware" "$line" -t 15000

        # --- Módulo de kernel sin firmar / fuera del árbol (posible rootkit) ---
        elif [[ "$sec_kernelModules" != false ]] && \
             [[ "$lower" == *"tainting kernel"* || "$lower" == *"module verification failed"* || \
                "$lower" == *"loading out-of-tree module"* || "$lower" == *"unsigned module"* ]]; then
            notify-send -h string:x-gigios-source:system -u critical "🧩 Módulo de kernel sin firmar" "$line" -t 15000

        # --- GPU / NVIDIA error ---
        elif [[ "$sec_gpuError" != false ]] && \
             [[ "$lower" == *"nvrm"* || \
                ( "$lower" == *"nvidia"* && "$lower" == *"error"* ) || \
                ( "$lower" == *"gpu"* && "$lower" == *"error"* ) ]]; then
            notify-send -h string:x-gigios-source:system -u critical "🖥️ Error GPU" "$line" -t 15000

        # --- CPU throttling ---
        elif [[ "$sec_cpuThrottling" != false ]] && [[ "$lower" =~ cpu.*throttl ]]; then
            notify-send -h string:x-gigios-source:system -u warning "🌡️ CPU Throttling" "$line" -t 10000

        # --- App crash: segfault ---
        elif [[ "$sec_appCrash" != false ]] && [[ "$lower" == *"segfault"* ]]; then
            app="desconocida"
            pat_seg='kernel: ([^[]+)\[[0-9]+\]: segfault'
            [[ "$line" =~ $pat_seg ]] && app="${BASH_REMATCH[1]}"
            _now=$(date +%s)
            if (( _now - ${_crash_cooldown[$app]:-0} >= 10 )); then
                _crash_cooldown[$app]=$_now
                notify-send -h string:x-gigios-source:system -u critical "App crasheada" "Proceso: $app (segfault)" -t 15000
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
            notify-send -h string:x-gigios-source:system -u warning "⚙️ Servicio fallido" "$line" -t 10000

        # --- Sudo auth failure ---
        elif [[ "$sec_sudoAuth" != false ]] && \
             [[ "$lower" == *"sudo"* && \
                ( "$lower" == *"authentication failure"* || "$lower" == *"incorrect password"* ) ]]; then
            notify-send -h string:x-gigios-source:system -u critical "🔐 Fallo sudo" "Intento fallido de sudo" -t 15000

        # --- Escalada de privilegios (pkexec / su / polkit) ---
        #     pkexec emite DOS líneas por escalada: la de PAM ("session opened",
        #     que NO dice qué se ejecuta) y la de "Executing command [...]
        #     [COMMAND=…]". Avisábamos en ambas: doble notificación, y la de PAM
        #     era además imposible de filtrar por comando. Ahora solo notifica la
        #     de COMMAND, que es la única informativa. No se pierde ninguna
        #     escalada: un pkexec DENEGADO no abre sesión PAM pero sí loguea su
        #     "Not authorized", que esta rama sigue captando.
        elif [[ "$sec_privEsc" != false ]] && \
             [[ "$lower" == *"pkexec"* || \
                ( "$lower" == *"(su:auth)"* && "$lower" == *"authentication failure"* ) || \
                ( "$lower" == *"polkit"* && "$lower" == *"failed to authenticate"* ) ]]; then

            if [[ "$lower" == *"pkexec"* ]]; then
                [[ "$lower" == *"pam_unix(polkit-1:session)"* ]] && continue
                pat_pkexec='\[COMMAND=(.*)\]'
                if [[ "$line" =~ $pat_pkexec ]]; then
                    # Escalada esperada (GameMode al arrancar/cerrar un juego…) → callar.
                    privesc_trusted "${BASH_REMATCH[1]}" && continue
                fi
            fi

            notify-send -h string:x-gigios-source:system -u critical "🔓 Escalada de privilegios" "$line" -t 15000

        # --- SSH events ---
        elif [[ "$sec_ssh" != false ]] && \
             [[ "$lower" == *"sshd"* && \
                ( "$lower" == *"failed password"* || "$lower" == *"accepted"* ) ]]; then
            notify-send -h string:x-gigios-source:system -u warning "🌐 SSH" "$line" -t 15000

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
                notify-send -h string:x-gigios-source:system -u critical "App crasheada" "Proceso: $app (coredump)" -t 15000
            fi

            if [[ "$sec_serviceHealth" != false ]]; then
                _coredump_times+=("$_now")
                pruned=()
                for t in "${_coredump_times[@]}"; do (( _now - t < 60 )) && pruned+=("$t"); done
                _coredump_times=("${pruned[@]}")
                if (( ${#_coredump_times[@]} >= 3 )) && (( _now - _storm_last >= 60 )); then
                    _storm_last=$_now
                    notify-send -h string:x-gigios-source:system -u critical "🌩️ Tormenta de crashes" \
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
        notify-send -h string:x-gigios-source:system -u warning "oom-monitor" \
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
                notify-send -h string:x-gigios-source:system -u critical "🚨 Archivo crítico modificado" \
                    "Archivo: $path" -t 0 ;;
            /etc/sudoers.d/*|/etc/pam.d/*|/etc/cron.d/*|/etc/systemd/system/*|"$HOME"/.config/autostart/*|"$HOME"/.config/systemd/user/*)
                notify-send -h string:x-gigios-source:system -u critical "🚨 Posible persistencia" \
                    "Nuevo/modificado: $path" -t 0 ;;
            "$HOME"/.ssh/authorized_keys|"$HOME"/.ssh/authorized_keys2)
                notify-send -h string:x-gigios-source:system -u critical "🔑 Clave SSH autorizada modificada" \
                    "Archivo: $path" -t 0 ;;
            /boot/*)
                notify-send -h string:x-gigios-source:system -u warning "🥾 Cambio en /boot" \
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

    # Consultar SMART a cada disco despierta el hardware y no corre prisa: el sondeo
    # es horario, así que llegar 45 s tarde solo desplaza el primero. Ver DELAY_*.
    sleep "$DELAY_SMART"

    local warned_perm=false
    declare -A _smart_notified
    local disk dev report

    while :; do
        # Consultar SMART DESPIERTA cada disco físico; con un juego delante eso es un
        # tirón por nada, y la salud de un disco es exactamente igual de mala 20 min
        # después. Retiene, no salta: la pasada se hace al cerrar el juego.
        gaming_gate_wait smart

        while read -r disk; do
            [[ -z "$disk" ]] && continue
            dev="/dev/$disk"
            report=$(smartctl -H -A "$dev" 2>/dev/null)
            if [[ -z "$report" ]]; then
                if [[ "$warned_perm" == false ]]; then
                    warned_perm=true
                    notify-send -h string:x-gigios-source:system -u warning "💽 Salud de disco" \
                        "smartctl no puede leer SMART (¿faltan privilegios?)." -t 10000
                fi
                continue
            fi
            if grep -qiE 'result:[[:space:]]*FAILED|FAILING_NOW' <<< "$report"; then
                if [[ -z "${_smart_notified[$dev]:-}" ]]; then
                    _smart_notified[$dev]=1
                    notify-send -h string:x-gigios-source:system -u critical "💽 Disco a punto de fallar" \
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

    # La primera pasada SOLO siembra `_known` (no notifica, para no avisar de fallos
    # preexistentes), así que retrasarla no retrasa ni un aviso: lo que se aparta del
    # arranque es literalmente trabajo que no informa de nada. Ver DELAY_*.
    sleep "$DELAY_UNITS"

    declare -A _known
    local seeded=false unit scope flag current

    while :; do
        # Se congela mientras juegas, pero SOLO una vez sembrado, y esa condición no
        # sobra: `systemctl --failed` es estado de NIVEL, no de flanco, así que una
        # unidad que caiga durante la partida sigue estando en la lista al reanudar y
        # se avisa entonces (solo se pierde la que caiga Y se recupere dentro del
        # juego). Pero si el gate atrapara la PRIMERA pasada, todo lo que hubiera
        # fallado durante esas horas se sembraría como "preexistente" y no se
        # notificaría NUNCA. La siembra son 4 forks una sola vez: congelarla no
        # ahorra nada y cuesta avisos.
        [[ "$seeded" == true ]] && gaming_gate_wait units

        current=""
        for scope in system user; do
            flag=""
            [[ "$scope" == user ]] && flag="--user"
            while read -r unit; do
                [[ -z "$unit" ]] && continue
                current+="$scope/$unit"$'\n'
                if [[ "$seeded" == true && -z "${_known[$scope/$unit]:-}" ]]; then
                    notify-send -h string:x-gigios-source:system -u critical "⚙️ Servicio en fallo" \
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
# ve cualquier archivo a cualquier profundidad, sin importar cuándo apareció. El
# bucle corre CADA 30 s durante toda la sesión (no solo al arrancar).
#
# ── Deduplicación por CONTENIDO (no por ruta) ─────────────────────────────────
# El esquema viejo (clave ruta|tamaño, append-only, permanente) tenía un fallo
# grave: una vez visto un fichero NO se volvía a analizar JAMÁS, ni tras borrarlo
# y recrearlo, ni tras reiniciar (el estado persistía). Y como no miraba el
# contenido, reemplazar un fichero por otro DISTINTO del mismo tamaño pasaba
# desapercibido. Ahora hay dos estados en ~/.cache/gigios/:
#   • download-index  (mtime|tamaño|ruta por fichero existente) — memo BARATO para
#     saltarse en cada pasada lo que no ha cambiado sin volver a hashear. Se PODA
#     a los ficheros que existen ahora, así no crece sin control.
#   • download-hashes (un hash xxh64 por contenido ya analizado) — memoria de
#     "esto ya lo miré". PERSISTE aunque borres el fichero.
# Regla resultante (justo lo pedido): si el memo mtime|tamaño coincide → no se
# toca. Si cambió (fichero nuevo, editado, o borrado+recreado con otra fecha) se
# calcula el hash del contenido: si ese hash YA se analizó → NO se re-analiza
# (mismo contenido); si es un hash nuevo → SÍ se analiza. Reemplazar por contenido
# distinto = hash distinto = se analiza. Recrear el mismo fichero = mismo hash =
# no se re-analiza. La primera vez (sin estado) siembra sin avisar de ejecutables
# pero SÍ analiza con ClamAV todo lo existente (una alerta de malware no es spam).
#
# ── Recursos, pausas e higiene (ver docs/superpowers/specs/2026-07-11-*) ──────
#   • PRIORIDAD: hashing y ClamAV van bajo `nice -n19 ionice -c3` (idle): ceden
#     CPU/IO ante todo lo demás.
#   • PAUSAS (leídas de security.json EN CADA BARRIDO, sin reiniciar): dlPause
#     InPowerSave / OnBattery / WhileGaming. _dl_paused evalúa en vivo la batería
#     (/sys) y el flag de juego (runtime-state.json que escribe AGS). Si alguna
#     activada está activa → el barrido difiere TODO (no marca nada → se recoge al
#     reanudar). Tope de tamaño dlMaxScanGB también en vivo.
#   • INTERRUMPIBLE: clamscan recarga ~200 MB de firmas por llamada (~13 s), así
#     que NO se trocea. Se lanza UN clamscan sobre todo el lote en 2º plano y se
#     vigila la pausa: si cambia la condición se MATA (latencia ~2 s) y NO se marca
#     nada → el lote se reescanea al reanudar; si termina, se marca todo.
#   • DESCARGAS A MEDIAS: se ignoran los temporales de navegador/gestor (.part,
#     .crdownload, .aria2, .!qB…) Y su nombre base, y todo lo modificado hace
#     <15 s (aún escribiéndose). Un fichero movido fuera a mitad se salta.

# Aviso de un único ejecutable nuevo (con botón "Lanzar aislado" si procede).
download_alert() {
    local f="$1"
    if [[ "$sec_sandboxLaunch" != false && -x "$RUN_UNTRUSTED" ]]; then
        # notify-send --wait -A bloquea hasta el clic/cierre → subshell en 2º plano.
        ( act=$(notify-send -h string:x-gigios-source:system -a "Seguridad" --wait -t 45000 \
            -A "launch=🛡️ Lanzar aislado" -u warning \
            "⬇️ Ejecutable nuevo en Descargas" \
            "$(basename "$f") — verifícalo antes de lanzarlo.")
          [[ "$act" == "launch" ]] && "$RUN_UNTRUSTED" "$f" ) &
    else
        notify-send -h string:x-gigios-source:system -u warning "⬇️ Ejecutable nuevo en Descargas" \
            "$(basename "$f") — verifícalo antes de lanzarlo." -t 12000
    fi
}

monitor_downloads() {
    [[ "$sec_downloadScan" == false ]] && return
    command -v find >/dev/null 2>&1 || return

    # El más caro del arranque: el primer `_dl_sweep` recorre Descargas entera y, ante
    # cualquier fichero nuevo, lo hashea y lo pasa por ClamAV — que recarga ~200 MB de
    # firmas en CADA invocación. Con el estado ya sembrado de sesiones anteriores el
    # barrido acierta en el memo y sale barato, pero el caso malo (una descarga nueva
    # desde el último login) coincidía de lleno con la carga del escritorio. No se
    # pierde nada: `find` ve el fichero igual dentro de un minuto. Ver DELAY_*.
    sleep "$DELAY_DOWNLOADS"

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
    # --max-filesize/--max-scansize: SIN esto clamscan SALTA (y asume limpios) los
    # ficheros > MaxFileSize (100 MB por defecto) → falso negativo. Los subimos al
    # tope que clamscan admite (2 GiB-1). Solo aplican a clamscan; clamdscan usa la
    # config del daemon (clamd.conf). La clasificación ya no manda a clamscan nada
    # ≥ clam_max (2 GiB-1), así que este tope siempre cubre lo que se le envía.
    local clam=()
    if command -v clamscan >/dev/null 2>&1; then
        clam=(clamscan --no-summary --max-filesize=2147483647 --max-scansize=2147483647)
    elif command -v clamdscan >/dev/null 2>&1; then
        clam=(clamdscan --fdpass --no-summary)
    fi
    # scan_max (tope de auto-análisis) es DINÁMICO: se recalcula en cada barrido
    # desde dlMaxScanGB de security.json (aplica sin reiniciar). Ver _dl_sweep.

    # Prioridad baja para hashing y ClamAV: ceden CPU/IO ante el resto del sistema.
    local -a lowprio=()
    command -v nice   >/dev/null 2>&1 && lowprio+=(nice -n 19)
    command -v ionice >/dev/null 2>&1 && lowprio+=(ionice -c 3)

    # Hash de contenido: xxh64sum es rapidísimo (varios GB/s); si no está, caemos a
    # sha1/md5. Solo se calcula cuando mtime|tamaño cambió, así que en régimen
    # normal casi nunca se hashea nada.
    local hasher=""
    for cand in xxh64sum xxhsum sha1sum md5sum; do
        command -v "$cand" >/dev/null 2>&1 && { hasher="$cand"; break; }
    done

    local cache="$HOME/.cache/gigios"
    local idx_file="$cache/download-index"     # mtime|tamaño|ruta (podado)
    local hash_file="$cache/download-hashes"   # hashes ya analizados (persistente)
    mkdir -p "$cache" 2>/dev/null
    # Limpieza única del estado viejo (clave ruta|tamaño, append-only, 6 MB).
    rm -f "$cache/download-seen" 2>/dev/null

    declare -A _idx      # ruta -> "mtime|tamaño"  (memo barato, persiste entre barridos)
    declare -A _scanned  # hash -> 1              (contenido ya analizado, persistente)
    # ruta -> "mtime|tamaño" del último aviso de "ejecutable nuevo" dado por ESTE
    # proceso. Solo en RAM y a propósito. Hace falta porque cuando clamscan sale con
    # error NO se marca `_idx` —para que el análisis se reintente en cuanto haya
    # firmas— y, sin freno, el mismo .exe volvería a caer en `new_exec` en CADA
    # barrido: un aviso cada 5 min (la red de seguridad de inotify), para siempre.
    # En el camino sano no hace nada: ahí `_idx` ya salta el fichero. Va por firma,
    # no por ruta, para que un fichero MODIFICADO sí vuelva a avisar.
    declare -A _alerted
    # Persistente ENTRE barridos (lo ve _dl_sweep por ámbito dinámico, como `seeded`):
    # el aviso de "sin firmas" se da una vez por proceso, no una por descarga.
    local _dl_warned_engine=false
    local seeded=false line mtime rest sz f

    # Cargar estado. Índice: formato mtime|tamaño|ruta (la ruta puede llevar '|',
    # por eso troceamos a mano y todo lo que sobra tras el 2º '|' es la ruta).
    if [[ -f "$idx_file" ]]; then
        seeded=true
        while IFS= read -r line; do
            mtime="${line%%|*}"; rest="${line#*|}"
            sz="${rest%%|*}";    f="${rest#*|}"
            [[ -n "$f" ]] && _idx["$f"]="$mtime|$sz"
        done < "$idx_file"
    fi
    [[ -f "$hash_file" ]] && while IFS= read -r line; do
        [[ -n "$line" ]] && _scanned["$line"]=1
    done < "$hash_file"

    # ¿Es un temporal de descarga en curso (navegador/gestor)?
    _dl_is_temp() {
        case "${1,,}" in
            *.part|*.crdownload|*.download|*.opdownload|*.partial|*.tmp|*.temp|\
            *.aria2|*.!qb|*.!ut|*.bc!|*.crswap) return 0 ;;
        esac
        return 1
    }

    # Un barrido completo, por fases (ver cabecera). Ve el estado persistente
    # (_idx/_scanned/seeded/dir/clam/lowprio/hasher…) por ámbito dinámico y muta
    # _idx/_scanned/seeded. Se invoca por evento (inotify) y por la red de seguridad.
    _dl_sweep() {
        # ── Config en vivo (relee cada barrido → aplica sin reiniciar) ──────────
        local dl_pause_ahorro=false dl_pause_bateria=false dl_pause_juego=false maxgb=1
        if command -v jq >/dev/null 2>&1 && [[ -f "$SEC_CONFIG" ]]; then
            dl_pause_ahorro=$(jq -r '.dlPauseInPowerSave // false' "$SEC_CONFIG" 2>/dev/null)
            dl_pause_bateria=$(jq -r '.dlPauseOnBattery // false'  "$SEC_CONFIG" 2>/dev/null)
            # Esta viene ACTIVADA por defecto (las otras dos no): es la mitad más cara
            # del modo juego. Y NO puede escribirse `// true`: el operador // de jq
            # trata un `false` literal como ausente, así que apagar la pausa desde la
            # UI no habría servido de nada — el script la seguiría leyendo activada.
            dl_pause_juego=$(jq -r 'if has("dlPauseWhileGaming") then (.dlPauseWhileGaming|tostring) else "true" end' \
                                                                   "$SEC_CONFIG" 2>/dev/null)
            maxgb=$(jq -r '.dlMaxScanGB // 1'                      "$SEC_CONFIG" 2>/dev/null)
        fi
        local scan_max
        scan_max=$(awk -v g="$maxgb" 'BEGIN{v=g*1073741824; if(v<1)v=1073741824; printf "%d", v}')
        # Techo real del auto-análisis = min(tope usuario, 2 GiB-1 que es lo máximo
        # que clamscan escanea). Lo que pase de ahí va a "archivo grande" (aviso),
        # no a clamscan, para que no lo salte y lo dé por limpio.
        local clam_max=$scan_max
        (( clam_max > 2147483647 )) && clam_max=2147483647

        # Puerta: si alguna pausa activada está activa AHORA, difiere TODO (no
        # hashea, no escanea, no avisa). El siguiente evento / red de seguridad
        # reintenta; nada se marca → lo pendiente se recoge al reanudar.
        _dl_paused && return

        local -a scan_batch=() big_files=() new_exec=() all=() present=()
        local rc=0 engine_ok=true   # rc/estado del clamscan del lote (ver Fase B)
        local -A _now _bhash tempbase
        local changed=false f sig sz h mtime now mb lf out pid killed line vfile vsig
        now=$(date +%s)
        local settle=15   # s: no tocar lo modificado hace <settle (aún escribiéndose)

        # ── Fase A.1: recolectar rutas y marcar temporales (+ su nombre base) ───
        while IFS= read -r f; do
            all+=("$f")
            _dl_is_temp "$f" && tempbase["${f%.*}"]=1
        done < <(find "$dir" -type f 2>/dev/null)

        # ── Fase A.2: clasificar (barato: solo stat + hash de lo nuevo) ─────────
        for f in "${all[@]}"; do
            [[ -f "$f" ]] || continue
            _dl_is_temp "$f" && continue                 # el propio temporal
            [[ -n "${tempbase[$f]:-}" ]] && continue     # final mientras exista su temp
            sig=$(stat -c '%Y|%s' "$f" 2>/dev/null) || continue
            _now["$f"]=1
            mtime="${sig%%|*}"; sz="${sig#*|}"
            (( now - mtime < settle )) && continue       # aún escribiéndose → luego
            [[ "${_idx[$f]:-}" == "$sig" ]] && continue  # sin cambios → saltar

            if (( ${#clam[@]} && sz > 0 && sz < clam_max )) && [[ -n "$hasher" ]]; then
                h=$("${lowprio[@]}" "$hasher" -- "$f" 2>/dev/null); h="${h%% *}"
                if [[ -n "$h" && -n "${_scanned[$h]:-}" ]]; then
                    _idx["$f"]="$sig"; changed=true       # contenido conocido → marcar y saltar
                    continue
                fi
                scan_batch+=("$f"); [[ -n "$h" ]] && _bhash["$f"]="$h"
                # Un aviso por fichero y proceso (ver `_alerted`): este es el único
                # camino que puede repetirse, porque con el motor roto no se marca _idx.
                if [[ "$seeded" == true ]] && is_runnable "$f" && [[ "${_alerted[$f]:-}" != "$sig" ]]; then
                    _alerted["$f"]="$sig"; new_exec+=("$f")
                fi
            elif (( ${#clam[@]} && sz >= clam_max )); then
                _idx["$f"]="$sig"; changed=true           # grande: avisar y marcar (no cada vez)
                [[ "$seeded" == true ]] && big_files+=("$f")
                [[ "$seeded" == true ]] && is_runnable "$f" && new_exec+=("$f")
            else
                _idx["$f"]="$sig"; changed=true           # sin clam/hasher: solo aviso de exe
                [[ "$seeded" == true ]] && is_runnable "$f" && new_exec+=("$f")
            fi
        done

        # Podar del índice lo que ya no existe (no crece sin límite; un fichero
        # borrado+recreado vuelve a evaluarse).
        for f in "${!_idx[@]}"; do
            [[ -n "${_now[$f]:-}" ]] || { unset '_idx[$f]'; changed=true; }
        done

        # Archivos demasiado grandes para el auto-análisis: aviso con botón.
        for f in "${big_files[@]}"; do
            mb=$(( $(stat -c%s "$f" 2>/dev/null || echo 0) / 1048576 ))
            if [[ -x "$SCAN_FILE" ]]; then
                ( act=$(notify-send -h string:x-gigios-source:system -a "Seguridad" --wait -t 45000 \
                    -A "scan=🔍 Escanear igualmente" -u warning \
                    "⬇️ Archivo grande sin analizar" \
                    "$(basename "$f") (${mb} MB) supera el tope de auto-análisis. Escanéalo aquí o en Ajustes › Seguridad.")
                  [[ "$act" == "scan" ]] && "$SCAN_FILE" "$f" ) &
            else
                notify-send -h string:x-gigios-source:system -u warning "⬇️ Archivo grande sin analizar" \
                    "$(basename "$f") (${mb} MB) — escanéalo desde Ajustes › Seguridad." -t 12000
            fi
        done

        # Aviso de ejecutables nuevos. ≤4 → individual con botón; más → resumen.
        if (( ${#new_exec[@]} )); then
            if (( ${#new_exec[@]} <= 4 )); then
                for f in "${new_exec[@]}"; do download_alert "$f"; done
            else
                notify-send -h string:x-gigios-source:system -u warning "⬇️ ${#new_exec[@]} ejecutables nuevos en Descargas" \
                    "En $(basename "$(dirname "${new_exec[0]}")")/ y otros. Revísalos antes de ejecutarlos (juego, instalador o crack)." -t 15000
            fi
        fi

        # ── Fase B: análisis antivirus, UNA invocación en 2º plano, interrumpible ─
        # clamscan recarga ~200 MB de firmas EN CADA llamada (~13 s), así que NO se
        # trocea: se lanza UN clamscan --file-list sobre todo el lote (una sola carga
        # de BD). Se corre en 2º plano y se vigila la pausa: si entras en juego/ahorro
        # a mitad, se MATA (latencia ~2 s) y NO se marca nada → se reescanea al
        # reanudar. Si termina solo, se marca todo. Antes se filtra a lo que aún
        # existe (movido fuera de Descargas).
        for f in "${scan_batch[@]}"; do [[ -f "$f" ]] && present+=("$f"); done
        if (( ${#present[@]} )); then
            killed=false
            lf=$(mktemp); out=$(mktemp)
            printf '%s\n' "${present[@]}" > "$lf"
            "${lowprio[@]}" "${clam[@]}" --file-list="$lf" > "$out" 2>/dev/null &
            pid=$!
            while kill -0 "$pid" 2>/dev/null; do
                if _dl_paused; then kill "$pid" 2>/dev/null; killed=true; break; fi
                sleep 2
            done
            wait "$pid" 2>/dev/null; rc=$?
            # ── El motor, ¿ha analizado algo siquiera? ────────────────────────
            # Códigos de clamscan: 0 = limpio, 1 = virus encontrado, 2 = ERROR (sin
            # base de firmas, permisos, fichero ilegible). Un 2 NO es "limpio", y
            # tratarlo como tal era un agujero de verdad: `2>/dev/null` se come el
            # "No supported database files found", no hay líneas FOUND que leer, y el
            # lote caía en la rama de "terminó bien" → se marcaba como analizado. Como
            # el memo va por hash de CONTENIDO y es PERMANENTE, esos ficheros no se
            # volverían a analizar NUNCA — ni después de instalar las firmas. Con la
            # DB vacía (recién instalado ClamAV, `freshclam` sin ejecutar) eso convertía
            # el escáner en un sello de "analizado" que no analiza nada. Ahora un 2 no
            # marca: el lote se reintenta cuando haya motor. Se avisa UNA vez por
            # proceso (mismo patrón que `warned_perm` en monitor_smart): esto se dispara
            # en cada barrido y sin el freno sería una notificación por descarga.
            if (( rc == 2 )); then
                engine_ok=false
                if [[ "$_dl_warned_engine" == false ]]; then
                    _dl_warned_engine=true
                    notify-send -h string:x-gigios-source:system -u critical \
                        "🛡️ Antivirus sin base de firmas" \
                        "ClamAV no puede analizar las descargas. Ejecuta 'sudo freshclam' (o activa clamav-freshclam.service). Hasta entonces NO se dan por analizadas." -t 0
                fi
            else
                engine_ok=true
            fi
            # Avisar de lo detectado (aunque se cortara: lo ya escaneado cuenta).
            while IFS= read -r line; do
                [[ "$line" == *" FOUND" ]] || continue     # "/ruta: Firma FOUND"
                vfile="${line%%: *}"
                vsig="${line##*: }"; vsig="${vsig% FOUND}"
                notify-send -h string:x-gigios-source:system -u critical "🦠 Malware detectado en Descargas" \
                    "$(basename "$vfile"): $vsig — NO lo ejecutes. Ruta: $vfile" -t 0
            done < "$out"
            # Marcar índice + hash del CONTENIDO SOLO si terminó (no cortado) Y el motor
            # funcionaba: un infectado que se queda avisa UNA vez y recrear el mismo
            # contenido no se re-analiza; si se cortó —o si clamscan salió con error—
            # nada se marca → el lote se reescanea al reanudar (o al haber firmas).
            if [[ "$killed" == false && "$engine_ok" == true ]]; then
                for f in "${present[@]}"; do
                    sig=$(stat -c '%Y|%s' "$f" 2>/dev/null) || continue
                    _idx["$f"]="$sig"; changed=true
                    h="${_bhash[$f]:-}"
                    [[ -n "$h" && -z "${_scanned[$h]:-}" ]] && { _scanned["$h"]=1; printf '%s\n' "$h" >> "$hash_file"; }
                done
            fi
            rm -f "$lf" "$out"
        fi

        # Persistir el índice (reescritura atómica) solo si cambió algo.
        if [[ "$changed" == true ]]; then
            { for f in "${!_idx[@]}"; do printf '%s|%s\n' "${_idx[$f]}" "$f"; done; } \
                > "$idx_file.tmp" 2>/dev/null && mv -f "$idx_file.tmp" "$idx_file" 2>/dev/null
        fi

        # Válvula de seguridad de download-hashes (append-only, ~17 B/entrada): si
        # supera 10 MB, conservar solo las 100 más recientes (por ser append-only,
        # son las 100 últimas líneas) y reconstruir la memoria para dejar fichero y
        # RAM consistentes. A 10 MB esto tarda años; es un tope duro, no rutina.
        local hsz
        hsz=$(stat -c%s "$hash_file" 2>/dev/null || echo 0)
        if (( hsz > 10485760 )); then
            tail -n 100 "$hash_file" > "$hash_file.tmp" 2>/dev/null && mv -f "$hash_file.tmp" "$hash_file"
            _scanned=()
            while IFS= read -r h; do [[ -n "$h" ]] && _scanned["$h"]=1; done < "$hash_file"
        fi

        seeded=true
    }

    # ── Bucle dirigido por eventos ────────────────────────────────────────────
    # inotify actúa de DESPERTADOR, no de escáner: al despertar barremos con find,
    # así da igual que inotify se pierda subcarpetas nuevas o descarte eventos bajo
    # avalancha (el barrido lo ve todo). En reposo el proceso queda BLOQUEADO en
    # inotifywait — cero CPU/IO, sin sondear cada 30 s. Latencia típica ~debounce s.
    local debounce=3 safety=300 rc t0
    local -a ev=(-e create -e close_write -e moved_to -e moved_from -e delete)

    _dl_sweep   # primer barrido inmediato (siembra y caza lo ya existente)

    if command -v inotifywait >/dev/null 2>&1; then
        while :; do
            # Bloquea hasta un evento en Descargas, o hasta `safety` s (red de
            # seguridad por si inotify se queda corto: overflow, watch fallido…).
            inotifywait -q -r -t "$safety" "${ev[@]}" "$dir" >/dev/null 2>&1
            rc=$?
            if (( rc == 0 )); then
                # Debounce: agrupa la avalancha (extraer un juego = miles de eventos)
                # esperando `debounce` s de calma, con tope de 30 s para no quedarnos
                # sin barrer si algo escribe sin parar (descarga larga, torrent…).
                t0=$SECONDS
                while inotifywait -q -r -t "$debounce" "${ev[@]}" "$dir" >/dev/null 2>&1; do
                    (( SECONDS - t0 >= 30 )) && break
                done
            elif (( rc == 1 )); then
                # Error de inotify (límite de watches, dir recreado…): degradamos a
                # poll suave para no hacer busy-loop, pero seguimos barriendo.
                sleep 30
            fi
            # rc==2 (timeout de la red de seguridad) → barrido directo.
            _dl_sweep
        done
    else
        # Sin inotify-tools: poll clásico de 30 s (comportamiento anterior).
        while :; do sleep 30; _dl_sweep; done
    fi
}

# ── Run in parallel ───────────────────────────────────────────────────────────
# Los tres primeros enganchan YA (journal/inotify no guardan lo pasado: llegar tarde
# = ventana ciega). Los tres de sondeo se apartan del pico de arranque por dentro,
# cada uno con su DELAY_* — ver el bloque "Escalonado de arranque" arriba.
monitor_kernel &
monitor_system &
monitor_files &
monitor_smart &
monitor_units &
monitor_downloads &
wait
