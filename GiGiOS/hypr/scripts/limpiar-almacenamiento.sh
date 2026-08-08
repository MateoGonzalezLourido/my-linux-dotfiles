#!/usr/bin/env bash
# limpiar-almacenamiento.sh — ejecuta las limpiezas de Ajustes > Almacenamiento.
#
#   limpiar-almacenamiento.sh <accion> [<accion>…]   → JSON por stdout, una entrada por acción
#   limpiar-almacenamiento.sh --listar               → ids válidos, uno por línea
#
# Lo invocan dos consumidores con exigencias distintas: los botones de la UI (una acción, hay
# alguien delante) y `limpieza-arranque.sh` (varias acciones, desatendido). Por eso acepta varias y
# por eso el desenlace de cada una viaja en el JSON en vez de en el código de salida: en un lote,
# que la papelera falle no debe cancelar la limpieza de la caché ni parecer un fallo global.
#
# ── El reparto de privilegios, que es lo único delicado aquí ─────────────────
# Tres niveles, y cada acción está en uno a propósito:
#
#   1. usuario           todo lo que vive bajo $HOME. Sin sudo, sin diálogos.
#   2. sudo -n (helper)  lo de root que se REGENERA solo: caché de pacman, journal, /var/tmp,
#                        huérfanos. Va por /usr/local/bin/gigios-limpieza con NOPASSWD, que es lo
#                        que permite la autolimpieza desatendida. Ver system/limpieza/.
#   3. pkexec            lo de root IRREVERSIBLE: vaciar la caché entera. Pide contraseña siempre
#                        y por eso NO puede formar parte de la autolimpieza — se marca `manual`.
#
# Sin el helper instalado, las acciones del nivel 2 no fallan calladas: devuelven
# `estado:"sin-permisos"` con el paso de instalación que falta, y la UI lo pinta.
#
# ── Todo mide antes y después ────────────────────────────────────────────────
# Ninguna herramienta de las que se llaman aquí informa de forma fiable de cuánto ha liberado
# (`paccache` imprime un resumen en texto libre, `journalctl --vacuum-size` no imprime nada útil,
# `rm` menos). Así que el espacio liberado se mide con `du` a los dos lados. Cuesta una pasada
# extra y es la única cifra que no se puede inventar.
set -uo pipefail

export LC_ALL=C

APP="Almacenamiento"
NOTIF_APP="$APP"
# shellcheck source=lib/notif.sh
if ! source "$HOME/.config/hypr/scripts/lib/notif.sh" 2>/dev/null; then
    notificar() {
        shift
        local -a _a=(); [[ -n "${NOTIF_APP:-}" ]] && _a=(-a "$NOTIF_APP")
        notify-send -h string:x-gigios-source:system "${_a[@]}" "$@"
    }
fi

CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}
DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/gigios/almacenamiento.json"
HELPER=/usr/local/bin/gigios-limpieza

ACCIONES=(cachePaquetes cachePaquetesTotal cacheAur huerfanos registros temporales
          cacheUsuario miniaturas cacheDesarrollo papelera descargas flatpak)

[[ "${1:-}" == "--listar" ]] && { printf '%s\n' "${ACCIONES[@]}"; exit 0; }

command -v jq >/dev/null 2>&1 || { echo '[{"accion":"","estado":"error","liberado":0,"mensaje":"falta jq"}]'; exit 1; }

# ── Preferencias ─────────────────────────────────────────────────────────────
# Las escribe AGS. Cada lectura trae su valor por defecto: un fichero ausente, vacío o corrupto no
# puede impedir una limpieza manual que el usuario acaba de pedir.
_pref() { jq -r --arg d "$2" ".${1} // \$d" "$CONFIG" 2>/dev/null || echo "$2"; }

RETENER_JOURNAL=$(_pref retenerJournal 200M)
[[ "$RETENER_JOURNAL" =~ ^[0-9]+[KMG]$ ]] || RETENER_JOURNAL=200M
DIAS_PAPELERA=$(_pref diasPapelera 0)
[[ "$DIAS_PAPELERA" =~ ^[0-9]+$ ]] || DIAS_PAPELERA=0
DIAS_DESCARGAS=$(_pref diasDescargas 0)
[[ "$DIAS_DESCARGAS" =~ ^[0-9]+$ ]] || DIAS_DESCARGAS=0

# ── Utilidades ───────────────────────────────────────────────────────────────

_tam() {
    local total=0 r
    for r in "$@"; do
        [[ -e "$r" ]] || continue
        total=$((total + $(du -sxb -- "$r" 2>/dev/null | awk 'END{print $1+0}')))
    done
    echo "$total"
}

# Borra el CONTENIDO de un directorio, nunca el directorio. Varias de estas rutas las crea la
# aplicación dueña al arrancar y no todas las recrean si desaparecen (~/.cache/thumbnails es el
# caso conocido: sin el directorio, GTK deja de generar miniaturas hasta el siguiente login).
_vaciar() {
    local d=$1
    [[ -d "$d" ]] || return 0
    find "$d" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null
    return 0
}

# Nivel 2: el helper root-owned. Devuelve los bytes liberados por stdout.
# Un rc≠0 aquí NO es lo mismo que "no hay helper": se distinguen porque lo segundo se comprueba
# antes, y así la UI puede decir "te falta un paso de instalación" en vez de "falló la limpieza".
_helper() {
    if [[ ! -x "$HELPER" ]]; then
        estado="sin-permisos"
        mensaje="Falta /usr/local/bin/gigios-limpieza (se instala con install.sh)."
        return 1
    fi
    local salida rc
    salida=$(sudo -n "$HELPER" "$@" 2>&1); rc=$?
    if ((rc != 0)); then
        estado="error"
        mensaje=$(printf '%s' "$salida" | tail -n 1)
        return 1
    fi
    [[ "$salida" =~ ^[0-9]+$ ]] && liberado=$salida
    return 0
}

# Nivel 3: pkexec. 126 = el usuario cerró el diálogo o falló la autenticación, que no es un error
# del que haya que quejarse en rojo (mismo criterio que desinstalar-app.sh).
_root_interactivo() {
    local salida rc
    salida=$(pkexec "$@" 2>&1); rc=$?
    case $rc in
        0)   return 0 ;;
        126) estado="cancelado"; mensaje="Cancelado."; return 1 ;;
        *)   estado="error"; mensaje=$(printf '%s' "$salida" | tail -n 1); return 1 ;;
    esac
}

# ── Acciones ─────────────────────────────────────────────────────────────────
# Cada una fija `liberado`, `estado` y `mensaje`. Las tres están declaradas por el llamante.

_ejecutar() {
    local accion=$1
    liberado=0; estado=ok; mensaje=""

    case "$accion" in
        cachePaquetes)   _helper paccache ;;
        registros)       _helper journal "$RETENER_JOURNAL" ;;
        temporales)      _helper tmp ;;
        huerfanos)       _helper huerfanos ;;

        # Vaciar la caché ENTERA, incluidos los paquetes de lo que está instalado. Deja el equipo
        # sin poder revertir una actualización sin red, así que pide contraseña siempre y nunca
        # entra en la autolimpieza.
        cachePaquetesTotal)
            local antes; antes=$(_tam /var/cache/pacman/pkg)
            if _root_interactivo /usr/bin/pacman -Scc --noconfirm; then
                liberado=$((antes - $(_tam /var/cache/pacman/pkg)))
            fi
            ;;

        # Caché del helper de AUR. `-Sc --noconfirm` deja los paquetes construidos de lo que sigue
        # instalado; los clones de git se borran aparte porque el helper los conserva para poder
        # reconstruir, y son la mayor parte del tamaño.
        cacheAur)
            local helper="" antes=0 d
            for d in paru yay; do command -v "$d" >/dev/null 2>&1 && { helper=$d; break; }; done
            if [[ -z "$helper" ]]; then
                estado=omitida; mensaje="No hay paru ni yay instalados."
            else
                antes=$(_tam "$CACHE_HOME/$helper")
                "$helper" -Sc --noconfirm >/dev/null 2>&1
                _vaciar "$CACHE_HOME/$helper/clone"
                liberado=$((antes - $(_tam "$CACHE_HOME/$helper")))
            fi
            ;;

        # ~/.cache entero MENOS lo que no es caché de verdad. La lista de exclusiones no es
        # cosmética: varias aplicaciones guardan ahí estado que no se regenera —GiGiOS mismo tiene
        # el mapa de fuentes del CSS y el sondeo de hardware, y las sesiones de algunos navegadores
        # viven en su caché—, así que un `rm -rf ~/.cache/*` a ciegas cuesta datos reales. Se
        # excluye también el directorio del helper de AUR: tiene su propia acción y su propia
        # forma correcta de limpiarse (`-Sc`), y borrarlo a mano deja al helper reconstruyendo
        # todo desde cero la próxima vez.
        cacheUsuario)
            local antes; antes=$(_tam "$CACHE_HOME")
            find "$CACHE_HOME" -mindepth 1 -maxdepth 1 \
                ! -name gigios ! -name paru ! -name yay ! -name mesa_shader_cache \
                ! -name mesa_shader_cache_db ! -name nvidia ! -name radv_builtin_shaders \
                -exec rm -rf -- {} + 2>/dev/null
            liberado=$((antes - $(_tam "$CACHE_HOME")))
            ;;

        miniaturas)
            local antes; antes=$(_tam "$CACHE_HOME/thumbnails")
            _vaciar "$CACHE_HOME/thumbnails"
            liberado=$((antes - $(_tam "$CACHE_HOME/thumbnails")))
            ;;

        # Cachés de gestores de paquetes de lenguajes: se rellenan solas desde la red y no
        # contienen nada escrito por el usuario. `npm cache clean` en vez de un `rm` porque npm
        # mantiene un índice que se queda incoherente si le borras el contenido por debajo.
        cacheDesarrollo)
            local rutas=("$HOME/.npm" "$CACHE_HOME/pip" "$CACHE_HOME/go-build" "$HOME/.cargo/registry/cache")
            local antes; antes=$(_tam "${rutas[@]}")
            command -v npm >/dev/null 2>&1 && npm cache clean --force >/dev/null 2>&1
            command -v pip >/dev/null 2>&1 && pip cache purge >/dev/null 2>&1
            _vaciar "$CACHE_HOME/go-build"
            _vaciar "$HOME/.cargo/registry/cache"
            liberado=$((antes - $(_tam "${rutas[@]}")))
            ;;

        # Papelera. Con `diasPapelera > 0` solo se van los elementos con esa antigüedad, que es lo
        # que hace utilizable la papelera en una limpieza automática: vaciarla entera cada noche la
        # convierte en un `rm` con pasos extra.
        #
        # Se borra el par (files/<x>, info/<x>.trashinfo) a la vez: dejar el .trashinfo huérfano
        # hace que los gestores de archivos enseñen entradas fantasma que no se pueden restaurar.
        papelera)
            local base="$DATA_HOME/Trash" antes
            antes=$(_tam "$base")
            if ((DIAS_PAPELERA > 0)); then
                local ruta nombre
                while IFS= read -r ruta; do
                    [[ -z "$ruta" ]] && continue
                    nombre=$(basename -- "$ruta")
                    rm -rf -- "$ruta" "$base/info/$nombre.trashinfo" 2>/dev/null
                done < <(find "$base/files" -mindepth 1 -maxdepth 1 -mtime "+$DIAS_PAPELERA" 2>/dev/null)
            else
                _vaciar "$base/files"
                _vaciar "$base/info"
                _vaciar "$base/expunged"
            fi
            liberado=$((antes - $(_tam "$base")))
            ;;

        # Descargas por antigüedad. Es lo único de la lista que borra ficheros que el usuario puso
        # ahí a mano, así que SIN un número de días explícito no hace nada — nunca "vaciar
        # Descargas". Van a la papelera con `gio trash` cuando se puede, no a `rm`: es
        # recuperable, y aquí sí importa.
        descargas)
            if ((DIAS_DESCARGAS <= 0)); then
                estado=omitida; mensaje="Requiere fijar una antigüedad en días."
            else
                local dir antes
                dir=$(xdg-user-dir DOWNLOAD 2>/dev/null)
                [[ -z "$dir" || "$dir" == "$HOME" ]] && dir="$HOME/Descargas"
                if [[ ! -d "$dir" ]]; then
                    estado=omitida; mensaje="No hay carpeta de Descargas."
                else
                    antes=$(_tam "$dir")
                    if command -v gio >/dev/null 2>&1; then
                        find "$dir" -mindepth 1 -maxdepth 1 -mtime "+$DIAS_DESCARGAS" \
                            -exec gio trash -- {} + 2>/dev/null
                    else
                        find "$dir" -mindepth 1 -maxdepth 1 -mtime "+$DIAS_DESCARGAS" \
                            -exec rm -rf -- {} + 2>/dev/null
                    fi
                    liberado=$((antes - $(_tam "$dir")))
                fi
            fi
            ;;

        # Runtimes de Flatpak que ya no usa ninguna aplicación instalada: el equivalente exacto de
        # los huérfanos de pacman. `flatpak repair` NO se ejecuta aquí — verifica y redescarga, o
        # sea que puede tardar y consumir red, y eso no es una limpieza.
        flatpak)
            if ! command -v flatpak >/dev/null 2>&1; then
                estado=omitida; mensaje="Flatpak no está instalado."
            else
                local antes; antes=$(_tam /var/lib/flatpak "$DATA_HOME/flatpak")
                flatpak uninstall --unused -y >/dev/null 2>&1
                liberado=$((antes - $(_tam /var/lib/flatpak "$DATA_HOME/flatpak")))
            fi
            ;;

        *)
            estado=error; mensaje="Acción desconocida: $accion"
            ;;
    esac

    # `du` mide un blanco móvil: entre las dos pasadas el navegador puede haber vuelto a escribir
    # en su caché, y entonces la resta sale negativa. Un "-3 MB liberados" no significa nada para
    # quien lo lee, así que se recorta a 0. El estado sigue siendo `ok`: la limpieza se hizo.
    ((liberado < 0)) && liberado=0
    return 0
}

# ── Entrada ──────────────────────────────────────────────────────────────────

(($# == 0)) && { echo "uso: $0 <accion>… | --listar" >&2; exit 2; }

resultados=""
total=0
for accion in "$@"; do
    liberado=0; estado=ok; mensaje=""
    _ejecutar "$accion"
    [[ "$estado" == ok ]] && total=$((total + liberado))
    resultados+="${accion}"$'\t'"${estado}"$'\t'"${liberado}"$'\t'"${mensaje}"$'\n'
done

printf '%s' "$resultados" | jq -R -s '
    split("\n") | map(select(length > 0)) | map(split("\t")) |
    map({ accion: .[0], estado: .[1], liberado: (.[2] | tonumber), mensaje: (.[3] // "") })'

# El aviso solo lo emite el modo desatendido. Desde un botón de Ajustes el resultado ya se ve en el
# propio panel, y notificar además lo que acabas de pulsar es ruido.
if [[ "${GIGIOS_LIMPIEZA_NOTIFICAR:-0}" == 1 && $total -gt 0 ]]; then
    legible=$(numfmt --to=iec --suffix=B --format='%.1f' "$total" 2>/dev/null || echo "${total}B")
    notificar limpieza.completada -u low -t 8000 "🧹 Limpieza automática" "Se han liberado $legible."
fi
