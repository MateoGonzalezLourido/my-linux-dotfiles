#!/usr/bin/env bash
# Disk space check — one-shot. Runs once at startup (gigios/autostart.lua), warns if
# any real partition is below WARN_GB, then exits. No daemon, no polling, no
# background process: running low on disk is a once-a-year event, and free
# space has no event source anyway, so a single login-time check is the right
# cost/benefit — it stays at literally zero resources the rest of the session.
#
# Only partitions with at least MIN_GB total are considered, and devices are
# deduplicated (btrfs subvolumes report the same device under many mounts).

WARN_GB=5
MIN_GB=6   # partitions smaller than this are ignored entirely

WARN_BYTES=$(( WARN_GB * 1024 * 1024 * 1024 ))
MIN_BYTES=$(( MIN_GB  * 1024 * 1024 * 1024 ))

NOTIF_APP="Disco"
# shellcheck source=lib/notif.sh
if ! source "$HOME/.config/hypr/scripts/lib/notif.sh" 2>/dev/null; then
    # Sin la librería se pierde la IDENTIDAD del aviso (deja de poder configurarse por
    # separado en Ajustes > Notificaciones > Sistema), pero NO el aviso: eso sería peor.
    notificar() {
        shift
        local -a _a=(); [[ -n "${NOTIF_APP:-}" ]] && _a=(-a "$NOTIF_APP")
        notify-send -h string:x-gigios-source:system "${_a[@]}" "$@"
    }
fi

send_notif() {
    notificar "$1" \
        --urgency="$2" \
        --icon="drive-harddisk" \
        --expire-time=15000 \
        "$3" "$4"
}

# El barrido de `df` es una sola pasada, así que es también el lote: con dos o tres
# sistemas de ficheros al límite (típico con / y /home separados, o varios discos)
# salía un popup por cada uno diciendo lo mismo. Se encolan y se vuelca al terminar
# el bucle, sin retrasar nada.
#
# El punto de montaje pasa del TÍTULO al cuerpo ("Disco casi lleno: /home" → "Disco
# casi lleno" + "…libres en /home"): un título fijo es lo que permite que dos discos
# se fundan en "2 discos casi llenos", y el dato no se pierde, solo cambia de sitio.
if ! source "$HOME/.config/hypr/scripts/lib/notif-agrupar.sh" 2>/dev/null; then
    notif_grupo()   { :; }
    notif_encolar() { send_notif disco.casi-lleno critical "Disco casi lleno" "$2"; }
    notif_volcar()  { :; }
fi
notif_grupo lleno disco.casi-lleno critical 15000 "Disco casi lleno" "discos casi llenos" \
    "" "" "--icon=drive-harddisk"

# Pure bash formatting (one-decimal GB / whole MB) — no awk fork.
bytes_to_human() {
    local b=$1 gb=$((1024 * 1024 * 1024)) mb=$((1024 * 1024))
    if (( b >= gb )); then
        local whole=$(( b / gb )) tenths=$(( ((b % gb) * 10 + gb / 2) / gb ))
        if (( tenths == 10 )); then whole=$(( whole + 1 )); tenths=0; fi
        echo "${whole}.${tenths} GB"
    else
        echo "$(( b / mb )) MB"
    fi
}

declare -A seen  # device -> 1, to dedup btrfs subvolumes

while read -r dev mnt size avail; do
    # skip already-seen devices (keep the first/shortest mount path)
    [[ -n "${seen[$dev]:-}" ]] && continue
    (( size >= MIN_BYTES )) || continue
    seen[$dev]=1

    if (( avail < WARN_BYTES )); then
        notif_encolar lleno "Solo quedan $(bytes_to_human "$avail") libres en ${mnt}. Libera espacio."
    fi
done < <(df -B1 --output=source,target,size,avail -x tmpfs -x devtmpfs -x efivarfs 2>/dev/null | tail -n +2)
notif_volcar
