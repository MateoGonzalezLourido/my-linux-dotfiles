#!/usr/bin/env bash
#
# Historial del portapapeles (cliphist + wl-clipboard), gobernado por la
# preferencia clipboardHistory de ~/.config/gigios/preferences.json (la escribe
# AGS › Ajustes › Personalización, ver widget/settings/preferences.ts).
#
#   start   arranca el watcher `wl-paste --watch cliphist store` si la pref lo
#           permite y no hay ya uno. Se lanza DESACOPLADO (setsid --fork) para
#           que sobreviva a reinicios de quien lo invoque: tanto Hyprland
#           (autostart.conf) como AGS (execAsync) lo llaman, y antes el watcher
#           moría con AGS al usar `exec`.
#   stop    mata el watcher, cierra el selector y borra el historial guardado.
#   picker  abre el selector Rofi (SUPER+V). Toggle: si ya está abierto, lo cierra.

prefs="$HOME/.config/gigios/preferences.json"
limite_historial=750
ruta_miniatura="$HOME/.config/hypr/scripts/miniatura-portapapeles.sh"
# Patrón del watcher, compartido por start/stop. (^|/) tolera ruta absoluta.
# La parte opcional también reconoce el watcher anterior para no duplicarlo
# durante la transición; el límite predeterminado actual de cliphist ya es 750.
watch_re="(^|/)wl-paste --watch cliphist store([[:space:]]+-max-items[[:space:]]+$limite_historial)?$"

history_enabled() {
    [[ ! -f "$prefs" ]] && return 0
    if command -v jq >/dev/null 2>&1; then
        # OJO: NO usar `.clipboardHistory // true`. En jq el operador // trata
        # `false` igual que `null`, así que devolvería "true" cuando la pref es
        # false y el "desactivado" nunca surtiría efecto. Leemos el valor crudo:
        # false -> desactivado; true/null(ausente) -> activado (default de fábrica).
        [[ "$(jq -r '.clipboardHistory' "$prefs" 2>/dev/null)" != "false" ]]
        return
    fi
    ! grep -Eq '"clipboardHistory"[[:space:]]*:[[:space:]]*false' "$prefs"
}

case "${1:-}" in
    start)
        history_enabled || exit 0
        pgrep -f "$watch_re" >/dev/null && exit 0
        # setsid --fork: nueva sesión + fork, el watcher queda reparentado a init
        # y NO muere aunque AGS/Hyprland reinicien.
        setsid --fork wl-paste --watch cliphist store \
            -max-items "$limite_historial" >/dev/null 2>&1
        ;;
    stop)
        pkill -f "$watch_re" 2>/dev/null || true
        pkill -x rofi 2>/dev/null || true
        command -v cliphist >/dev/null 2>&1 && cliphist wipe
        ;;
    picker)
        # Toggle primero: si el selector ya está abierto, ciérralo (aunque el
        # historial esté desactivado, para no dejar una ventana colgada).
        if pgrep -x rofi >/dev/null; then
            pkill -x rofi
            exit 0
        fi
        # Con el historial apagado no hay nada que mostrar (stop hace wipe):
        # salimos en silencio, sin abrir el selector ni notificar.
        history_enabled || exit 0
        # El diseño compartido vive en rofi/config.rasi. La búsqueda es difusa,
        # pero no se ordena por puntuación: el historial debe mantener primero
        # lo más reciente.
        tema_busqueda='
            entry { placeholder: "Buscar en el portapapeles"; }
            element { children: [ element-text, element-icon ]; }
        '
        comando_miniatura="$ruta_miniatura \"{input}\" \"{output}\" \"{size}\""
        # Selección. Si el usuario cancela (Esc) Rofi sale != 0 y `sel` queda
        # vacío: NO tocamos el portapapeles, evitando que un wl-copy vacío borre
        # lo que el usuario tenía copiado.
        # cliphist entrega primero lo más reciente. Conservamos su ID en la
        # primera columna (oculta) y anteponemos 1..750 al texto visible.
        sel="$(cliphist list | awk -F '\t' '
            function decodificar_ruta(uri, hexadecimal, caracter) {
                sub(/^file:\/\//, "", uri)
                while (match(uri, /%[0-9A-Fa-f][0-9A-Fa-f]/)) {
                    hexadecimal = substr(uri, RSTART + 1, 2)
                    if (hexadecimal == "00") return ""
                    caracter = sprintf("%c", strtonum("0x" hexadecimal))
                    uri = substr(uri, 1, RSTART - 1) caracter substr(uri, RSTART + 3)
                }
                return uri
            }

            {
                identificador = $1
                sub(/^[^\t]*\t/, "", $0)
                texto = $0
                minusculas = tolower(texto)
                es_imagen_binaria = texto ~ /\[\[ binary data .* (png|jpe?g|webp|gif|bmp|tiff) [0-9]+x[0-9]+ \]\]$/
                es_ruta_imagen = minusculas ~ /^(file:\/\/|\/).+\.(png|jpe?g|webp|gif|bmp|tiff)([?#].*)?$/

                if (es_imagen_binaria) {
                    printf "%s\t%d%cicon%c%s\n", identificador, NR, 0, 31, "thumbnail://cliphist:" identificador
                } else if (es_ruta_imagen) {
                    ruta = texto
                    if (ruta ~ /^file:\/\//) ruta = decodificar_ruta(ruta)
                    printf "%s\t%d %s%cicon%c%s\n", identificador, NR, texto, 0, 31, "thumbnail://" ruta
                } else {
                    print identificador "\t" NR " " texto
                }
            }' | \
            rofi -dmenu -display-columns 2 \
            -show-icons \
            -preview-cmd "$comando_miniatura" \
            -kb-row-select Right \
            -kb-move-char-forward Control+f \
            -matching fuzzy \
            -case-smart \
            -theme-str "$tema_busqueda")" || exit 0
        [[ -z "$sel" ]] && exit 0
        printf '%s\n' "$sel" | cliphist decode | wl-copy
        ;;
    *)
        echo "Uso: $0 {start|stop|picker}" >&2
        exit 2
        ;;
esac
