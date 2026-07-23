# Estructura de `hypr/`

Mapa de qué hay en `hypr/` y en qué orden se carga. Para instalar, ver
[SETUP.md](SETUP.md); para el **porqué** de cada decisión de diseño (por qué un
monitor se escalona así, por qué un `.conf` se genera y no se edita a mano, qué
falla si tocas X sin saber Y) ver la sección `## Hyprland structure` de
[`../CLAUDE.md`](../CLAUDE.md), que este documento no duplica.

## Árbol de directorios

```text
hypr/                       (symlink: ~/.config/hypr)
├── hyprland.conf            punto de entrada; solo `render{}` + `source=`
├── *.conf                   configs sourceados por hyprland.conf (ver tabla)
├── hypridle.conf            NO se sourcea — lo lanza autostart.conf aparte
├── hyprlock.conf            NO se sourcea — lo invoca hypridle/idle-action.sh
├── hyprpaper.conf           vacío, sin uso (el wallpaper va por awww, no hyprpaper)
├── core.conf                vacío, sin uso — no aparece en ningún `source=`
├── gpu/                      perfiles de GPU; se descomenta uno solo en hyprland.conf
│   ├── laptop-hibrida.conf
│   ├── sobremesa-nvidia.conf
│   └── nvidia-vieja-hyde.conf
├── envs/
│   └── firefox.conf         variables Wayland/Firefox, portables entre GPUs
├── shaders/                  shaders de corrección de color (daltonismo)
│   └── daltonismo-{protanopia,deuteranopia,tritanopia}.frag
├── scripts/                  todo el código de scripting (ver abajo)
│   ├── lib/
│   │   └── gaming-gate.sh   se SOURCEA desde otros scripts, no se ejecuta solo
│   └── __pycache__/          generado por Python, gitignored
├── logs/                     runtime, gitignored (`boot-healthcheck.log`)
└── docs/superpowers/          specs de diseño de features puntuales, gitignored
```

`monitor-settings.conf` e `input-settings.conf` (listados en la tabla siguiente)
también viven en esta carpeta pero **los genera AGS**, no se editan a mano — ver
la nota de cada uno.

## Carga de `hyprland.conf`

`hyprland.conf` no configura casi nada por sí mismo: fija `render.cm_enabled = false`
(lo gestiona `hyprsunset`, no Hyprland — ver `CLAUDE.md`) y hace `source=` de todo
lo demás, en este orden exacto:

| # | Archivo | Contenido | Quién lo edita |
| --- | --- | --- | --- |
| 1 | `env.conf` | Variables de entorno del sistema (cursor, `LC_TIME`) | a mano |
| 2 | `variables.conf` | Variables internas de Hyprland (`$mainMod`, `$terminal`, …) | a mano |
| 3 | `monitors.conf` | Regla comodín: preferido, escala 1 (fallback) | a mano |
| 4 | `monitor-settings.conf` | Resolución/Hz/escala/VRR por monitor concreto (`desc:`) | **AGS** (Ajustes > Pantalla) |
| 5 | `input.conf` | Teclado, ratón, touchpad (valores base) | a mano |
| 6 | `windows.conf` | Gaps, bordes, redondeo, `layout` | a mano |
| 7 | `animations.conf` | Curvas y animaciones | a mano |
| 8 | `rules.conf` | `windowrule`/`windowrulev2` (tearing, flotantes, opacidad…) | a mano |
| 9 | `keybinds.conf` | Todos los `bind =` | a mano |
| 9b | `keybinds-nop.conf` | Binds sordos: absorbe SUPER + tecla que no sea atajo | **script** (`generar-nop-binds.sh`) |
| 10 | `autostart.conf` | Todos los `exec-once =`, con el calendario escalonado | a mano |
| 11 | `permissions.conf` | `permission =` (requiere reinicio de Hyprland) | a mano |
| 12 | `gpu/<una-sola>.conf` | Perfil de GPU de esta máquina — el resto queda comentado | a mano, por máquina |
| 13 | `gaming.conf` | Ajustes de rendimiento válidos en ambas máquinas | a mano |
| 14 | `userprefs.conf` | Overrides personales sueltos | a mano |
| 15 | `input-settings.conf` | Teclado/ratón/touchpad concretos, va DESPUÉS de `userprefs.conf` a propósito | **AGS** (Ajustes > Dispositivos) |
| 16 | `envs/firefox.conf` | Variables portables Firefox+Wayland | a mano |

Tras el último `source=`, hay un `exec = aplicar-filtro-daltonismo.sh` (con
`exec`, no `exec-once`): reaplica el shader de accesibilidad también en cada
`hyprctl reload`, no solo al arrancar.

**`core.conf` y `hyprpaper.conf` existen pero están vacíos y no aparecen en
ningún `source=`** — son restos sin uso, no una pieza escondida de la
configuración. El wallpaper lo gestiona `awww` (`awww-daemon` +
`scripts/wallpaper.sh`), no `hyprpaper`.

## `hypridle.conf` / `hyprlock.conf`: fuera de la cadena de `source=`

Ninguno de los dos lo sourcea `hyprland.conf`. `hypridle.conf` lo lanza
`autostart.conf` como binario aparte (`exec-once = hypridle`), y sus
`on-timeout` no ejecutan la acción directamente sino que pasan por
`scripts/idle-action.sh` (la puerta del "Wake up" — ver `CLAUDE.md`).
`hyprlock.conf` no se lanza nunca por sí solo: lo invoca `hypridle` (`lock_cmd`,
`before_sleep_cmd`) o el propio `idle-action.sh` en su rama `lock`.

## `hypr/gpu/`

Tres perfiles, uno por hardware. `hyprland.conf` debe tener **exactamente uno**
sin comentar (`sobremesa-nvidia.conf` en este equipo). Cambiar de máquina =
comentar el actual y descomentar el nuevo antes de arrancar Hyprland.

## `hypr/scripts/`: categorías

No todos arrancan igual. Cuatro disparadores distintos:

**1. Daemons de `autostart.conf`**, con el calendario escalonado (motivo completo
en la cabecera de ese archivo y en `CLAUDE.md`):

| t= | Script | Por qué ahí |
| --- | --- | --- |
| 0 | `wallpaper.sh`, `limpiar-portapapeles.sh` + `clipboard-history.sh start`, `oom-monitor.sh`, `escaner-apps-inicio.sh` | se ve, o no puede perder eventos |
| 3–6 | `bt-monitor.sh`, `usb-monitor.sh`, `wifi-monitor.sh`, `screencast-monitor.sh` | dirigidos por eventos, compiten con el servicio al que se enganchan |
| 8–15 | `ram-monitor.sh`, `temp-monitor.sh`, `battery-monitor.sh`, `disk-monitor.sh` | sondeos de estado, nada urgente al segundo 0 |
| 20–30 | `updates-monitor.sh`, `boot-healthcheck.sh` | lo caro (red, journal completo, SMART) |

**2. Atajos de teclado** (`keybinds.conf`): `rofi-launch.py` (`SUPER+SPACE`),
`clipboard-history.sh picker` (`SUPER+V`), `grabar-pantalla.sh` /
`grabar-pantalla.sh ventana` (`CTRL+SHIFT+F` / `CTRL+SHIFT+S`),
`toggle-orion.sh` (`SUPER+ALT+SPACE`), `toggle-gaps-borders.sh`,
`compact-workspaces.sh` (`SUPER+SHIFT+N`).

**3. Invocados por AGS** (toggles de Ajustes, con `pkill` + re-exec en caliente
donde aplica): `updates-monitor.sh`, `screencast-monitor.sh` (interruptores
maestros), `aplicar-filtro-daltonismo.sh` (Ajustes > Accesibilidad),
`wallpaper.sh <ruta>` / `--random` (Orion), `lanzar-anclado.py` (lanzador de
Orion).

`usb-monitor.sh` llama él mismo a `usb-eject.sh` (botón "Expulsar" de la
notificación de conexión) y a `usb-repair.sh` (automático en cuanto detecta un
volumen sucio, sin botón ni pregunta — ver `CLAUDE.md`).

**4. Seguridad y sandboxing**, encadenados entre sí más que disparados desde
fuera: `oom-monitor.sh` (el propio daemon) llama a `run-untrusted.sh` (botón
"Lanzar aislado") y a `scan-file.sh` (botón "Escanear" y también usado desde
Ajustes > Seguridad); `scan-downloads.sh` es el escaneo forzado desde esa misma
sección.

`anclaje.py` es aparte: no lo lanza nadie directamente, lo importan como
observador tanto `rofi-launch.py` como `lanzar-anclado.py` (ver `CLAUDE.md`,
sección de anclaje de ventanas).

`scripts/lib/gaming-gate.sh` no es un script ejecutable por sí mismo — se
`source`ea desde `updates-monitor.sh` y desde `oom-monitor.sh` (sus
sub-monitores SMART y unidades) para congelar ese sondeo caro mientras juegas o
en modo ahorro. `monitor_downloads` (también dentro de `oom-monitor.sh`) usa en
cambio su propia pausa independiente (`dlPauseWhileGaming`), no esta librería
— ver `CLAUDE.md`.

## Ver también

- [`SETUP.md`](SETUP.md) — instalación en una máquina nueva, perfil de GPU,
  pasos manuales.
- [`../CLAUDE.md`](../CLAUDE.md), sección `## Hyprland structure` — el porqué
  detrás de cada script y cada decisión no obvia (por qué el hint
  `x-gigios-source`, por qué `gaming-gate.sh` congela lo que congela y no más,
  la puerta del Wake up, USB, brillo, seguridad…).
