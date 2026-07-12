#!/usr/bin/env bash
# Monitor de captura de pantalla (compartir + grabar).
#
# Escribe ~/.config/gigios/screencast.json; el widget de la barra (ags
# ScreencastIndicator) lo observa con un FileMonitor y muestra un icono rojo
# mientras algo esté capturando. Mismo patrón que updates-monitor.sh.
#
# Dos sub-monitores en paralelo (& + wait, patrón de oom-monitor.sh):
#   - monitor_portal:    bloquea en `pw-mon`; cubre TODO lo que pasa por
#                        xdg-desktop-portal (Discord, OBS, Zoom, navegadores).
#   - monitor_recorders: sondea `pgrep` cada 3 s; cubre los grabadores que usan
#                        wlr-screencopy (wf-recorder y cía.) y NO tocan PipeWire,
#                        así que no emiten ninguna señal a la que suscribirse.
#
# Preferencia (preferences.json), leída UNA sola vez al arrancar — patrón
# updatesMonitor: el setter maestro de AGS aplica el cambio en caliente vía
# pkill + relanzar.
#   screencastIndicator (bool, ausente=true)  maestro; false => borra json y sale

PREFS="$HOME/.config/gigios/preferences.json"
OUT="$HOME/.config/gigios/screencast.json"

# Grabadores locales (no pasan por el portal): se detectan por proceso.
RECORDERS=(wf-recorder gpu-screen-recorder wl-screenrec obs)
POLL=3          # segundos entre sondeos de grabadores
DEBOUNCE=0.3    # calma tras un evento de PipeWire antes de recalcular

# jq construye el JSON (escapa bien los nombres); pw-dump es la fuente del estado.
command -v jq      >/dev/null 2>&1 || { echo "[screencast-monitor] falta jq" >&2; exit 0; }
command -v pw-dump >/dev/null 2>&1 || { echo "[screencast-monitor] falta pw-dump" >&2; exit 0; }

# ── Preferencia (una sola lectura) ────────────────────────────────────────────
enabled=true
if [[ -r "$PREFS" ]]; then
    # `.k // true` sería incorrecto para un false literal (jq trata false como
    # ausente), de ahí el has()/tostring explícito.
    enabled=$(jq -r 'if has("screencastIndicator") then (.screencastIndicator|tostring) else "true" end' "$PREFS" 2>/dev/null) || enabled=true
fi
[[ "$enabled" == "false" ]] && { rm -f "$OUT"; exit 0; }

mkdir -p "$(dirname "$OUT")"

# ── Apagado limpio ────────────────────────────────────────────────────────────
# El toggle maestro apaga esto con `pkill -f screencast-monitor.sh`. Matamos los
# sub-monitores Y sus nietos (pw-mon, sleep) y borramos el JSON, para no dejar el
# icono encendido tras apagar la función.
pids=()
_on_term() {
    for p in "${pids[@]}"; do
        pkill -P "$p" 2>/dev/null
        kill "$p" 2>/dev/null
    done
    rm -f "$OUT" "$OUT".tmp.*
    exit 0
}
trap _on_term TERM INT

# ── Estado: quién está capturando ─────────────────────────────────────────────
# Imprime una línea `kind<TAB>app` por captura activa. Sin capturas, no imprime nada.

# Screencasts del portal. Un cast activo = nodo PipeWire Video/Source creado por
# xdg-desktop-portal-*, EXCLUYENDO las cámaras (v4l2/libcamera) para que la webcam
# no encienda el icono. Cuando se puede, se resuelve la app consumidora siguiendo
# el link hasta su nodo Stream/Input/Video; si no, la etiqueta cae a "Pantalla".
# Patrones fijados con datos reales en la Task 1 (Discord compartiendo):
#   nodo del portal   -> media.class=Video/Source, node.name="xdg-desktop-portal-hyprland"
#   webcam (a excluir)-> media.class=Video/Source, node.name="v4l2_input.*"
#   consumidor        -> media.class=Stream/Input/Video, node.name="Discord"
#                        (application.name viene VACÍO: el nombre está en node.name)
#   enlace            -> link.output.node=<portal> / link.input.node=<consumidor>, NÚMEROS
portal_sources() {
    pw-dump 2>/dev/null | jq -r '
      def props: .info.props // {};
      ([ .[]
         | select(.type == "PipeWire:Interface:Node")
         | props
         | select((."media.class" // "") == "Video/Source")
         | select(((."node.name" // "") | test("^v4l2_|^libcamera"; "i")) | not)
         | select((."node.name" // "") | test("xdg-desktop-portal|xdpw"; "i"))
         | (."object.id" // empty) ]) as $srcs
      | if ($srcs | length) == 0 then empty else
          # id del nodo consumidor -> nombre a mostrar
          ([ .[]
             | select(.type == "PipeWire:Interface:Node")
             | props
             | select((."media.class" // "") | test("Stream/Input/Video"))
             | { key:   ((."object.id" // 0) | tostring),
                 value: (."application.name" // ."node.name" // ."application.process.binary" // "Pantalla") } ]
           | from_entries) as $consumers
          | ([ .[]
               | select(.type == "PipeWire:Interface:Link")
               | props
               | select( ((."link.output.node") as $out | $srcs | index($out)) != null )
               | ($consumers[(."link.input.node" | tostring)] // empty) ]
             | unique) as $apps
          | (if ($apps | length) == 0 then ["Pantalla"] else $apps end)
          | .[]
          | "share\t" + .
        end'
}

# Grabadores locales, por proceso.
recorder_sources() {
    local r
    for r in "${RECORDERS[@]}"; do
        pgrep -x "$r" >/dev/null 2>&1 && printf 'record\t%s\n' "$r"
    done
}

# ── Escritura atómica, solo si cambió ─────────────────────────────────────────
# Se compara el conjunto de fuentes (no el JSON entero: checkedAt siempre difiere),
# así una sesión de 2 h compartiendo no reescribe el fichero ni despierta al widget.
# El memo arranca con un centinela que NO puede ser un conjunto de fuentes válido:
# si arrancara vacío, el primer emit() con nada capturando se compararía consigo
# mismo, decidiría "no ha cambiado" y NO escribiría — dejando en pie un
# screencast.json rancio de la sesión anterior (p. ej. un "Discord compartiendo"
# que sobrevive a un reboot). El icono se quedaba encendido para siempre.
last="__unset__"
emit() {
    local srcs; srcs=$(portal_sources; recorder_sources)
    [[ "$srcs" == "$last" ]] && return 0
    last="$srcs"

    local tmp="$OUT.tmp.$$"
    if [[ -z "$srcs" ]]; then
        jq -n --argjson t "$(date +%s)" '{active:false, checkedAt:$t, sources:[]}' > "$tmp" || { rm -f "$tmp"; return 1; }
    else
        printf '%s\n' "$srcs" | jq -R -s --argjson t "$(date +%s)" '
          split("\n") | map(select(length > 0) | split("\t") | {kind: .[0], app: .[1]})
          | {active: (length > 0), checkedAt: $t, sources: .}' > "$tmp" || { rm -f "$tmp"; return 1; }
    fi
    mv -f "$tmp" "$OUT"
}

# ── Sub-monitores ─────────────────────────────────────────────────────────────
# `pw-mon` bloquea imprimiendo eventos de PipeWire; cualquier línea es motivo para
# recalcular. El debounce evita recalcular N veces en la ráfaga de eventos que
# produce abrir/cerrar un stream.
monitor_portal() {
    if ! command -v pw-mon >/dev/null 2>&1; then
        # Sin pw-mon degradamos a sondeo: peor, pero el icono sigue funcionando.
        while :; do emit; sleep "$POLL"; done
        return
    fi
    pw-mon 2>/dev/null | while read -r _line; do
        sleep "$DEBOUNCE"
        emit
    done
}

monitor_recorders() {
    while :; do
        emit
        sleep "$POLL"
    done
}

emit   # estado inicial: si ya se estaba compartiendo antes de arrancar, se ve
monitor_portal   & pids+=($!)
monitor_recorders & pids+=($!)
wait
