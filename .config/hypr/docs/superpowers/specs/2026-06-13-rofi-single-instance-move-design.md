# Diseño: mover instancia única al workspace actual al lanzar desde rofi

Fecha: 2026-06-13

## Objetivo

Cuando lanzo una app desde rofi (`SUPER+SPACE`), si esa app es *single-instance*
(ya hay una ventana suya abierta y al relanzarla no se crea otra), traer la ventana
existente a mi workspace actual y enfocarla. Si la app permite múltiples instancias
(o es el primer arranque), no hacer nada: la ventana nueva ya nace en el workspace
actual.

## Realidad técnica que motiva el diseño

- Hyprland **no** puede hacer esto con `windowrule`/`layerrule` puras. Al relanzar una
  app single-instance no se crea ninguna ventana nueva, así que no se emite ningún
  evento (`openwindow`) que enganchar. Tampoco hay flag nativo "esta app es single-instance".
- Lo único nativo aplicable es la *acción* de mover/enfocar:
  `hyprctl dispatch movetoworkspace` y `focuswindow`.
- Por tanto la detección del relanzamiento vive en un **wrapper alrededor de rofi**,
  no en reglas nativas ni en un daemon de eventos (un daemon tampoco recibiría evento
  en el relanzamiento single-instance).

## Arquitectura

Un único script que **reemplaza el bind actual** de rofi:

Actual:
```
bind = SUPER, SPACE, exec, fish -c 'pkill -x rofi; or rofi -show drun'
```
Nuevo:
```
bind = SUPER, SPACE, exec, ~/.config/hypr/scripts/rofi-launch.sh
```

El script es POSIX/bash, usa `hyprctl -j` + `jq` (ambos disponibles en el sistema).

### Flujo

1. **Toggle**: si rofi ya está corriendo (`pgrep -x rofi`), `pkill -x rofi` y salir.
   Conserva el comportamiento toggle actual.
2. **Foto previa** (antes de abrir rofi):
   - `BEFORE_ADDRS`: conjunto de `address` de todas las ventanas (`hyprctl clients -j`).
   - `TARGET_WS`: id del workspace activo (`hyprctl activeworkspace -j`). Este es el
     destino al que traeremos la ventana.
   - `BEFORE_ACTIVE`: address de la ventana activa (`hyprctl activewindow -j`), puede
     estar vacío.
3. **Lanzar** `rofi -show drun` (bloquea hasta que el usuario elige o cancela; rofi
   lanza la app y termina).
4. **Polling** durante un timeout configurable (`TIMEOUT=3` s, paso `0.1` s),
   comparando contra la foto:
   - Si aparece **una dirección nueva** en `clients` → multi-instancia o primer arranque.
     No hacer nada y salir. (La ventana nueva nace en el workspace actual.)
   - Si **no** aparece ninguna nueva pero la ventana activa actual:
     - existía ya en `BEFORE_ADDRS`, y
     - es distinta de `BEFORE_ACTIVE`, y
     - está en un workspace distinto de `TARGET_WS`
     → es un relanzamiento single-instance que reenfocó su propia ventana.
       **Mover esa ventana** a `TARGET_WS` y enfocarla.
   - Si se agota el timeout sin nada de lo anterior → no hacer nada (cancelaste rofi,
     o relanzaste algo que ya estaba en tu workspace).

### Acción de movimiento (comportamiento elegido: "traerla a mí")

```
hyprctl dispatch movetoworkspace <TARGET_WS>,address:0x<ADDR>
hyprctl dispatch focuswindow address:0x<ADDR>
```

### Identificación de la ventana ("principal vs emergentes")

Se mueve **exactamente la ventana que la propia app activó** al relanzarse (la que pasó
a estar activa). Por definición esa es su ventana principal; no se adivina por clase.

## Casos y resultados

| Situación al lanzar desde rofi | Resultado |
|---|---|
| App multi-instancia / primer arranque (aparece ventana nueva) | No hace nada; nace en workspace actual |
| App single-instance, ventana en otro workspace, reenfoca la suya | Mueve esa ventana al workspace actual y la enfoca |
| App single-instance ya en el workspace actual | El movimiento es no-op |
| Cancelo rofi (Esc) | No hace nada |

## Limitaciones conocidas

- Si una app single-instance **no** reenfoca su propia ventana al relanzarse, no hay
  señal que detectar y el script no hace nada. La mayoría (navegadores, GTK/Qt, Discord,
  etc.) sí la activan.
- Una app cuya **primera** ventana tarde más que `TIMEOUT` en mapearse podría
  clasificarse mal momentáneamente. `TIMEOUT` es configurable.

## Configuración

Variables al inicio del script:
- `TIMEOUT` (def. 3): segundos máximos de observación.
- `POLL` (def. 0.1): intervalo de sondeo.

## Archivos afectados

- Nuevo: `~/.config/hypr/scripts/rofi-launch.sh` (ejecutable).
- Modificado: `~/.config/hypr/keybinds.conf` línea del bind `SUPER, SPACE`.
