#!/usr/bin/env bash
# USB monitor — avisa de conexión/desconexión de dispositivos y, si son de
# almacenamiento, ofrece expulsarlos con seguridad y reparar el volumen si viene
# sucio.
#
# Totalmente dirigido por eventos: `udevadm monitor` bloquea en el socket de
# uevents del kernel/udev, cero polling. Con --property las propiedades llegan
# dentro del propio evento, así que no hay un `udevadm info` extra por dispositivo;
# el único fork por evento real es notify-send (y los subshells de los botones).
#
# ── Dos subsistemas, un solo stream ───────────────────────────────────────────
# Escuchamos `usb` (el dispositivo físico) y `block` (el disco/particiones que
# expone si es almacenamiento). Un pendrive genera AMBOS, así que sin cuidado
# saldrían dos popups por enchufe. Regla: si el dispositivo USB es de la clase
# "mass storage", el aviso genérico se CALLA y habla el evento de bloque, que
# sabe el modelo, el sistema de ficheros y puede ofrecer "Expulsar".
#
# La clase se lee de ID_USB_INTERFACES (p.ej. ":080650:"), donde cada interfaz son
# 6 dígitos y 08 es mass-storage. Como las entradas son de largo fijo y van entre
# ':', buscar ":08" solo puede casar al principio de una entrada. Si la propiedad
# no viniera (udev antiguo), no se calla nada: se degrada al comportamiento de
# siempre (un aviso genérico) en vez de perder la notificación.
#
# DEVTYPE=usb_device (vs. usb_interface) es la forma canónica de udev de distinguir
# el dispositivo físico de sus sub-nodos por interfaz.

EJECT="$HOME/.config/hypr/scripts/usb-eject.sh"
REPAIR="$HOME/.config/hypr/scripts/usb-repair.sh"

subsystem=""; action=""; devtype=""; devname=""
vendor=""; model=""; ifaces=""; bus=""; fstype=""; fslabel=""

reset_event() {
    subsystem=""; action=""; devtype=""; devname=""
    vendor=""; model=""; ifaces=""; bus=""; fstype=""; fslabel=""
}

notify_usb() {
    local verb=$1
    local label="${vendor:+$vendor }${model:-dispositivo desconocido}"
    notify-send -h string:x-gigios-source:system -u normal "USB $verb" "$label" -t 8000
}

# Aviso de almacenamiento conectado, con botón de expulsión segura.
# notify-send --wait -A bloquea hasta el clic/cierre → subshell en 2º plano, mismo
# idiom que download_alert() en oom-monitor.sh.
notify_storage() {
    local disk=$1 name=$2
    ( act=$(notify-send -h string:x-gigios-source:system -a "USB" --wait -t 20000 \
              -u normal -A "eject=⏏️ Expulsar" \
              "💾 Almacenamiento USB conectado" \
              "$name — expúlsalo antes de retirarlo para no perder datos.")
      [[ "$act" == "eject" ]] && [[ -x "$EJECT" ]] && "$EJECT" "$disk" ) &
}

# ¿Viene el volumen sucio (se retiró sin expulsar, aquí o en otra máquina)?
# Si lo está, SE REPARA SOLO. No hay botón que pulsar en el camino normal.
#
# Preguntamos a udisks (Filesystem.Check), no a fsck: el trabajo privilegiado lo
# hace udisksd y polkit lo autoriza sin prompt en dispositivos que no son del
# sistema (modify-device → allow_active=yes). Es de solo lectura.
#
# Check exige el volumen DESMONTADO, así que si algo ya lo montó nos callamos: no
# hay forma segura de comprobarlo y no vamos a desmontar por la cara. Cualquier
# error (fs no soportado, falta la herramienta —NTFS necesita ntfsprogs—) también es
# silencio: esto es una comodidad, no puede convertirse en una fuente de ruido.
#
# ── Por qué reparar sin preguntar ────────────────────────────────────────────
# Porque la operación es conservadora, no destructiva: para NTFS, udisks ejecuta
# `ntfsfix`, y su propio man deja claro que NO es un chkdsk de Linux — "repara
# inconsistencias fundamentales, resetea el journal y PROGRAMA una comprobación de
# consistencia en el primer arranque de Windows". O sea que auto-reparar no esconde
# el problema: Windows lo revisa igual. Y el momento de hacerlo es EXACTAMENTE este,
# el enchufe: es la única ventana en la que el volumen está sucio y aún sin montar,
# que es lo que Repair exige. Preguntar aquí solo servía para que la ventana se
# cerrara mientras el usuario decidía.
check_volume() {
    local part=$1 name=$2 fs=$3
    ( sleep 2                                        # deja que udisks registre el objeto
      grep -q "^/dev/$part " /proc/mounts && exit 0  # ya montado → no se puede comprobar
      local obj="/org/freedesktop/UDisks2/block_devices/$part" out
      out=$(busctl --system call org.freedesktop.UDisks2 "$obj" \
              org.freedesktop.UDisks2.Filesystem Check 'a{sv}' 0 2>/dev/null) || exit 0
      [[ "$out" == *"true"* ]] && exit 0             # limpio

      # Sucio. Camino normal: repararlo ya. usb-repair.sh avisa de lo que hace y de
      # cómo acaba, así que aquí no hace falta notificar nada más.
      #
      # Se recomprueba el montaje justo antes: entre el Check y esta línea el gestor
      # de archivos ha podido montarlo, y en modo automático NO vamos a desmontarle un
      # volumen que quizá ya está usando. En ese caso (y solo en ese) se cae al aviso
      # con botón, donde el desmontaje lo autoriza él con el clic.
      if [[ -x "$REPAIR" ]] && ! grep -q "^/dev/$part " /proc/mounts; then
          "$REPAIR" "/dev/$part"
          exit 0
      fi

      act=$(notify-send -h string:x-gigios-source:system -a "USB" --wait -t 30000 \
              -u critical -A "repair=🔧 Reparar" \
              "⚠️ Volumen con errores" \
              "«$name» ($fs) no está limpio y ya está montado — repáralo cuando dejes de usarlo.")
      [[ "$act" == "repair" ]] && [[ -x "$REPAIR" ]] && "$REPAIR" "/dev/$part" ) &
}

reset_event
while IFS= read -r line; do
    case "$line" in
        "UDEV  ["*)                 reset_event ;;
        "SUBSYSTEM="*)              subsystem=${line#SUBSYSTEM=} ;;
        "ACTION="*)                 action=${line#ACTION=} ;;
        "DEVTYPE="*)                devtype=${line#DEVTYPE=} ;;
        "DEVNAME="*)                devname=${line#DEVNAME=} ;;
        "ID_BUS="*)                 bus=${line#ID_BUS=} ;;
        "ID_USB_INTERFACES="*)      ifaces=${line#ID_USB_INTERFACES=} ;;
        "ID_FS_TYPE="*)             fstype=${line#ID_FS_TYPE=} ;;
        "ID_FS_LABEL="*)            fslabel=${line#ID_FS_LABEL=} ;;
        "ID_VENDOR_FROM_DATABASE="*) vendor=${line#ID_VENDOR_FROM_DATABASE=} ;;
        "ID_VENDOR="*)              [[ -z "$vendor" ]] && vendor=${line#ID_VENDOR=} ;;
        "ID_MODEL_FROM_DATABASE="*) model=${line#ID_MODEL_FROM_DATABASE=} ;;
        "ID_MODEL="*)               [[ -z "$model" ]] && model=${line#ID_MODEL=} ;;
        "")
            # Línea en blanco = fin del bloque de propiedades de este evento.
            vendor="${vendor//_/ }"
            model="${model//_/ }"

            if [[ "$subsystem" == "usb" && "$devtype" == "usb_device" ]]; then
                # ":08" = mass storage → que hable el evento de bloque.
                is_storage=false
                [[ "$ifaces" == *":08"* ]] && is_storage=true
                case "$action" in
                    add)    [[ "$is_storage" == false ]] && notify_usb "conectado" ;;
                    remove) notify_usb "desconectado" ;;
                esac

            elif [[ "$subsystem" == "block" && "$bus" == "usb" && "$action" == "add" ]]; then
                case "$devtype" in
                    disk)
                        # Un disco siempre aparece, aunque no tenga particiones ni fs
                        # legible — por eso el aviso cuelga de aquí y no de la partición.
                        notify_storage "$(basename "$devname")" \
                            "${vendor:+$vendor }${model:-Disco USB}"
                        ;;
                    partition)
                        [[ -n "$fstype" ]] && \
                            check_volume "$(basename "$devname")" \
                                         "${fslabel:-$(basename "$devname")}" "$fstype"
                        ;;
                esac
            fi
            reset_event
            ;;
    esac
done < <(udevadm monitor --udev --subsystem-match=usb --subsystem-match=block --property 2>/dev/null)
