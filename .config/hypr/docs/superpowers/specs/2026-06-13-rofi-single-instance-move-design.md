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
  app single-instance no se crea ninguna ventana nueva, así que no hay `openwindow` que
  enganchar. Tampoco hay flag nativo "esta app es single-instance".
- Lo único nativo aplicable es la *acción* de mover/enfocar:
  `hyprctl dispatch movetoworkspace` y `focuswindow`.
- Por tanto la detección del relanzamiento vive en un **wrapper alrededor de rofi**.

### Señal de detección: el evento `urgent` (verificado empíricamente)

Con `misc:focus_on_activate = false` (por defecto en este sistema, confirmado), al
relanzar una app single-instance Hyprland **NO** cambia el foco ni el workspace: solo
marca la ventana existente como *urgent*. Por tanto **no se puede detectar haciendo
polling de `activewindow`** (ese fue el bug de la primera versión: nunca disparaba).

La señal fiable es el evento `urgent>>ADDRESS` del socket de eventos
(`.socket2.sock`). Verificado con ZapZap (QtWebEngine, single-instance): al relanzar,
llega `urgent>>56513e7eb010` en ~0.6s, sin ningún cambio de `activewindow`. Ese evento:
da la dirección exacta de la ventana, llega rápido, y funciona aunque `focus_on_activate`
sea false.

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

Lenguaje: **python3** (maneja el socket de eventos de forma nativa; el sistema no
tiene `socat`/`nc`). Usa `hyprctl -j` para estado y dispatch.

### Flujo

1. **Toggle**: si rofi ya está corriendo (`pgrep -x rofi`), `pkill -x rofi` y salir.
   Conserva el comportamiento toggle actual.
2. **Foto previa** (antes de abrir rofi):
   - `before`: conjunto de `address` de todas las ventanas (`hyprctl clients -j`).
   - `target_ws`: id del workspace activo (`hyprctl activeworkspace -j`). Destino.
3. **Lanzar** `rofi -show drun` (bloquea hasta que el usuario elige o cancela; rofi
   lanza la app y termina).
4. **Observar el socket de eventos** durante `TIMEOUT` (def. 5 s):
   - `openwindow>>ADDR,...` con `ADDR` **no** en `before` → multi-instancia o primer
     arranque. No hacer nada y salir. (La ventana nueva nace en el workspace actual.)
   - `urgent>>ADDR` con `ADDR` **sí** en `before` → relanzamiento single-instance →
     si la ventana está en otro workspace, `movetoworkspace target_ws,address:ADDR`;
     luego `focuswindow address:ADDR`. Salir.
   - Si se agota el timeout sin nada de lo anterior → no hacer nada (cancelaste rofi,
     relanzaste algo ya en tu workspace, o la app no emitió señal).

Nota: las direcciones en los eventos vienen **sin** prefijo `0x`; `hyprctl clients`
las da **con** `0x`. El script normaliza añadiendo `0x` a las de los eventos.

### Acción de movimiento (comportamiento elegido: "traerla a mí")

```
hyprctl dispatch movetoworkspace <TARGET_WS>,address:0x<ADDR>
hyprctl dispatch focuswindow address:0x<ADDR>
```

### Identificación de la ventana ("principal vs emergentes")

Se mueve **exactamente la ventana cuya dirección llega en el evento `urgent`** (la que
la app pidió mostrar al relanzarse). Por definición esa es su ventana principal; no se
adivina por clase.

## Casos y resultados

| Situación al lanzar desde rofi | Resultado |
|---|---|
| App multi-instancia / primer arranque (aparece ventana nueva) | No hace nada; nace en workspace actual |
| App single-instance, ventana en otro workspace, reenfoca la suya | Mueve esa ventana al workspace actual y la enfoca |
| App single-instance ya en el workspace actual | El movimiento es no-op |
| Cancelo rofi (Esc) | No hace nada |

## Limitaciones conocidas

- Si una app single-instance **no** emite `urgent` al relanzarse, no hay señal que
  detectar y el script no hace nada.
- El relanzamiento debe emitir `urgent` dentro de `TIMEOUT`. Apps muy pesadas cuyo
  segundo proceso tarde más en arrancar podrían perderse; subir `TIMEOUT` lo soluciona.
- Falso positivo posible: si durante la ventana de observación (~5 s tras lanzar) otra
  app marca `urgent` por una razón ajena (p. ej. notificación entrante), se movería esa
  ventana. La ventana de observación es corta para minimizarlo.

## Configuración

Variable al inicio del script:
- `TIMEOUT` (def. 5): segundos máximos de observación del socket de eventos.

## Archivos afectados

- Nuevo: `~/.config/hypr/scripts/rofi-launch.py` (ejecutable).
- Modificado: `~/.config/hypr/keybinds.conf` línea del bind `SUPER, SPACE`.
