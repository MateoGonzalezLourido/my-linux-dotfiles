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
#   picker  abre el selector wofi (SUPER+V). Toggle: si ya está abierto, lo cierra.

prefs="$HOME/.config/gigios/preferences.json"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
wofi_style="$(cd -- "$script_dir/../.." && pwd)/wofi/hyde-colors.css"
# Patrón del watcher, compartido por start/stop. (^|/) tolera ruta absoluta.
watch_re='(^|/)wl-paste --watch cliphist store$'

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
        setsid --fork wl-paste --watch cliphist store >/dev/null 2>&1
        ;;
    stop)
        pkill -f "$watch_re" 2>/dev/null || true
        pkill -x wofi 2>/dev/null || true
        command -v cliphist >/dev/null 2>&1 && cliphist wipe
        ;;
    picker)
        # Toggle primero: si el selector ya está abierto, ciérralo (aunque el
        # historial esté desactivado, para no dejar una ventana colgada).
        if pgrep -x wofi >/dev/null; then
            pkill -x wofi
            exit 0
        fi
        # Con el historial apagado no hay nada que mostrar (stop hace wipe):
        # salimos en silencio, sin abrir el selector ni notificar.
        history_enabled || exit 0
        # Selección. Si el usuario cancela (Esc) wofi sale != 0 y `sel` queda
        # vacío: NO tocamos el portapapeles, evitando que un wl-copy vacío borre
        # lo que el usuario tenía copiado.
        sel="$(cliphist list | wofi --dmenu --style "$wofi_style")" || exit 0
        [[ -z "$sel" ]] && exit 0
        printf '%s\n' "$sel" | cliphist decode | wl-copy
        ;;
    *)
        echo "Uso: $0 {start|stop|picker}" >&2
        exit 2
        ;;
esac
