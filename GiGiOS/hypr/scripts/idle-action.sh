#!/usr/bin/env bash
# idle-action.sh — la puerta de los listeners de hypridle.
#
# hypridle no sabe de "Wake up": cuando vence un timeout dispara su on-timeout y
# punto. Este script se interpone entre el listener y la acción real (apagar
# pantalla / bloquear / suspender) y la deja pasar SALVO que la función "Wake up"
# del menú de la barra (el logo Arch) la esté vetando.
#
# Estado: ~/.config/gigios/wakeup.json, escrito por AGS
# (ags/widget/bar/functions/wakeup.ts):
#   { "active": bool, "until": <epoch seg|null>, "screen": bool, "pid": <pid de AGS> }
#   until = null  → sin límite (el campo de minutos vacío)
#   screen = true → el Wake up también protege la pantalla (no se apaga ni bloquea)
#
# Alcances:
#   Wake up a secas          → veta SOLO la suspensión. La pantalla se apaga y
#                              bloquea como siempre (decisión del usuario: Wake up
#                              promete "no suspender", no "no bloquear").
#   Wake up + Pantalla       → veta además dpms-off y lock. El bloqueo va con la
#                              pantalla porque hyprlock la taparía, que es justo lo
#                              que la opción trata de evitar.
#
# REGLA DE ORO: ante CUALQUIER duda se EJECUTA la acción (fail-open). Solo se veta
# cuando se puede confirmar un Wake up vivo. Un fallo aquí debe degradar a "el Wake
# up no funciona" (visible, molesto, arreglable), nunca a "el PC no se suspende
# jamás" — que es silencioso, permanente y se come la batería sin que nada lo diga.
#
# Ojo: no vetamos "hasta que expire", solo respondemos a la pregunta de ahora.
# hypridle no repite un on-timeout ya disparado, así que quien apaga el Wake up
# (wakeup.ts) reinicia hypridle para volver a armar los contadores desde cero.

set -uo pipefail

STATE="${XDG_CONFIG_HOME:-$HOME/.config}/gigios/wakeup.json"

# ¿Veta el Wake up la acción "$1"?  0 = sí (no ejecutar), 1 = no (ejecutar).
blocked() {
  local action=$1 scope pid

  [[ -r $STATE ]] || return 1
  command -v jq >/dev/null 2>&1 || return 1

  # Una sola llamada a jq: alcance vigente + pid de quien lo pidió.
  # scope: "off" | "suspend" (solo suspensión) | "screen" (suspensión + pantalla).
  # La caducidad se resuelve aquí contra el reloj de pared (`now`), no confiando en
  # que alguien venga a reescribir el fichero: si AGS muere con un Wake up de 30
  # min puesto, a los 30 min deja de vetar solo.
  scope=$(jq -r '
      if (.active == true) and ((.until == null) or (.until > now))
      then (if .screen == true then "screen" else "suspend" end)
      else "off" end
    ' "$STATE" 2>/dev/null) || return 1
  [[ $scope == "suspend" || $scope == "screen" ]] || return 1

  # AGS caído = estado huérfano. Sin esta comprobación, un cuelgue de AGS con un
  # Wake up SIN límite dejaría el PC sin suspenderse para siempre, y encima sin
  # ninguna UI donde apagarlo (la UI se fue con AGS): habría que saber que existe
  # este JSON y borrarlo a mano. El pid lo resuelve en dos líneas.
  pid=$(jq -r '.pid // empty' "$STATE" 2>/dev/null) || return 1
  [[ $pid =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1

  case $action in
    suspend)       return 0 ;;
    dpms-off|lock) [[ $scope == "screen" ]] && return 0; return 1 ;;
    *)             return 1 ;;
  esac
}

case ${1:-} in
  dpms-off) blocked dpms-off || hyprctl dispatch dpms off ;;
  lock)     blocked lock     || hyprlock ;;
  suspend)  blocked suspend  || systemctl suspend ;;
  *)
    echo "uso: ${0##*/} {dpms-off|lock|suspend}" >&2
    exit 2
    ;;
esac
