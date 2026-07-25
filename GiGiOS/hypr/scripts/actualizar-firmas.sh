#!/usr/bin/env bash
# actualizar-firmas.sh — actualiza la base de firmas de ClamAV y deja el servicio de
# actualización automática encendido. Es el lado de USUARIO del helper root-owned
# /usr/local/bin/gigios-clamav-update (ver system/clamav/ y CLAUDE.md, "Firmas de ClamAV").
#
# POR QUÉ EXISTE Y NO SE LLAMA AL HELPER DIRECTAMENTE: esto es lo que ejecuta el botón
# "🛡️ Activar y actualizar" de las notificaciones de "ClamAV no puede analizar". Ahí hace falta
# algo que además NOTIFIQUE el resultado —el helper solo imprime por stdout, que en una acción de
# notify-send no lo lee nadie— y que no se pueda lanzar dos veces a la vez: freshclam descarga
# ~200 MB y dos clics seguidos serían dos descargas peleándose por el mismo lock del log.
#
# Lo invocan:
#   • el aviso "🛡️ Antivirus sin base de firmas" de oom-monitor.sh (escáner de descargas),
#   • el "no se pudo analizar" de scan-file.sh y de run-untrusted.sh,
#   • y a mano, si se quiere.
# El botón equivalente de Ajustes › Seguridad › Antivirus NO pasa por aquí: AGS llama al helper
# directamente porque ya tiene su propio estado (`clamavBusy`) y sus propias notificaciones.

set -u

APP="Antivirus"
HELPER=/usr/local/bin/gigios-clamav-update
LOCK="${XDG_RUNTIME_DIR:-/tmp}/gigios-clamav-update.lock"

notify() { notify-send -h string:x-gigios-source:system -a "$APP" "$@"; }

if [[ ! -x "$HELPER" ]]; then
    # Sin el helper root-owned no hay forma de hacerlo sin contraseña, y pedirla desde una
    # notificación no es posible. Se dice qué ejecutar en vez de fallar en silencio.
    notify -u critical "🛡️ Falta el ayudante de firmas" \
        "Ejecuta ~/GiGiOS/install.sh (o 'sudo freshclam' a mano) para poder actualizar desde aquí." -t 0
    exit 3
fi

# Un solo intento a la vez. `flock -n` falla en el acto si ya hay uno corriendo, en vez de
# encolarse: el usuario ha pulsado dos veces el mismo botón, no ha pedido dos actualizaciones.
exec 9>"$LOCK"
if ! flock -n 9; then
    notify -u low "🛡️ Actualización en curso" "Las firmas ya se están actualizando." -t 5000
    exit 0
fi

notify -u low "🛡️ Actualizando firmas…" "Descargando la base de ClamAV; puede tardar un minuto." -t 8000

# `sudo -n`: sin la regla sudoers falla en el acto en vez de colgarse pidiendo una contraseña que
# nadie puede teclear (esto sale de un clic en una notificación, sin terminal donde escribir).
#
# `update-enable` y no `update`: este es el botón "Activar y actualizar" de una notificación que
# dice que el antivirus no puede analizar, así que dejar la actualización automática encendida ES
# lo que se ha pedido. El botón "Actualizar ahora" de Ajustes usa `update` a secas, que respeta el
# interruptor de actualización automática en vez de reencenderlo por la espalda.
err=$(sudo -n "$HELPER" update-enable 2>&1 >/dev/null); rc=$?

if (( rc == 0 )); then
    notify -u normal "✓ Firmas actualizadas" \
        "ClamAV ya puede analizar. Lo pendiente se revisa en el siguiente barrido de Descargas." -t 10000
else
    # `sudo -n` no está: el helper existe pero la regla sudoers no, o freshclam falló (sin red,
    # espejo caído). Se distingue porque el mensaje de sudo es inconfundible.
    if [[ "$err" == *"password is required"* || "$err" == *"sudo:"* ]]; then
        err="falta la regla /etc/sudoers.d/gigios-clamav (ejecuta ~/GiGiOS/install.sh)"
    fi
    notify -u critical "🛡️ No se pudieron actualizar las firmas" \
        "${err:-freshclam falló (código $rc)}" -t 0
fi
exit "$rc"
