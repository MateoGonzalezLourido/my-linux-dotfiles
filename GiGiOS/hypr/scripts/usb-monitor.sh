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
# ':', buscar ":08" solo puede casar al principio de una entrada.
#
# DEVTYPE=usb_device (vs. usb_interface) es la forma canónica de udev de distinguir
# el dispositivo físico de sus sub-nodos por interfaz.
#
# ── Por qué el aviso genérico se DIFIERE en vez de decidirse en el acto ───────
# Adivinar la clase desde el evento del usb_device es una heurística que falla en
# los dos sentidos, y cuando falla salen DOS popups por un solo enchufe: primero
# "USB conectado — dispositivo desconocido" y acto seguido el de almacenamiento
# con el nombre bueno. Casos vistos: la propiedad no viene en el bloque (llega un
# evento con las propiedades a medias), o el dispositivo se engancha a usb-storage
# por una interfaz de clase PROPIETARIA (ff…, típico de lectores de tarjetas y
# algunas carcasas) y por tanto sin ningún ":08" que mirar.
#
# La señal fiable no es la clase declarada: es el hecho OBSERVADO de que el
# dispositivo acabe exponiendo un dispositivo de bloque. Eso solo se sabe unos
# instantes después, así que el aviso genérico se retiene DEFER_SECS y se cancela
# si en esa ventana llega un evento de bloque de ESE mismo dispositivo. El enlace
# entre ambos es DEVPATH: el del bloque cuelga del árbol del usb_device
# (…/usb1/1-5 → …/usb1/1-5/1-5:1.0/host…/block/sdb), o sea que el del padre es
# PREFIJO del hijo. Es una relación exacta, no una correlación por tiempo: dos
# dispositivos enchufados a la vez no se cancelan el uno al otro.
#
# El coste es que un teclado tarda DEFER_SECS en anunciarse. Es un popup
# informativo y pasivo, así que se prefiere eso a un falso "dispositivo
# desconocido". Los dos atajos (ID_USB_INTERFACES y sysfs) siguen ahí para el
# camino común: un pendrive normal se calla YA, sin pagar la espera ni tocar
# disco.

EJECT="$HOME/.config/hypr/scripts/usb-eject.sh"
REPAIR="$HOME/.config/hypr/scripts/usb-repair.sh"

# Avisos genéricos retenidos a la espera de que se confirme (o no) que el
# dispositivo es almacenamiento. Un fichero por aviso pendiente, con su DEVPATH
# dentro. Se limpia al arrancar porque un proceso anterior muerto a mitad deja
# pendientes huérfanos que nadie reclamaría.
PENDING_DIR="${GIGIOS_USB_PENDING_DIR:-${XDG_RUNTIME_DIR:-/tmp}/gigios-usb-pending}"
DEFER_SECS=3
rm -rf "$PENDING_DIR"
mkdir -p -m 700 "$PENDING_DIR" || exit 1
trap 'rm -rf "$PENDING_DIR"' EXIT

subsystem=""; action=""; devtype=""; devname=""; devpath=""
vendor=""; model=""; ifaces=""; bus=""; fstype=""; fslabel=""
pending_n=0

reset_event() {
    subsystem=""; action=""; devtype=""; devname=""; devpath=""
    vendor=""; model=""; ifaces=""; bus=""; fstype=""; fslabel=""
}

notify_usb() {
    local verb=$1 label=$2
    notify-send -h string:x-gigios-source:system -u normal "USB $verb" "$label" -t 8000
}

# Respaldo para cuando el evento no trae ID_USB_INTERFACES: las interfaces del
# dispositivo son subdirectorios suyos en sysfs. No siempre existen todavía
# cuando llega el 'add' del usb_device — de ahí que esto sea un atajo y no la
# garantía; quien garantiza es el diferido. Sin forks: glob + read builtin.
sysfs_is_storage() {
    local dev=$1 f cls
    [[ -n "$dev" ]] || return 1
    for f in /sys"$dev"/*/bInterfaceClass; do
        [[ -r "$f" ]] || continue
        read -r cls < "$f" || continue
        [[ "$cls" == "08" ]] && return 0
    done
    return 1
}

# Etiqueta del evento en curso. `ev_known` distingue "sé cómo se llama" de la
# cadena de relleno: al fusionar avisos hay que poder preferir un nombre real
# sobre un "dispositivo desconocido", y comparar contra el literal sería frágil.
ev_label=""; ev_known=0
event_label() {
    if [[ -n "$vendor$model" ]]; then
        ev_label="${vendor:+$vendor }${model}"; ev_label="${ev_label% }"; ev_known=1
    else
        ev_label="dispositivo desconocido"; ev_known=0
    fi
}

# Los pendientes se claman con un `mv` a `.fired.*`, un nombre que NO casa con
# los globs `c.*`/`r.*`: así un aviso ya reclamado no puede volver a aparecer
# como pendiente vivo y falsear una cancelación o una fusión.
claim_pending() {   # $1 = fichero; éxito = es mío y nadie lo canceló
    mv "$1" "$PENDING_DIR/.fired.${1##*/}" 2>/dev/null || return 1
    rm -f "$PENDING_DIR/.fired.${1##*/}"
}

# Retiene el aviso genérico de CONEXIÓN. El subshell RECLAMA su pendiente antes
# de notificar: el rename es atómico y falla si el fichero ya no está, así que no
# hay ventana entre "compruebo que sigue vivo" y "notifico" en la que una
# cancelación pueda colarse y salir el popup igualmente.
defer_usb_notice() {
    local dev=$1 label=$2 f
    f="$PENDING_DIR/c.$$.$((++pending_n))"
    printf '%s\n' "$dev" > "$f" || return
    ( sleep "$DEFER_SECS"
      claim_pending "$f" || exit 0   # cancelado mientras dormía
      notify_usb "conectado" "$label" ) &
}

# Cancela los avisos de CONEXIÓN pendientes de este dispositivo o de cualquier
# antecesor suyo. Se llama con el DEVPATH de un evento de bloque (el hijo) y
# también al desconectar (mismo DEVPATH), para que enchufar y tirar del pendrive
# antes de DEFER_SECS no saque un "conectado" DESPUÉS del "desconectado".
cancel_usb_notice() {
    local dev=$1 f stored
    [[ -n "$dev" ]] || return
    for f in "$PENDING_DIR"/c.*; do
        [[ -f "$f" ]] || continue
        read -r stored < "$f" || continue
        [[ -n "$stored" ]] || continue
        [[ "$dev" == "$stored" || "$dev" == "$stored"/* ]] && rm -f "$f"
    done
}

# ── Desconexión: un tirón físico, un aviso ───────────────────────────────────
# Un dispositivo compuesto o detrás de un hub expone VARIOS usb_device anidados,
# y al retirarlo el kernel emite un `remove` por cada uno. Como el aviso colgaba
# de ese evento, salían dos popups por un solo tirón — y el del nodo padre suele
# no traer ID_MODEL, de ahí el "dispositivo desconocido" que acompañaba al bueno.
# Es la misma causa que en la conexión (ahí el padre es el que se cuela), así que
# el arreglo es el espejo: retener el aviso DEFER_SECS y fusionar los removes
# emparentados por DEVPATH en uno solo, con el mejor nombre disponible.
#
# La regla de fusión es asimétrica a propósito, y esa asimetría es lo que hace
# que funcione llegue el padre antes o después que los hijos (el kernel suele
# emitir hijo→padre, pero no se depende de ello):
#
#   · el entrante DESCIENDE de un pendiente → lo absorbe y se queda con SU
#     devpath (el más profundo, que es la función real y la que tiene nombre);
#   · el entrante es ANTECESOR de un pendiente → se descarta, porque el hijo ya
#     cubre ese tirón. Solo cede su etiqueta si el hijo no tenía nombre.
#
# Guardar el devpath MÁS PROFUNDO es lo que evita colapsar hermanos: al retirar
# un hub con tres pendrives, los tres son hermanos entre sí (ninguno desciende de
# otro) → tres avisos, uno por dispositivo, y el remove del hub se descarta. Si
# se guardara el del hub, los tres se fusionarían en un único aviso.
defer_usb_removal() {
    local dev=$1 label=$2 known=$3 f stored slabel sknown covered=0 tmp
    [[ -n "$dev" ]] || { notify_usb "desconectado" "$label"; return; }

    for f in "$PENDING_DIR"/r.*; do
        [[ -f "$f" ]] || continue
        { read -r stored; read -r slabel; read -r sknown; } < "$f" || continue
        [[ -n "$stored" ]] || continue

        if [[ "$dev" == "$stored"/* ]]; then
            # Entrante más profundo: absorbe al antecesor.
            [[ "$known" == 1 ]] || { label=$slabel; known=$sknown; }
            rm -f "$f"
        elif [[ "$stored" == "$dev"/* || "$dev" == "$stored" ]]; then
            # El pendiente ya cubre este tirón. Solo le pasamos el nombre si él
            # no lo tenía. Escritura atómica: su subshell puede reclamarlo justo
            # ahora, y media línea leída sería un aviso con el texto partido.
            if [[ "$known" == 1 && "$sknown" != 1 ]]; then
                tmp="$PENDING_DIR/.tmp.$$.$((++pending_n))"
                printf '%s\n%s\n1\n' "$stored" "$label" > "$tmp" && mv "$tmp" "$f"
            fi
            covered=1
        fi
    done
    [[ "$covered" == 1 ]] && return

    f="$PENDING_DIR/r.$$.$((++pending_n))"
    printf '%s\n%s\n%s\n' "$dev" "$label" "$known" > "$f" || return
    ( sleep "$DEFER_SECS"
      # Se relee del fichero: otro remove ha podido mejorar el nombre mientras
      # dormíamos, y el valor que capturó el subshell al nacer sería el viejo.
      # El guarda evita que un pendiente ya absorbido —caso normal, no error—
      # deje un fallo de redirección en stderr; quien decide si toca notificar
      # es el claim de la línea siguiente, no esta lectura.
      [[ -f "$f" ]] && { read -r stored; read -r slabel; } < "$f"
      claim_pending "$f" || exit 0
      notify_usb "desconectado" "${slabel:-$label}" ) &
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
        "DEVPATH="*)                devpath=${line#DEVPATH=} ;;
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
                # ":08" = mass storage → que hable el evento de bloque. Los dos
                # atajos solo sirven para AHORRARSE la espera cuando la respuesta
                # ya se sabe; si dicen que no, no se concluye nada: se difiere.
                is_storage=false
                [[ "$ifaces" == *":08"* ]] && is_storage=true
                [[ "$is_storage" == false ]] && sysfs_is_storage "$devpath" && is_storage=true
                event_label
                case "$action" in
                    add)
                        [[ "$is_storage" == false ]] && \
                            defer_usb_notice "$devpath" "$ev_label"
                        ;;
                    remove)
                        cancel_usb_notice "$devpath"
                        defer_usb_removal "$devpath" "$ev_label" "$ev_known"
                        ;;
                esac

            elif [[ "$subsystem" == "block" && "$bus" == "usb" && "$action" == "add" ]]; then
                # Prueba observada de que sí era almacenamiento: mata el aviso
                # genérico que estuviera en vuelo para este mismo dispositivo.
                cancel_usb_notice "$devpath"
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
