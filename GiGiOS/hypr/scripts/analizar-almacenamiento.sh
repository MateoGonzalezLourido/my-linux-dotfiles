#!/usr/bin/env bash
# analizar-almacenamiento.sh — inventario de disco para Ajustes > Almacenamiento.
#
# Emite JSON por stdout y NO borra nada: es la mitad de solo-lectura de la
# función. Lo que borra es `limpiar-almacenamiento.sh`, y son dos ficheros a
# propósito — el analizador lo invoca la UI cada vez que se abre la sección y el
# limpiador solo cuando el usuario pulsa algo o salta la autolimpieza.
#
#   analizar-almacenamiento.sh discos      → montajes reales con su uso
#   analizar-almacenamiento.sh categorias  → qué ocupa, por concepto
#   analizar-almacenamiento.sh apps        → catálogo de aplicaciones por tamaño
#   analizar-almacenamiento.sh todo        → los tres, en un solo objeto
#
# ── Por qué `du` y no una cifra exacta del sistema de ficheros ────────────────
# Btrfs con compresión y snapshots no tiene un "tamaño de esta carpeta" que
# signifique lo que la gente espera: `btrfs filesystem usage` da el total real
# del volumen (y ese sí sale en `discos`), pero repartirlo por carpetas exigiría
# qgroups habilitados y root. `du -sxb` da el tamaño lógico, que es la cifra que
# se corresponde con "si borro esto, dejo de tener estos bytes".
#
# ── Todo es opcional, y ese es el contrato ───────────────────────────────────
# Cada sonda va envuelta: sin `snapper`, sin `flatpak`, sin `/var/log/journal` o
# sin permiso de lectura, la entrada sale con `bytes: null` en vez de romper el
# JSON. `null` significa "no se ha podido medir" y la UI lo pinta distinto de un
# 0, que significa "medido y vacío". Confundirlos haría que una carpeta
# inaccesible pareciera limpia.
#
# ── El timeout no es paranoia ────────────────────────────────────────────────
# `du` sobre un ~/.cache con cientos de miles de ficheros y la caché de inodos
# fría tarda decenas de segundos. Esta salida alimenta un panel: una sonda lenta
# no puede dejar la sección entera esperando, así que cada `du` corre bajo
# `timeout` y lo que no llega a tiempo sale como `null`.
set -uo pipefail

export LC_ALL=C

DU_TIMEOUT=${GIGIOS_DU_TIMEOUT:-20}
CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}
DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}

command -v jq >/dev/null 2>&1 || { echo '{"error":"falta jq"}'; exit 1; }

# ── Utilidades ───────────────────────────────────────────────────────────────

# Tamaño lógico de una o varias rutas, en bytes. Vacío = no medible.
#
# `-x` (no cruzar sistemas de ficheros) importa de verdad aquí: /tmp es un
# tmpfs, ~/.local/share puede colgar de otro disco y sin `-x` una sonda sobre el
# hogar se llevaría por delante los montajes de dentro, contando dos veces lo
# que ya sale en `discos`.
_du() {
    local -a rutas=()
    local r
    for r in "$@"; do [[ -e "$r" ]] && rutas+=("$r"); done
    ((${#rutas[@]} == 0)) && return 1
    # `du` avisa por stderr de cada subdirectorio sin permiso y sigue contando el
    # resto: se silencia el ruido pero NO se descarta la cifra, porque una
    # medida parcial de /var/log es más útil que ninguna.
    timeout "$DU_TIMEOUT" du -scxb --  "${rutas[@]}" 2>/dev/null | awk 'END{print $1}'
}

# Igual, pero solo cuenta ficheros con más de N días sin modificar. Es lo que
# necesita la limpieza por antigüedad (papelera, descargas) para poder decir
# cuánto liberaría antes de borrar nada.
_du_antiguo() {
    local dias=$1; shift
    local -a rutas=()
    local r
    for r in "$@"; do [[ -d "$r" ]] && rutas+=("$r"); done
    ((${#rutas[@]} == 0)) && return 1
    timeout "$DU_TIMEOUT" find "${rutas[@]}" -xdev -type f -mtime "+$dias" -printf '%s\n' 2>/dev/null \
        | awk '{t+=$1} END{print t+0}'
}

# Acumulador de categorías. Se emite al final de una vez para que un fallo a
# mitad no deje un JSON truncado.
CATS=""
_cat() {  # id  bytes  detalle  limpiable
    local bytes=${2:-}
    [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=""
    CATS+="${1}"$'\t'"${bytes}"$'\t'"${3:-}"$'\t'"${4:-no}"$'\n'
}

_emitir_categorias() {
    printf '%s' "$CATS" | jq -R -s '
        split("\n") | map(select(length > 0)) | map(split("\t")) |
        map({
            id: .[0],
            bytes: (if .[1] == "" then null else (.[1] | tonumber) end),
            detalle: .[2],
            limpiable: (.[3] == "si")
        })'
}

# ── Discos ───────────────────────────────────────────────────────────────────
# Solo montajes de VERDAD: se excluyen los pseudo-sistemas de ficheros y los
# bind mounts de contenedores, que multiplicarían la misma partición por seis.
#
# `df` da el uso desde el punto de vista del sistema de ficheros, que en btrfs
# con snapshots es lo correcto (un snapshot ocupa espacio real y `du` no lo ve).
# Por eso la barra de uso sale de aquí y no de la suma de categorías.
discos() {
    df -B1 --output=source,target,fstype,size,used,avail,pcent -x tmpfs -x devtmpfs \
        -x squashfs -x overlay -x efivarfs -x ramfs 2>/dev/null \
        | tail -n +2 \
        | awk 'NF >= 7 { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, $4, $5, $6, $7 }' \
        | jq -R -s '
            split("\n") | map(select(length > 0)) | map(split("\t")) |
            map(select(length >= 7)) |
            map({
                dispositivo: .[0], punto: .[1], fs: .[2],
                total: (.[3] | tonumber), usado: (.[4] | tonumber),
                libre: (.[5] | tonumber),
                porcentaje: (.[6] | rtrimstr("%") | tonumber)
            }) |
            # UN disco por SISTEMA DE FICHEROS, no por punto de montaje. En una
            # instalación btrfs como la de CachyOS, `/`, `/home`, `/var/log`,
            # `/var/cache`… son subvolúmenes del MISMO dispositivo: `df` los
            # lista por separado con cifras idénticas y la sección enseñaba
            # siete veces el mismo disco de 1 TB, como si hubiera siete. Se
            # ordena por longitud del punto de montaje para quedarse con el más
            # corto (`/` antes que `/var/cache`), que es el que la gente
            # reconoce como "el disco".
            sort_by(.punto | length) | unique_by(.dispositivo) |
            sort_by(.punto)'
}

# ── Categorías ───────────────────────────────────────────────────────────────

_dir_usuario() {  # XDG user dir con fallback al nombre inglés
    local clave=$1 fallback=$2 ruta=""
    command -v xdg-user-dir >/dev/null 2>&1 && ruta=$(xdg-user-dir "$clave" 2>/dev/null)
    [[ -n "$ruta" && "$ruta" != "$HOME" && -d "$ruta" ]] && { echo "$ruta"; return 0; }
    [[ -d "$HOME/$fallback" ]] && { echo "$HOME/$fallback"; return 0; }
    return 1
}

# Volcado ÚNICO de `pacman -Qi`, compartido por todo el script.
#
# Antes se invocaba TRES veces: el total instalado, los huérfanos y el catálogo de aplicaciones.
# `pacman -Qi` sobre 1632 paquetes cuesta ~290 ms cada vez (medido), o sea que casi 0,6 s del
# análisis se iban en volver a preguntar lo mismo. Se vuelca una sola vez y los tres consumidores
# leen el fichero.
#
# Se genera ANTES de forkear los tres sondeos en paralelo del verbo `todo`: si cada subshell lo
# creara por su cuenta seguirían siendo tres invocaciones, solo que simultáneas — la misma CPU con
# peor pinta en el reloj de pared.
VOLCADO_QI=""
_volcado_qi() {
    if [[ -z "$VOLCADO_QI" ]]; then
        VOLCADO_QI=$(mktemp -t gigios-qi.XXXXXX)
        # El trap se instala aquí y no arriba para no borrar un fichero que no existe en las rutas
        # que nunca llegan a preguntar por paquetes (`discos`).
        trap 'rm -f "$VOLCADO_QI"' EXIT
        pacman -Qi >"$VOLCADO_QI" 2>/dev/null
    fi
    printf '%s' "$VOLCADO_QI"
}

# Convierte los "Installed Size" del volcado a bytes y los suma. Sin argumentos suma TODO; con una
# lista de nombres por stdin, solo esos.
#
# El filtrado se hace dentro de awk contra un conjunto, no con `pacman -Qi -- pkg…`: así los
# huérfanos salen del mismo volcado que ya está en disco en vez de forkear un pacman más.
_tam_paquetes() {
    local dump; dump=$(_volcado_qi)
    local nombres=""
    if [[ "${1:-}" == "--filtrar" ]]; then
        nombres=$(cat)
        [[ -z "${nombres//[[:space:]]/}" ]] && { echo 0; return 0; }
    fi
    awk -F': *' -v filtrar="${1:-}" -v lista="$nombres" '
        BEGIN {
            if (filtrar == "--filtrar") {
                n = split(lista, a, "\n")
                for (i = 1; i <= n; i++) if (a[i] != "") quiero[a[i]] = 1
            }
        }
        /^Name/ { nombre = $2 }
        /^Installed Size/ {
            if (filtrar != "--filtrar" || (nombre in quiero)) {
                n = $2 + 0
                u = $2; sub(/^[0-9.,]+ */, "", u)
                m = (u ~ /^KiB/) ? 1024 : (u ~ /^MiB/) ? 1048576 : (u ~ /^GiB/) ? 1073741824 : 1
                t += n * m
            }
        }
        END { printf "%d\n", t }' "$dump"
}

categorias() {
    local bytes detalle

    # ── Paquetes instalados ──────────────────────────────────────────────────
    if command -v pacman >/dev/null 2>&1; then
        # El número de paquetes sale de contar los `Name:` del volcado, no de un `pacman -Qq | wc`:
        # es la misma cifra sin dos procesos más.
        local total_pkgs
        total_pkgs=$(grep -c '^Name' "$(_volcado_qi)")
        bytes=$(_tam_paquetes)
        _cat paquetes "$bytes" "$total_pkgs" no

        # Caché de paquetes descargados. Es lo primero que hay que mirar cuando
        # falta espacio: crece sin techo si paccache.timer no está activo.
        bytes=$(_du /var/cache/pacman/pkg)
        detalle=$(find /var/cache/pacman/pkg -maxdepth 1 -name '*.pkg.tar*' 2>/dev/null | wc -l)
        _cat cachePaquetes "${bytes:-}" "$detalle" si

        # Huérfanos: dependencias que instaló otro paquete y que ya no necesita
        # nadie. Es literalmente "bibliotecas que no se usan".
        local orfanos
        orfanos=$(pacman -Qtdq 2>/dev/null)
        bytes=$(printf '%s\n' "$orfanos" | _tam_paquetes --filtrar)
        detalle=$(printf '%s' "$orfanos" | grep -c . || true)
        _cat huerfanos "$bytes" "$detalle" si
    fi

    # Caché del helper de AUR: clones de git y paquetes compilados. pacman no la
    # conoce, así que `paccache` no la toca y crece por su cuenta.
    local -a aur=()
    local h
    for h in paru yay; do [[ -d "$CACHE_HOME/$h" ]] && aur+=("$CACHE_HOME/$h"); done
    if ((${#aur[@]})); then
        bytes=$(_du "${aur[@]}")
        detalle=$(find "${aur[@]}" -maxdepth 2 -name clone -prune -o -maxdepth 1 -type d -print 2>/dev/null | wc -l)
        _cat cacheAur "${bytes:-}" "$detalle" si
    fi

    # ── Registros del sistema ────────────────────────────────────────────────
    # Se mide el directorio y no `journalctl --disk-usage`: esa orden imprime la
    # cifra ya formateada y redondeada ("43.8M"), y reconvertirla pierde
    # precisión justo en el rango en que importa decidir si limpiar.
    bytes=$(_du /var/log/journal)
    _cat registros "${bytes:-}" "" si

    # ── Temporales ───────────────────────────────────────────────────────────
    # /tmp suele ser tmpfs (o sea RAM): sale igualmente porque llenarlo cuelga
    # aplicaciones, pero no descuenta del disco. /var/tmp sí es disco.
    bytes=$(_du /tmp /var/tmp)
    _cat temporales "${bytes:-}" "" si

    # ── Instantáneas Btrfs ───────────────────────────────────────────────────
    # Se informa del NÚMERO, no de los bytes, y es deliberado: el espacio
    # exclusivo de un snapshot solo lo sabe `btrfs qgroup show`, que exige
    # qgroups habilitados y root. Dar aquí la suma de sus `du` sería una cifra
    # enorme y falsa (todo lo compartido contado una vez por snapshot).
    #
    # Y CONTARLOS TAMBIÉN ES DE ROOT: `snapper list` responde «Sin permisos» y
    # `btrfs subvolume list /` un «Operation not permitted» — los dos con
    # **código de salida 0** en el caso de snapper, así que el `grep -c` daba 0
    # y la fila desaparecía como si no hubiera instantáneas. Por eso la cuenta
    # sale del helper root-owned vía `sudo -n`; sin el helper instalado la fila
    # simplemente no se enseña, que es honesto — no sabemos.
    if [[ -x /usr/local/bin/gigios-limpieza ]]; then
        local n
        n=$(sudo -n /usr/local/bin/gigios-limpieza instantaneas 2>/dev/null)
        [[ "$n" =~ ^[0-9]+$ && "$n" != 0 ]] && _cat instantaneas "" "$n" no
    fi

    # ── Flatpak ──────────────────────────────────────────────────────────────
    if command -v flatpak >/dev/null 2>&1; then
        bytes=$(_du /var/lib/flatpak "$DATA_HOME/flatpak")
        detalle=$(flatpak list --app --columns=application 2>/dev/null | grep -c . || true)
        _cat flatpak "${bytes:-}" "$detalle" si
    fi

    # ── Caché del usuario ────────────────────────────────────────────────────
    # ~/.cache entero, con las miniaturas y las cachés de desarrollo aparte
    # porque tienen botón propio. Se solapan a propósito: la UI las presenta
    # anidadas, no las suma.
    bytes=$(_du "$CACHE_HOME")
    _cat cacheUsuario "${bytes:-}" "" si

    bytes=$(_du "$CACHE_HOME/thumbnails")
    _cat miniaturas "${bytes:-}" "" si

    # npm, pip y cargo: reconstruibles enteras desde la red, nunca contienen
    # nada que el usuario haya escrito.
    bytes=$(_du "$HOME/.npm" "$CACHE_HOME/pip" "$CACHE_HOME/go-build" "$HOME/.cargo/registry")
    _cat cacheDesarrollo "${bytes:-}" "" si

    # ── Papelera ─────────────────────────────────────────────────────────────
    bytes=$(_du "$DATA_HOME/Trash")
    detalle=$(find "$DATA_HOME/Trash/files" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l)
    _cat papelera "${bytes:-}" "$detalle" si

    # ── Carpetas del usuario (informativas) ──────────────────────────────────
    # No se limpian desde aquí: son documentos, no residuos. Salen porque en un
    # equipo normal son la mayor parte del disco y sin ellas el desglose no
    # explica dónde está el espacio.
    local ruta
    if ruta=$(_dir_usuario DOWNLOAD Descargas); then
        bytes=$(_du "$ruta")
        _cat descargas "${bytes:-}" "$ruta" si
    fi
    for par in "DOCUMENTS:Documentos:documentos" "PICTURES:Imágenes:imagenes" \
               "VIDEOS:Vídeos:videos" "MUSIC:Música:musica" "DESKTOP:Escritorio:escritorio"; do
        IFS=: read -r clave fallback id <<<"$par"
        if ruta=$(_dir_usuario "$clave" "$fallback"); then
            bytes=$(_du "$ruta")
            _cat "$id" "${bytes:-}" "$ruta" no
        fi
    done

    _emitir_categorias
}

# ── Catálogo de aplicaciones ─────────────────────────────────────────────────
# Un registro por paquete: nombre, tamaño instalado, origen (repo/AUR), si lo
# pidió el usuario o entró como dependencia, y la fecha de instalación.
#
# `explicito` + `origen` son lo que convierte la lista en accionable: lo que
# entró como dependencia y ya nadie necesita son los huérfanos (categoría
# aparte), y lo explícito es lo único que tiene sentido ofrecerse a desinstalar.
apps() {
    command -v pacman >/dev/null 2>&1 || { echo '[]'; return 0; }

    local aur_list
    aur_list=$(pacman -Qmq 2>/dev/null)

    # Lee el volcado compartido (ver `_volcado_qi`): invocar `pacman -Qi` por paquete serían ~1600
    # forks, y volver a invocarlo entero aquí eran los ~290 ms que ya pagó `categorias`.
    # Los campos llegan en bloques separados por línea en blanco.
    awk -v aur="$aur_list" '
        BEGIN {
            FS = " *: *"
            n = split(aur, a, "\n")
            for (i = 1; i <= n; i++) if (a[i] != "") esAur[a[i]] = 1
        }
        function emitir() {
            if (nombre == "") return
            u = tam; sub(/^[0-9.,]+ */, "", u)
            m = (u ~ /^KiB/) ? 1024 : (u ~ /^MiB/) ? 1048576 : (u ~ /^GiB/) ? 1073741824 : 1
            printf "%s\t%d\t%s\t%s\t%s\t%s\n", nombre, (tam + 0) * m, \
                (nombre in esAur ? "aur" : "repo"), \
                (razon ~ /Explicitly/ ? "si" : "no"), fecha, descripcion
            nombre = ""; tam = 0; razon = ""; fecha = ""; descripcion = ""
        }
        /^Name/            { nombre = $2 }
        /^Description/     { descripcion = $2 }
        /^Installed Size/  { tam = $2 }
        /^Install Reason/  { razon = $2 }
        /^Install Date/    { fecha = $2 }
        /^$/               { emitir() }
        END                { emitir() }
    ' "$(_volcado_qi)" | jq -R -s '
        split("\n") | map(select(length > 0)) | map(split("\t")) |
        map(select(length >= 6)) |
        map({
            nombre: .[0], bytes: (.[1] | tonumber), origen: .[2],
            explicito: (.[3] == "si"), fecha: .[4], descripcion: .[5]
        }) | sort_by(-.bytes)'
}

# ── Entrada ──────────────────────────────────────────────────────────────────

case "${1:-todo}" in
    discos)     discos ;;
    categorias) categorias ;;
    apps)       apps ;;
    todo)
        # El volcado de pacman se genera AQUÍ, antes de forkear: una variable asignada dentro de un
        # subshell no vuelve al padre ni llega a sus hermanos, así que con la creación perezosa los
        # tres sondeos habrían hecho cada uno su `pacman -Qi`. Igual de lento que antes, solo que
        # simultáneo y por tanto invisible en el reloj de pared.
        command -v pacman >/dev/null 2>&1 && _volcado_qi >/dev/null

        # Los tres en paralelo: `categorias` está dominado por E/S y `apps` por
        # CPU, así que solaparlos cuesta lo que el más lento en vez de la suma.
        d=$(mktemp) c=$(mktemp) a=$(mktemp)
        # Se encadena al trap que ya pueda haber puesto `_volcado_qi`: un `trap` nuevo sustituye al
        # anterior, y sin esto el volcado se quedaría en /tmp después de cada análisis.
        trap 'rm -f "$d" "$c" "$a" "$VOLCADO_QI"' EXIT
        discos >"$d" & pd=$!
        categorias >"$c" & pc=$!
        apps >"$a" & pa=$!
        wait $pd $pc $pa
        jq -n --slurpfile discos "$d" --slurpfile cats "$c" --slurpfile apps "$a" \
            --arg epoch "$(date +%s)" '{
                version: 1,
                epoch: ($epoch | tonumber),
                discos: ($discos[0] // []),
                categorias: ($cats[0] // []),
                apps: ($apps[0] // [])
            }'
        ;;
    *) echo "uso: $0 {discos|categorias|apps|todo}" >&2; exit 2 ;;
esac
