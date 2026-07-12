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
#           moría con AGS al usar `exec`. Cliphist conserva como máximo las
#           750 entradas más recientes y elimina automáticamente las antiguas.
#   stop    mata el watcher, cierra el selector y borra el historial guardado.
#   picker  abre el selector rofi (SUPER+V). Toggle: si ya está abierto, lo cierra.

prefs="$HOME/.config/gigios/preferences.json"
max_items=750
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
rofi_theme_dir="$(cd -- "$script_dir/../.." && pwd)/rofi"
# Patrón del watcher, compartido por start/stop. (^|/) tolera ruta absoluta.
watch_re='(^|/)wl-paste --watch cliphist store([[:space:]]|$)'

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

clipboard_picker() {
    local runtime_dir list_file display_file thumb_dir line id preview index
    local raw thumb meta format dimensions size label sel original kind
    runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/gigios-cliphist"
    thumb_dir="${XDG_CACHE_HOME:-$HOME/.cache}/gigios/cliphist-thumbnails"
    mkdir -p "$runtime_dir" "$thumb_dir"
    list_file="$(mktemp "$runtime_dir/list.XXXXXX")"
    display_file="$(mktemp "$runtime_dir/display.XXXXXX")"
    trap 'rm -f "$list_file" "$display_file" "$runtime_dir"/raw.*' RETURN

    cliphist list > "$list_file"
    index=0
    while IFS= read -r line; do
        ((index += 1))
        id="${line%%$'\t'*}"
        preview="${line#*$'\t'}"

        if [[ "$preview" == '[[ binary data '* ]] && command -v magick >/dev/null 2>&1; then
            thumb="$thumb_dir/$id.png"
            meta="$thumb_dir/$id.meta"
            if [[ ! -s "$thumb" || ! -s "$meta" ]]; then
                kind="$(awk '{ print $(NF-2) }' <<< "$preview" | tr -cd '[:alnum:]')"
                [[ -n "$kind" ]] || kind=img
                raw="$(mktemp --suffix=".$kind" "$runtime_dir/raw.XXXXXX")"
                if cliphist decode "$id" > "$raw" 2>/dev/null; then
                    format="$(identify -format '%m' "$raw" 2>/dev/null || echo IMAGEN)"
                    dimensions="$(identify -format '%wx%h' "$raw" 2>/dev/null || echo '?x?')"
                    size="$(du -h "$raw" | cut -f1)"
                    if magick "$raw" -auto-orient -thumbnail '160x100>' -strip "$thumb" 2>/dev/null; then
                        printf '%s · %s · %s' "$format" "$dimensions" "$size" > "$meta"
                    fi
                fi
                rm -f "$raw"
            fi
            if [[ -s "$thumb" && -s "$meta" ]]; then
                label="$(<"$meta")"
                printf '%s\t🖼 Imagen · %s\0icon\x1f%s\n' \
                    "$index" "$label" "$thumb" >> "$display_file"
                continue
            fi
            preview="🖼 Imagen"
        fi
        printf '%s\t%s\n' "$index" "$preview" >> "$display_file"
    done < "$list_file"

    # La caché tampoco crece indefinidamente: como máximo una miniatura por
    # entrada permitida en cliphist (más su pequeño archivo de metadatos).
    find "$thumb_dir" -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | \
        tail -n +$((max_items * 2 + 1)) | cut -d' ' -f2- | xargs -r rm -f

    sel="$(rofi -dmenu -i -show-icons -display-columns 1,2 \
        -theme "$rofi_theme_dir/clipboard.rasi" \
        -theme-str 'entry { placeholder: " 📜 Historial..."; }' \
        < "$display_file")" || return 1
    [[ -z "$sel" ]] && return 1
    index="${sel%%$'\t'*}"
    [[ "$index" =~ ^[0-9]+$ ]] || return 1
    original="$(sed -n "${index}p" "$list_file")"
    [[ -n "$original" ]] || return 1
    printf '%s\n' "$original" | cliphist decode | wl-copy
}

case "${1:-}" in
    start)
        history_enabled || exit 0
        pgrep -f "$watch_re" >/dev/null && exit 0
        # setsid --fork: nueva sesión + fork, el watcher queda reparentado a init
        # y NO muere aunque AGS/Hyprland reinicien.
        setsid --fork wl-paste --watch cliphist store -max-items "$max_items" \
            >/dev/null 2>&1
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
        # Selección. Si el usuario cancela (Esc) rofi sale != 0 y `sel` queda
        # vacío: NO tocamos el portapapeles, evitando que un wl-copy vacío borre
        # lo que el usuario tenía copiado.
        # El índice visual es 1..750 aunque el ID interno siga creciendo. Las
        # imágenes se presentan como miniaturas, pero se copian desde cliphist.
        clipboard_picker || exit 0
        ;;
    *)
        echo "Uso: $0 {start|stop|picker}" >&2
        exit 2
        ;;
esac
