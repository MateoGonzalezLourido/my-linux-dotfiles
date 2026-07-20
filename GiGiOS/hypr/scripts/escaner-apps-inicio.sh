#!/usr/bin/env bash
# escaner-apps-inicio.sh — lleva el foco a las apps que se autolanzan al arrancar.
#
# Problema: al iniciar sesión (autostart, restauración de sesión tras un
# apagado/hibernación) se abren ventanas SOLAS y no siempre en el escritorio que
# estás mirando. Acabas en un escritorio vacío mientras tus apps están en otro.
#
# Qué hace: durante VENTANA_SEGS (30 s) apunta cada ventana NUEVA que aparezca y,
# al terminar, salta al escritorio donde hayan quedado. La decisión se toma AL
# FINAL, no en cada evento, a propósito: actuar sobre la marcha haría rebotar el
# escritorio activo cinco veces mientras arranca la sesión, que es justo el ruido
# que esto viene a quitar. El coste es que la corrección llega a los 30 s.
#
#   - 0 ventanas nuevas          → no hace nada.
#   - 1 escritorio de destino    → salta a él.
#   - 2 o más escritorios        → compacta primero (compact-workspaces.sh, para
#                                  que no queden huecos entre escritorios) y salta
#                                  al destino MÁS CERCANO al escritorio activo.
#
# Solo cuentan las ventanas que NO existían al arrancar el script: lo que ya
# estaba abierto no es un autolanzamiento. Los escritorios especiales
# (scratchpad, id < 0) se ignoran — saltar ahí no es una posición donde quedarse.
#
# Es de UN SOLO USO, no un daemon: nace en autostart.conf, mira 30 s y muere. Por
# eso lee su preferencia una vez al arrancar y no necesita relanzarse al cambiarla
# (a diferencia de los *-monitor.sh; ver CLAUDE.md).
#
# Ajuste: `escanerAppsInicio` en ~/.config/gigios/preferences.json (Ajustes >
# Personalización > Ventanas y escritorios). Ausente = DESACTIVADO: mover el
# escritorio activo por su cuenta es intrusivo, así que se opta a ello, no se sale.

set -uo pipefail

VENTANA_SEGS="${GIGIOS_ESCANER_SEGS:-30}"
SONDEO_SEGS=2

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PREFS="${XDG_CONFIG_HOME:-$HOME/.config}/gigios/preferences.json"

command -v hyprctl >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# ── Preferencia (ausente = desactivado) ──────────────────────────────────────
# `// false` es seguro aquí precisamente porque el default es false: a diferencia
# del tropiezo documentado en gaming-gate.sh, que un `false` literal se confunda
# con "ausente" da el mismo resultado.
[[ -r $PREFS ]] || exit 0
[[ "$(jq -r '.escanerAppsInicio // false' "$PREFS" 2>/dev/null)" == "true" ]] || exit 0

# ── Recolección ──────────────────────────────────────────────────────────────
declare -A conocidas=()   # direcciones que NO cuentan (ya estaban, o ya apuntadas)
declare -a nuevas=()      # direcciones de ventanas aparecidas en la ventana de escaneo

apuntar() {
  local addr="$1"
  [[ $addr == 0x* ]] || addr="0x$addr"
  [[ -n ${conocidas[$addr]:-} ]] && return
  conocidas[$addr]=1
  nuevas+=("$addr")
}

# Línea base: lo que ya hay abierto no es un autolanzamiento.
while IFS= read -r addr; do
  [[ -n $addr ]] && conocidas[$addr]=1
done < <(hyprctl clients -j 2>/dev/null | jq -r '.[].address')

# Lector del socket de eventos de Hyprland. Se prefiere a sondear porque no
# fork-ea nada durante los 30 s (el arranque de sesión es justo cuando sobra
# carga) y no puede perderse una ventana que abra y cierre entre dos sondeos.
lector_eventos() {
  local sock="${XDG_RUNTIME_DIR:-/run/user/$UID}/hypr/${HYPRLAND_INSTANCE_SIGNATURE:-}/.socket2.sock"
  [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} && -S $sock ]] || return 1
  if command -v socat >/dev/null 2>&1; then
    timeout "$VENTANA_SEGS" socat -u "UNIX-CONNECT:$sock" - 2>/dev/null
  elif command -v nc >/dev/null 2>&1 && nc -h 2>&1 | grep -q -- '-U'; then
    timeout "$VENTANA_SEGS" nc -U "$sock" 2>/dev/null
  else
    return 1
  fi
}

# `< <(…)` y no una tubería: el bucle tiene que correr en ESTE shell o el array
# `nuevas` se quedaría en el subshell y se perdería al terminar.
escanear_por_eventos() {
  local hubo=0 linea
  while IFS= read -r linea; do
    hubo=1
    [[ $linea == openwindow\>\>* ]] || continue
    # openwindow>>ADDRESS,workspace,class,title — la dirección llega SIN el 0x
    # que sí trae `hyprctl clients`; lo normaliza apuntar().
    local datos="${linea#openwindow>>}"
    apuntar "${datos%%,*}"
  done < <(lector_eventos)
  # Sin socket, sin herramienta o con el socket caído no llega NADA: eso es
  # indistinguible de "30 s sin abrir ventanas", así que se distingue por si el
  # lector llegó a emitir algo. Aquí `hubo=0` significa que no podemos fiarnos.
  return $((1 - hubo))
}

escanear_por_sondeo() {
  local fin=$((SECONDS + VENTANA_SEGS)) addr
  while ((SECONDS < fin)); do
    sleep "$SONDEO_SEGS"
    while IFS= read -r addr; do
      [[ -n $addr ]] && apuntar "$addr"
    done < <(hyprctl clients -j 2>/dev/null | jq -r '.[].address')
  done
}

# El socket emite un evento por cualquier cosa (cambio de foco, de escritorio…),
# así que en una sesión que arranca prácticamente siempre habla. Si aun así no
# dijo nada, se recae al sondeo con lo que quede de ventana — no se abandona.
if ! escanear_por_eventos; then
  escanear_por_sondeo
fi

((${#nuevas[@]})) || exit 0

# ── Resolución ───────────────────────────────────────────────────────────────
# De las apuntadas, las que SIGUEN abiertas y en un escritorio normal. Se
# resuelve ahora (y otra vez tras compactar) porque compact-workspaces.sh
# renumera los escritorios: un id leído antes de compactar ya no valdría.
destinos() {
  local filtro
  filtro=$(printf '%s\n' "${nuevas[@]}" | jq -R . | jq -sc .)
  hyprctl clients -j 2>/dev/null |
    jq -r --argjson dirs "$filtro" '
      [.[] | select(.address as $a | $dirs | index($a)) | select(.workspace.id > 0) | .workspace.id]
      | unique | .[]'
}

mapfile -t ws < <(destinos)
((${#ws[@]})) || exit 0

if ((${#ws[@]} > 1)); then
  "$SCRIPT_DIR/compact-workspaces.sh" >/dev/null 2>&1 || true
  mapfile -t ws < <(destinos)
  ((${#ws[@]})) || exit 0
fi

activo=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id')
[[ $activo =~ ^-?[0-9]+$ ]] || exit 0

# El más cercano al escritorio activo; a igual distancia gana el de id menor
# (el bucle recorre `unique`, ya ordenado, y solo cambia con una mejora estricta).
destino="${ws[0]}"
mejor=$(( destino > activo ? destino - activo : activo - destino ))
for id in "${ws[@]}"; do
  d=$(( id > activo ? id - activo : activo - id ))
  if ((d < mejor)); then
    mejor=$d
    destino=$id
  fi
done

((destino == activo)) && exit 0
hyprctl dispatch workspace "$destino" >/dev/null 2>&1
