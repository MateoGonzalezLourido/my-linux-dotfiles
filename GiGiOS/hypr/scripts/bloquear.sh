#!/usr/bin/env bash
# bloquear.sh — el ÚNICO camino para poner hyprlock en GiGiOS.
#
# Hace dos cosas y en este orden: sortea el fondo del bloqueo y lanza hyprlock
# (con `exec`, para que el proceso que quede sea hyprlock y no esta shell — de
# lo contrario `pidof hyprlock` no vería nada y la guarda de instancia única de
# más abajo dejaría de funcionar para el siguiente).
#
# POR QUÉ UN SCRIPT Y NO UNA LÍNEA EN hyprlock.conf: hyprlock.conf es hyprlang y
# NO tiene sustitución de comandos (el `cmd[update:N]` de las etiquetas es cosa
# del widget `label`, no del parser, y `background` no lo admite). La ruta del
# fondo tiene que estar ya escrita cuando hyprlock lee su config, así que alguien
# la tiene que decidir ANTES. Ese alguien es este script.
#
# EL FONDO ES UN SYMLINK SIN EXTENSIÓN, y no es un descuido: los wallpapers son
# .jpg/.jpeg/.png/.webp mezclados, así que un enlace con extensión fija mentiría
# la mitad de las veces. hyprlock 0.9.6 carga las imágenes por hyprgraphics, que
# enlaza libmagic y decide el formato por los BYTES del fichero, no por el
# nombre (`ldd /usr/lib/libhyprgraphics.so.4` → libmagic.so.1). Un enlace pelado
# funciona igual con cualquiera de los cuatro formatos.
#
# Vive en la caché y no en `~/.config/gigios/`: es regenerable en cada bloqueo y
# no es una preferencia del usuario. Si alguien lo borra, el siguiente bloqueo lo
# repone solo.
#
# FAIL-OPEN, y aquí es SERIO: si el sorteo falla (carpeta vacía, sin `shuf`, sin
# permisos) se bloquea IGUAL, con el fondo anterior o sin fondo. Un bloqueo de
# pantalla que no llega a ponerse porque no encontró una imagen bonita es un
# agujero de seguridad, no un fallo estético.

set -uo pipefail

WALLPAPER_DIR="$HOME/GiGiOS/Wallpapers"
FONDO="${XDG_CACHE_HOME:-$HOME/.cache}/gigios/hyprlock-fondo"

# Sortea un fondo y apunta el enlace hacia él. Cualquier fallo se traga: quien
# manda es el `exec` de abajo.
sortear_fondo() {
    local elegido
    elegido="$(find "$WALLPAPER_DIR" -maxdepth 1 -type f \
        \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) \
        2>/dev/null | shuf -n 1)" || return 0
    [[ -n $elegido && -r $elegido ]] || return 0
    mkdir -p "$(dirname "$FONDO")" 2>/dev/null || return 0
    # -n para que, si $FONDO ya es un enlace a un directorio, no se cree el nuevo
    # DENTRO de él; -f para reemplazar el que hubiera.
    ln -sfn "$elegido" "$FONDO" 2>/dev/null || return 0
}

# hyprlock NO tiene guarda de instancia única (0.9.6: ni una cadena "already
# running" en el binario), así que llamarlo con uno ya puesto arranca un SEGUNDO
# proceso encima del bloqueo. La guarda vive AQUÍ, una sola vez, y por eso todos
# los llamadores (hypridle.conf, idle-action.sh, el botón de encendido, el menú
# de energía de AGS) entran por este script en vez de repetirla cada uno.
pidof hyprlock >/dev/null 2>&1 && exit 0

sortear_fondo

exec hyprlock "$@"
