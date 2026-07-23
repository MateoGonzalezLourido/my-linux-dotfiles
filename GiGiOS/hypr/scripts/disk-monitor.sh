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

send_notif() {
    notify-send -h string:x-gigios-source:system \
        --app-name="Disco" \
        --urgency="$1" \
        --icon="drive-harddisk" \
        --expire-time=15000 \
        "$2" "$3"
}

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
        send_notif critical \
            "Disco casi lleno: $mnt" \
            "Solo quedan $(bytes_to_human "$avail") libres en ${mnt}. Libera espacio."
    fi
done < <(df -B1 --output=source,target,size,avail -x tmpfs -x devtmpfs -x efivarfs 2>/dev/null | tail -n +2)
