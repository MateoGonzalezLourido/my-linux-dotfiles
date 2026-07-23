# Estructura de `hypr/`

Mapa de qué hay en `hypr/` y en qué orden se carga. Para instalar, ver
[SETUP.md](SETUP.md); para el **porqué** de cada decisión de diseño (por qué el
arranque se escalona así, por qué un fichero se genera y no se edita a mano, qué
falla si tocas X sin saber Y) ver las secciones de Hyprland de
[`../CLAUDE.md`](../CLAUDE.md), que este documento no duplica.

> **El config es Lua, no hyprlang.** Desde Hyprland 0.55, si existe
> `hyprland.lua` el compositor lo carga y **no mira ningún `hyprland.conf`**. Los
> `.conf` de hyprlang se borraron al terminar la migración (2026-07-23); `git`
> los conserva si hiciera falta consultarlos. Los `.conf` que siguen aquí son de
> **otros programas** (`hypridle`, `hyprlock`, `hyprpaper`), que mantienen
> hyprlang a propósito.

## Árbol de directorios

```text
hypr/                       (symlink: ~/.config/hypr)
├── hyprland.lua             punto de entrada; render{} + la lista de módulos
├── gigios/                  los módulos del config (ver tabla)
│   ├── util.lua             carga protegida, lectura de JSON, avisos en pantalla
│   ├── json.lua             decodificador JSON vendorizado (Hyprland no trae uno)
│   ├── variables.lua        nombres de app y rutas (las viejas `$variables`)
│   └── gpu/                 un módulo por hardware; lo elige un fichero local
│       ├── laptop-hibrida.lua
│       ├── sobremesa-nvidia.lua
│       └── nvidia-vieja-hyde.lua
├── monitor-settings.lua     GENERADO por AGS (Ajustes > Pantalla)
├── input-settings.lua       GENERADO por AGS (Ajustes > Dispositivos)
├── hypridle.conf            otro binario; lo lanza el autostart
├── hyprlock.conf            otro binario; lo invoca hypridle/idle-action.sh
├── hyprpaper.conf           vacío, sin uso (el wallpaper va por awww)
├── shaders/                 shaders de corrección de color (daltonismo)
│   └── daltonismo-{protanopia,deuteranopia,tritanopia}.frag
├── scripts/                 todo el código de scripting (ver abajo)
│   ├── lib/
│   │   └── gaming-gate.sh   se SOURCEA desde otros scripts, no se ejecuta solo
│   └── __pycache__/         generado por Python, gitignored
└── logs/                    runtime, gitignored (`boot-healthcheck.log`)
```

## Carga de `hyprland.lua`

`hyprland.lua` no configura casi nada por sí mismo: fija `render.cm_enabled = false`
(lo gestiona `hyprsunset`, no Hyprland — ver `CLAUDE.md`) y carga los módulos de
`gigios/` en este orden exacto. Cada uno entra por `util.carga()` (`require` +
`pcall`): **un módulo roto avisa en pantalla y no tumba el resto**, porque un
error de Lua sin capturar deja la sesión sin atajos.

| # | Módulo | Contenido | Quién lo edita |
| --- | --- | --- | --- |
| 1 | `gigios/env.lua` | Variables de entorno del sistema (cursor, Qt, `LC_TIME`) | a mano — **salvo el bloque de idioma**, que reescribe AGS |
| 2 | `gigios/monitores.lua` | Regla comodín: preferido, escala 1 (fallback) | a mano |
| 3 | `monitor-settings.lua` | Resolución/Hz/escala/VRR por monitor concreto (`desc:`) | **AGS** (Ajustes > Pantalla) |
| 4 | `gigios/input.lua` | Teclado, ratón, touchpad y gestos (valores base) | a mano |
| 5 | `gigios/ventanas.lua` | Gaps, bordes, sombras, blur, `layout` | a mano |
| 6 | `gigios/animaciones.lua` | Curvas y animaciones | a mano |
| 7 | `gigios/reglas.lua` | Reglas de ventana y de capa | a mano |
| 8 | `gigios/compactar.lua` | `GiGiOS.compactar()` — renumera escritorios | a mano |
| 9 | `gigios/boton-apagado.lua` | `GiGiOS.boton_apagado()` — el botón físico | a mano |
| 10 | `gigios/daltonismo.lua` | `GiGiOS.daltonismo(modo)` — shader de accesibilidad | a mano |
| 11 | `gigios/keybinds.lua` | Todos los atajos + `GiGiOS.toggle_gaps()` | a mano |
| 12 | `gigios/autostart.lua` | Lo que arranca la sesión, con el calendario escalonado | a mano |
| 13 | `gigios/escaner-apps.lua` | Salto al escritorio donde abrieron las apps de autostart | a mano |
| 14 | `gigios/permisos.lua` | Permisos del ecosistema (requiere reiniciar Hyprland) | a mano |
| 15 | `gigios/gpu.lua` | Elige el perfil de GPU y carga `gigios/gpu/<perfil>.lua` | **fichero local**, ver abajo |
| 16 | `gigios/gaming.lua` | Ajustes de rendimiento válidos en ambas máquinas | a mano |
| 17 | `gigios/userprefs.lua` | Overrides personales sueltos | a mano |
| 18 | `input-settings.lua` | Teclado/ratón/touchpad concretos; va DESPUÉS de `userprefs` a propósito | **AGS** (Ajustes > Dispositivos) |
| 19 | `gigios/env-firefox.lua` | Variables portables Firefox+Wayland | a mano |
| 20 | `gigios/nop-binds.lua` | Binds sordos: absorbe SUPER + tecla que no sea atajo | a mano (es un bucle: se recalcula solo) |

**El orden no es estético**: `monitor-settings` pisa al comodín de monitores,
`input-settings` pisa a `userprefs`, y `nop-binds` va el último porque necesita
saber qué combinaciones ya usó `keybinds`.

Al final, `hyprland.lua` llama a `GiGiOS.daltonismo()` — el equivalente al viejo
`exec =`: reaplica el shader de accesibilidad también en cada `hyprctl reload`,
no solo al arrancar.

**Los dos ficheros generados se cargan con `util.carga_opcional`** (`dofile` +
`pcall`): que falten no es error — se degrada al comodín. Ojo: eso significa
240 Hz → 60 y escala 1.25 → 1, así que no los borres a la ligera; AGS los
reescribe al tocar Ajustes.

## `hyprpaper.conf` está vacío y sin uso

No lo lanza nadie. El wallpaper lo gestiona `awww` (`awww-daemon` +
`scripts/wallpaper.sh`).

## `hypridle.conf` / `hyprlock.conf`: otros programas, otro formato

Son binarios `hypr*` **separados del compositor** y siguen en hyprlang a
propósito (así lo dice el anuncio oficial de Hyprland 0.55: no necesitan un
lenguaje Turing-completo). `hypridle` lo lanza `gigios/autostart.lua`, y sus
`on-timeout` no ejecutan la acción directamente sino que pasan por
`scripts/idle-action.sh` (la puerta del "Wake up" — ver `CLAUDE.md`).
`hyprlock.conf` no se lanza nunca por sí solo: lo invoca `hypridle` (`lock_cmd`,
`before_sleep_cmd`) o el propio `idle-action.sh` en su rama `lock`.

## Perfiles de GPU: `gigios/gpu/`

Tres módulos, uno por hardware. **Ya no se descomenta una línea**: el perfil de
cada máquina lo dice `~/.config/gigios/gpu-perfil`, un fichero local de una línea
**fuera del repo** (la elección de máquina es estado local, como manda
[`anadir-perfiles-por-equipo.md`](anadir-perfiles-por-equipo.md)):

```sh
echo sobremesa-nvidia > ~/.config/gigios/gpu-perfil
```

Ausente o con un nombre inválido = no se aplica ningún perfil y sale un aviso en
pantalla; el compositor arranca igual (fail-open).

## `hypr/scripts/`: categorías

No todos arrancan igual. Cuatro disparadores distintos:

**1. Daemons de `gigios/autostart.lua`**, con el calendario escalonado (motivo
completo en la cabecera de ese módulo y en `CLAUDE.md`):

| t= | Script | Por qué ahí |
| --- | --- | --- |
| 0 | `wallpaper.sh`, `limpiar-portapapeles.sh` + `clipboard-history.sh start`, `oom-monitor.sh` | se ve, o no puede perder eventos |
| 3–6 | `bt-monitor.sh`, `usb-monitor.sh`, `wifi-monitor.sh`, `screencast-monitor.sh` | dirigidos por eventos, compiten con el servicio al que se enganchan |
| 8–15 | `ram-monitor.sh`, `temp-monitor.sh`, `battery-monitor.sh`, `disk-monitor.sh` | sondeos de estado, nada urgente al segundo 0 |
| 20–30 | `updates-monitor.sh`, `boot-healthcheck.sh` | lo caro (red, journal completo, SMART) |

El escáner de apps de inicio ya no es un script: vive en
`gigios/escaner-apps.lua`, que escucha `window.open` con datos ya tipados en vez
de parsear el socket de eventos a mano.

**2. Atajos de teclado** (`gigios/keybinds.lua`): `rofi-launch.py`
(`SUPER+SPACE`), `clipboard-history.sh picker` (`SUPER+V`), `grabar-pantalla.sh`
/ `grabar-pantalla.sh ventana` (`CTRL+SHIFT+F` / `CTRL+SHIFT+S`),
`toggle-orion.sh` (`SUPER+ALT+SPACE`).

Cuatro atajos **ya no llaman a ningún script**: son funciones Lua dentro del
propio config — pegar ventanas (`GiGiOS.toggle_gaps`), compactar escritorios
(`GiGiOS.compactar`), el botón de encendido (`GiGiOS.boton_apagado`) y el filtro
de daltonismo (`GiGiOS.daltonismo`). AGS las invoca por
`hyprctl eval 'GiGiOS.<fn>(…)'`.

**3. Invocados por AGS** (toggles de Ajustes, con `pkill` + re-exec en caliente
donde aplica): `updates-monitor.sh`, `screencast-monitor.sh` (interruptores
maestros), `wallpaper.sh <ruta>` / `--random` (Orion), `lanzar-anclado.py`
(lanzador de Orion).

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
- [`../CLAUDE.md`](../CLAUDE.md) — el porqué detrás de cada script y cada
  decisión no obvia (las trampas medidas de la API Lua, el hint
  `x-gigios-source`, por qué `gaming-gate.sh` congela lo que congela y no más,
  la puerta del Wake up, USB, brillo, seguridad…).
