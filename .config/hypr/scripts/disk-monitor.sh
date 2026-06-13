#!/usr/bin/env bash
# Disk space monitor daemon — notifies when free space drops below WARN_GB.
# Only monitors partitions with at least MIN_GB total (checked once at startup).
# Deduplicates by device so btrfs subvolumes don't fire multiple times.

POLL_INTERVAL=60
WARN_GB=5
COOL_GB=6    # must recover above this to re-arm
MIN_GB=6     # partitions smaller than this are ignored entirely

WARN_BYTES=$(( WARN_GB * 1024 * 1024 * 1024 ))
COOL_BYTES=$(( COOL_GB * 1024 * 1024 * 1024 ))
MIN_BYTES=$(( MIN_GB  * 1024 * 1024 * 1024 ))

# --- build watch list once at startup ---
declare -A watch_mount   # device -> mount point label
declare -A disk_alerted  # device -> true/false

while IFS= read -r line; do
    dev=$(awk '{print $1}' <<< "$line")
    mnt=$(awk '{print $2}' <<< "$line")
    size=$(awk '{print $3}' <<< "$line")

    # skip already-seen devices (dedup btrfs subvolumes — keep first/shortest path)
    [ -n "${watch_mount[$dev]}" ] && continue

    if [ "$size" -ge "$MIN_BYTES" ]; then
        watch_mount[$dev]=$mnt
        disk_alerted[$dev]=false
    fi
done < <(df -B1 --output=source,target,size -x tmpfs -x devtmpfs -x efivarfs 2>/dev/null | tail -n +2)

if [ "${#watch_mount[@]}" -eq 0 ]; then
    echo "disk-monitor: no partitions meet the ${MIN_GB}GB minimum — exiting." >&2
    exit 1
fi

send_notif() {
    notify-send \
        --app-name="Disco" \
        --urgency="$1" \
        --icon="$2" \
        --expire-time=15000 \
        "$3" "$4"
}

bytes_to_human() {
    local b=$1
    if [ "$b" -ge $(( 1024 * 1024 * 1024 )) ]; then
        awk "BEGIN{printf \"%.1f GB\", $b/1024/1024/1024}"
    else
        awk "BEGIN{printf \"%.0f MB\", $b/1024/1024}"
    fi
}

while true; do
    while IFS= read -r line; do
        dev=$(awk '{print $1}' <<< "$line")
        avail=$(awk '{print $2}' <<< "$line")

        [ -z "${watch_mount[$dev]}" ] && continue

        mnt=${watch_mount[$dev]}
        alerted=${disk_alerted[$dev]}
        avail_human=$(bytes_to_human "$avail")

        if [ "$avail" -lt "$WARN_BYTES" ] && [ "$alerted" = false ]; then
            send_notif critical drive-harddisk \
                "Disco casi lleno: $mnt" \
                "Solo quedan ${avail_human} libres en ${mnt}. Libera espacio."
            disk_alerted[$dev]=true

        elif [ "$avail" -ge "$COOL_BYTES" ] && [ "$alerted" = true ]; then
            send_notif normal drive-harddisk \
                "Disco normalizado: $mnt" \
                "${avail_human} libres en ${mnt}."
            disk_alerted[$dev]=false
        fi

    done < <(df -B1 --output=source,avail -x tmpfs -x devtmpfs -x efivarfs 2>/dev/null | tail -n +2)

    sleep "$POLL_INTERVAL"
done
