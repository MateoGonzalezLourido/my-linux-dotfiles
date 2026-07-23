#!/usr/bin/env bash
# Acción del botón de encendido físico (tecla XF86PowerOff).
#
# Lo llama `bindl` desde hypr/keybinds.conf — `bindl` y no `bind` a propósito: el
# botón de encendido tiene que responder también con la sesión bloqueada, que es
# justo cuando más se pulsa (apagar el portátil sin desbloquearlo).
#
# La acción la elige el usuario en Ajustes > Energía y se guarda como `botonApagado`
# en ~/.config/gigios/preferences.json. Se lee EN VIVO, en cada pulsación: no hay
# proceso vivo al que relanzar, así que cambiar el ajuste se aplica al momento y
# esta ruta se aparta de la advertencia sobre los *-monitor.sh.
#
# OJO — systemd-logind maneja esta MISMA tecla por su cuenta (HandlePowerKey, que
# viene a `poweroff` de fábrica) y lo hace a nivel de asiento, sin pasar por el
# compositor. Si logind no está en `ignore`, las dos acciones ocurren a la vez y
# gana la suya: el PC se apaga elijas lo que elijas aquí. Por eso se instala
# system/logind.conf.d/99-gigios-powerkey.conf (install.sh, paso 9) y Ajustes >
# Energía comprueba la propiedad real de logind por D-Bus y avisa si falta.

set -uo pipefail

PREFS="${XDG_CONFIG_HOME:-$HOME/.config}/gigios/preferences.json"
ACCION_POR_DEFECTO="apagar"

leer_accion() {
  # Ausente/corrupto/sin jq → el valor de fábrica, que es el comportamiento
  # histórico (apagar). El operador `//` de jq es seguro aquí porque el valor es
  # una CADENA: solo colapsa `null` y `false`, no un texto válido. Con booleanos
  # sería un error (ver battery-monitor.sh y gaming-gate.sh).
  [[ -r "$PREFS" ]] || { printf '%s' "$ACCION_POR_DEFECTO"; return; }
  command -v jq >/dev/null 2>&1 || { printf '%s' "$ACCION_POR_DEFECTO"; return; }
  local valor
  valor="$(jq -r '.botonApagado // empty' "$PREFS" 2>/dev/null)"
  printf '%s' "${valor:-$ACCION_POR_DEFECTO}"
}

bloqueado() { pgrep -x hyprlock >/dev/null 2>&1; }

case "$(leer_accion)" in
  nada)        exit 0 ;;
  menu)
    # Bajo hyprlock el menú quedaría dibujado por debajo del bloqueo: invisible
    # ahora y abierto al desbloquear. No es una acción útil ahí, así que no se hace.
    bloqueado && exit 0
    ags request toggle-power-menu >/dev/null 2>&1
    ;;
  bloquear)
    # `setsid -f`: el bloqueo debe sobrevivir a este script, que muere enseguida.
    # La guarda evita apilar un segundo hyprlock sobre el que ya está puesto.
    bloqueado || setsid -f hyprlock >/dev/null 2>&1
    ;;
  pantalla)
    # Solo una tecla la vuelve a encender: mouse_move_enables_dpms = false
    # (hypr/windows.conf).
    hyprctl dispatch dpms off >/dev/null 2>&1
    ;;
  suspender)   systemctl suspend ;;
  hibernar)    systemctl hibernate ;;
  cerrarSesion)
    hyprctl dispatch exit >/dev/null 2>&1
    ;;
  reiniciar)   systemctl reboot ;;
  apagar|*)    systemctl poweroff ;;
esac
