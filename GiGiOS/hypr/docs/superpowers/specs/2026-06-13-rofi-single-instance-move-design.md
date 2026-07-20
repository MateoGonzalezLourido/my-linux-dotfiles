# Diseño: mover instancia única al workspace actual al lanzar desde rofi

Fecha: 2026-06-13

## Objetivo

Cuando lanzo una app desde rofi (`SUPER+SPACE`):

1. Si la app es *single-instance* (ya hay una ventana suya abierta y al relanzarla no
   se crea otra), traer la ventana existente a mi workspace actual y enfocarla.
2. Si la app abre una ventana nueva, anclarla al workspace donde la lancé — aunque me
   haya cambiado de workspace mientras cargaba (la trae en silencio, sin moverme).

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
   lanza la app y termina). Si rofi devuelve cancelación, salir inmediatamente sin
   abrir el socket ni mantener el proceso Python durante el timeout.
4. **Observar el socket de eventos** durante `TIMEOUT` (def. 5 s) mediante una espera
   bloqueante por el tiempo restante, sin sondeo periódico:
   - `openwindow>>ADDR,...` con `ADDR` **no** en `before` → ventana nueva
     (multi-instancia o primer arranque). **Anclarla al workspace de lanzamiento**: si
     abrió en un workspace distinto de `target_ws` (porque me cambié de workspace
     mientras cargaba), traerla con `movetoworkspacesilent target_ws,address:ADDR`
     (silent = no me arrastra de vuelta). Salir.
   - `urgent>>ADDR` con `ADDR` **sí** en `before` → relanzamiento single-instance →
     si la ventana está en otro workspace, `movetoworkspace target_ws,address:ADDR`;
     luego `focuswindow address:ADDR`. Salir.
   - Si se agota el timeout sin nada de lo anterior → no hacer nada (relanzaste algo
     ya en tu workspace o la app no emitió señal).

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
| App multi-instancia / primer arranque (aparece ventana nueva) | Se ancla al workspace de lanzamiento (si me cambié, la trae en silencio) |
| La app abre varias ventanas (splash + principal) | **Se anclan todas**, no solo la primera |
| Otra app abre una ventana mientras observo (diálogo de un botón, popup) | **Se ignora**: no es la app lanzada |
| App single-instance, ventana en otro workspace, reenfoca la suya | Mueve esa ventana al workspace actual y la enfoca |
| App single-instance ya en el workspace actual | El movimiento es no-op |
| Cancelo rofi (Esc) | Sale inmediatamente y no abre el socket de eventos |

## Revisión 2026-07-20: el anclaje se limita a la app lanzada

La versión original anclaba **cualquier** ventana nacida en la ventana de observación
y **salía en la primera**. Los dos síntomas reales:

- Ventanas ajenas secuestradas — un diálogo abierto al pulsar un botón en otra app, o
  un popup de Steam/Heroic, se iba solo al workspace de lanzamiento.
- Apps multiventana **partidas** entre dos workspaces: se anclaba el splash y la
  ventana principal quedaba donde naciera (o al revés).

`TIMEOUT` era además 5 s, lo que dejaba fuera justo lo que más tarda (juegos, Electron
pesado) con el peor efecto posible: anclaje **inconsistente** según lo que tardara ese
arranque concreto.

### Identidad de la app (por qué se deduce y no se pregunta)

**rofi no puede decir qué se eligió.** `-run-command` es solo del modo `run`; en `drun`
rofi ejecuta el `Exec` del `.desktop` por su cuenta y no imprime nada. Verificado
también que rofi 2.0.0 **no** lanza vía `systemd-run` (no aparece en el binario) y que
la app queda en el cgroup genérico de la sesión (`session-1.scope`), así que tampoco hay
identidad por cgroup. No queda señal externa.

Por tanto la identidad se deduce de la **primera ventana nueva**: su `initialClass`
(no `class`, que puede cambiar en marcha) y su `pid`. Después se ancla todo lo que
coincida en clase **o** cuelgue de ese mismo árbol de procesos — la vía del pid cubre
splashes cuya clase difiere de la ventana principal (lanzadores Java, instaladores).

**Guarda contra el orden inverso.** Si una ventana ajena llega *antes* que la de la app,
fijaría la identidad y se anclaría ella mientras la app real queda suelta — el mismo
fallo con otro disfraz, y más probable ahora que se esperan 30 s. Por eso una candidata
a identidad que sea **flotante y de una clase ya presente antes de lanzar** se descarta:
no puede ser lo que acaba de abrir rofi, porque relanzar algo ya abierto va por la rama
`urgent`, no por `openwindow`. Un segundo terminal (tiled) sí fija identidad con
normalidad.

`urgent` solo se atiende **si aún no se ha abierto ninguna ventana nueva**: sabiendo ya
que la app arrancó, un `urgent` posterior es de otra cosa (una notificación entrante) y
moverla sería robar una ventana ajena.

### Verificación

`observe()` está separado de `main()` para poder ejercitarlo con eventos reales de
Hyprland sin pasar por rofi, que es interactivo. Probado en vivo con dos escenarios:

- App lanzada con dos ventanas + una app ajena → las dos primeras ancladas, la ajena
  intacta.
- Diálogo flotante ajeno **primero** y la app lenta después → el diálogo se ignora y se
  ancla la app.

## Limitaciones conocidas

- Si una app single-instance **no** emite `urgent` al relanzarse, no hay señal que
  detectar y el script no hace nada.
- La identidad la fija la primera ventana nueva no descartada por la guarda. Una ventana
  ajena **tiled** y de clase nueva que se cuele antes que la app lanzada seguiría
  fijando la identidad; no hay forma de distinguirla sin señal de rofi.
- Un juego lanzado desde Steam/Heroic que tarde más de `TIMEOUT` en abrir ventana no se
  ancla: aparece donde estés. Es el comportamiento preferido frente a arrastrarlo.

## Configuración

Variables al inicio del script:
- `TIMEOUT` (def. 30): segundos máximos de observación del socket de eventos. Subió de
  5 a 30 al añadirse el filtro por app, que es lo que hace inofensiva la espera larga.
- `PID_MAX_DEPTH` (def. 12): niveles de ancestros a recorrer al emparentar ventanas.

Rofi se lanza con `drun-use-desktop-cache` desactivado explícitamente. Con el volumen
actual de entradas `.desktop`, se evita una caché persistente adicional sin un beneficio
apreciable de tiempo de inicio.

## Archivos afectados

- Nuevo: `~/.config/hypr/scripts/rofi-launch.py` (ejecutable).
- Modificado: `~/.config/hypr/keybinds.conf` línea del bind `SUPER, SPACE`.
