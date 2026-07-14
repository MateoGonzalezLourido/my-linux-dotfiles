#!/usr/bin/env bash
# Reparación de un volumen extraíble sucio — invocado desde el botón "Reparar" de
# la notificación de usb-monitor.sh, o a mano: usb-repair.sh /dev/sdb1
#
# NO llamamos a fsck/ntfsfix nosotros. Van a un dispositivo root:disk 660, así que
# harían falta privilegios, y escalarlos desde aquí sería un agujero: este script
# vive en ~/.config (escribible por el usuario), y meterlo en la PRIVESC_ALLOW de
# oom-monitor.sh sería exactamente la escalada silenciosa contra la que avisa
# CLAUDE.md. En su lugar usamos org.freedesktop.UDisks2.Filesystem.Repair: el
# trabajo privilegiado lo hace udisksd (servicio del sistema, ya auditado) y
# polkit lo autoriza — modify-device es allow_active=yes para dispositivos que no
# son del sistema, así que en un USB no hay prompt; en un disco interno sí lo
# habría (modify-device-system: auth_admin_keep), que es justo lo que queremos.
#
# Repair delega en la herramienta de cada fs (e2fsck, fsck.fat, fsck.exfat,
# ntfsfix…). Si falta la del fs en cuestión, udisks devuelve error y lo decimos:
# en esta máquina NTFS necesita el paquete `ntfs-3g`, que no está instalado.
set -uo pipefail

APP="USB"
notify() { notify-send -h string:x-gigios-source:system -a "$APP" "$@"; }

dev=${1:-}
[[ -z "$dev" ]] && { echo "uso: $0 /dev/sdXN" >&2; exit 2; }
part=$(basename "$dev")
dev="/dev/$part"

[[ -b "$dev" ]] || { notify -u critical "Reparar: no existe $dev" "El volumen ya no está conectado."; exit 1; }

obj="/org/freedesktop/UDisks2/block_devices/$part"
fstype=$(lsblk -dno FSTYPE "$dev" 2>/dev/null)
label=$(lsblk -dno LABEL "$dev" 2>/dev/null); : "${label:=$part}"

# Reparar exige el volumen desmontado. Lo desmontamos si hace falta (sin -f: si
# hay ficheros abiertos preferimos fallar y que el usuario cierre, no arriesgar).
if grep -q "^$dev " /proc/mounts; then
    if ! err=$(udisksctl unmount -b "$dev" --no-user-interaction 2>&1); then
        notify -u critical -t 15000 "🔧 No se pudo reparar" \
            "Hay que desmontar «$label» y está en uso: ${err##*: }"
        exit 1
    fi
fi

notify -u low -t 5000 "🔧 Reparando «$label»…" "Se retiró sin expulsar. Sistema de ficheros: ${fstype:-desconocido}"

if out=$(busctl --system call org.freedesktop.UDisks2 "$obj" \
            org.freedesktop.UDisks2.Filesystem Repair 'a{sv}' 0 2>&1); then
    # Devuelve "b true" si el fs quedó consistente.
    if [[ "$out" == *"true"* ]]; then
        # En NTFS no mentimos: `ntfsfix` (lo que udisks ejecuta) NO es un chkdsk. Su
        # propio man dice que repara inconsistencias fundamentales, resetea el journal
        # y PROGRAMA la comprobación de verdad para el primer arranque de Windows. El
        # volumen queda usable ya; conviene saber que Windows lo revisará.
        extra="Ya puedes usarlo."
        [[ "$fstype" == ntfs* ]] && extra="Ya puedes usarlo. Windows hará una comprobación completa la próxima vez que lo montes ahí."
        notify -u normal -t 10000 "✅ Volumen reparado" "«$label» ($fstype). $extra"
    else
        notify -u critical -t 15000 "⚠️ Reparación incompleta" \
            "«$label» sigue con errores. Haz copia de lo que puedas leer y considera formatearlo."
    fi
    exit 0
fi

# --- Error de udisks: el caso común es que falte la herramienta del fs ---------
hint=""
case "$fstype" in
    # OJO: el paquete es «ntfsprogs», NO «ntfs-3g» — el segundo hoy solo trae el
    # driver FUSE; las utilidades (ntfsfix) se separaron a ntfsprogs.
    ntfs*) command -v ntfsfix >/dev/null 2>&1 || hint="\nInstala «ntfsprogs» para poder reparar NTFS." ;;
    vfat|fat*) command -v fsck.fat  >/dev/null 2>&1 || hint="\nInstala «dosfstools»." ;;
    exfat) command -v fsck.exfat >/dev/null 2>&1 || hint="\nInstala «exfatprogs»." ;;
esac
notify -u critical -t 20000 "🔧 No se pudo reparar «$label»" "${out##*: }${hint}"
exit 1
