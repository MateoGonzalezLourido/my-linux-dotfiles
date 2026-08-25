# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`~/GiGiOS` is a personal Hyprland/Wayland desktop system, organized dotfiles-style:
the real files live here and are "installed" to their canonical
XDG paths via **symlinks**, not copies. The three big components are:

- `ags/` — the desktop shell (AGS v2 / Astal, TypeScript + JSX for GTK4). **Has its
  own detailed `ags/CLAUDE.md` — read that before touching shell code.** Symlinked to `~/.config/ags`.
- `hypr/` — Hyprland config, hyprlock/hypridle, GPU profiles, and background monitor
  scripts. Symlinked to `~/.config/hypr`.
- `inicializador/` — `init.sh`, run once at Hyprland startup to restore saved
  hardware state (brightness, night light, wifi, bluetooth, volume). Symlinked to `~/.config/inicializador`.

Supporting dirs: `Wallpapers/` (used directly by `wallpaper.sh`, no symlink),
`bin/link.sh` (symlink manager), `install.sh` (fresh-machine bootstrap), `docs/` (specs/plans),
`system/` (ficheros que van a `/etc` y `/usr/local/bin`, **no** se symlinkean: se instalan con `sudo` —
la regla udev de escritura en USB, la carga del módulo `i2c-dev`, los perfiles TLP, el helper de
firmas de ClamAV, el helper de limpieza de disco y la cesión del botón de encendido a Hyprland; ver
las secciones de USB, de brillo, de TLP, de ClamAV, de almacenamiento y del botón de encendido).

`mime/`, `qt6ct/`, `menus/`, `kdeglobals`, `mimeapps.list` en la raíz no son un componente
propio: son fragmentos sueltos de integración de escritorio (tema Qt, asociación de apps, menú
XDG, tipos MIME) sin relación funcional entre sí. Cada uno vive en la raíz porque **espeja la
ruta relativa a `~/.config` (o `~/.local/share/mime`) de su destino**, tal como se ve en el mapeo
de `bin/link.sh` — agruparlos en una carpeta temática rompería esa correspondencia 1:1.

`power-save/config.json` y `orion/favorites.json` **ya no viven dentro del repo**: antes
`GiGiOS/cache/power-save/` y `GiGiOS/state/orion/` guardaban el dato real y un symlink XDG
apuntaba hacia dentro (mismo esquema que `ags/`/`hypr/`), pero eso dejaba datos de usuario
dentro del árbol que gestiona git — un `git clean`, un reset del checkout bare o restaurar un
backup del repo se los habría llevado por delante. Ahora viven directamente en
`~/.config/power-save/` y `~/.local/share/orion/`, sin symlink de por medio, junto con el resto
de datos de runtime (ver la sección siguiente). `bin/link.sh` migra automáticamente cualquier
instalación que todavía tenga el esquema viejo.

## Git caveat

The `.git` directory here is empty — **git commands run from `~/GiGiOS` fail.** GiGiOS is
a subtree of a separate *bare* dotfiles repo at `~/.dotfiles`, operated via the alias
`dotfiles() { git --git-dir=~/.dotfiles --work-tree="$HOME" "$@"; }` (see `install.sh`).
Do not assume normal `git status`/`git log` work here; treat this as a working tree
without local history unless the user says otherwise.

## Symlinks: install / repair / verify

The symlink layout is the load-bearing mechanism — edits here only take effect once the
canonical XDG paths point back to these files.

```sh
bin/link.sh          # create/repair symlinks; never overwrites a real dir/file (warns instead)
bin/link.sh --check  # report status only (exit 0 if everything OK)
bin/link.sh --force  # back up whatever is in the way (to ~/.dotfiles-backup-<date>) then link
```

`link.sh` is idempotent and data-safe. Beyond symlinking it also: migrates the profile photo
from its old home (`~/.cache/gigios/face.png`) to `~/.local/share/gigios/face.png` — the single
copy, read by both AGS and hyprlock, set from Ajustes > Cuenta and never versioned (it's personal).
It lives in `XDG_DATA_HOME`, **not** the cache, because nothing regenerates it: there is no master
in the repo, so a cache cleaner would delete it for good. It also
migrates leftover AGS JSON from the old `~/.config/ags/config/` into `~/.config/gigios/`;
re-applies `core.hooksPath`; y **repone `[UiSettings] ColorScheme=BreezeDark` en `kdeglobals`**
llamando a `hypr/scripts/reparar-kdeglobals.sh` — el mismo script que `gigios/autostart.lua`
ejecuta a t=0, que es lo que hace que el tema oscuro de las apps KDE se repare solo sin tener
que acordarse de correr `link.sh`. Cualquier app KDE que guarde ajustes globales (Dolphin >
Preferencias) reescribe el fichero entero con KConfig y borra ese grupo, que es el que lee
`KColorSchemeManager`: sin él Dolphin se abre en CLARO aunque `[General] ColorScheme`, la
paleta materializada y `QT_QPA_PLATFORMTHEME=qt6ct` sigan bien, y sin un solo error. Fuera de
Plasma nadie lo repone. **Antes de tocar ese script lee su sección en
[`docs/hyprland-modulos.md`](docs/hyprland-modulos.md)**: escribir sobre la ruta canónica en vez
de sobre el symlink resuelto se carga el enlace y el fallo es invisible. `install.sh` is the fresh-machine path: it clones the bare
dotfiles repo, checks out into `$HOME` (backing up conflicts), then runs `link.sh --force`.

## Per-machine application profiles

Before adding or modifying `laptop`/`desktop` configuration for an application,
read **`docs/anadir-perfiles-por-equipo.md`**. It defines the repository-wide
layout, the `auto|laptop|desktop|status` selector contract, tracked versus local
generated files, installer and preflight integration, and clean-install tests.
Follow the Kitty and Firefox implementations as its reference cases. This rule
also applies to changes made only in `install.sh`, `bin/preflight.sh`, ignore
rules, or profile documentation; do not create an independent profile mechanism
unless the application's limitations are documented there.

## Runtime config & secrets live OUTSIDE the repo

User/runtime state is **not** versioned. It lives in `~/.config/gigios/` (`display.json`,
`system_state.json`, `notifications.json`, `preferences.json`, `almacenamiento.json` —la
autolimpieza de disco, que además leen `hypr/scripts/limpiar-almacenamiento.sh` y
`limpieza-arranque.sh` con `jq`—, …), plus `~/.config/jarvis/`
and `~/.local/share/jarvis/` for the Orion launcher, `~/.config/power-save/config.json`
(umbral y filtros de modo ahorro) and `~/.local/share/orion/favorites.json` (favoritos del
launcher — ver "What this is" para por qué estos dos últimos dejaron de vivir dentro del repo).
These are data written/read by widgets and scripts at runtime — not code.

`~/.config/gigios/spotify-creds.json` y `~/.config/gigios/google-calendar-creds.json` son
**secretos en texto plano** (chmod 600) y no pueden commitearse ni copiarse dentro del repo. Se
crean una sola vez con `ags/scripts/spotify-auth.sh` y `ags/scripts/google-calendar-auth.sh`.

**El calendario ESCRIBÍA DENTRO DEL REPOSITORIO, y esa es la razón de su migración.** Los eventos
vivían en `~/.config/ags/calendar-events.json`, y `~/.config/ags` es un symlink a `~/GiGiOS/ags`:
las citas del usuario —dato personal— caían en el árbol versionado. Hoy van a
`~/.config/gigios/calendario.json` (eventos + configuración, con `version` de esquema) y
`~/.config/gigios/reloj.json` (alarmas). `modulos/calendario/persistencia/repositorio.ts` migra el
fichero antiguo una sola vez y **borra el original**: no destructivo significa que no se pierde
nada, no que se deje una copia dentro de git. El orden es escribir el destino y solo entonces
borrar el origen. Las alarmas se persisten; el temporizador y el cronómetro son de sesión.

## ⚠️ El config es LUA (migrado el 2026-07-23, hyprlang ya retirado del repo)

Desde Hyprland 0.55 hyprlang está deprecado: **si existe `hyprland.lua`, Hyprland lo carga y no
mira ningún `hyprland.conf`**. El config de esta máquina es **`hypr/hyprland.lua`** + los módulos
de **`hypr/gigios/*.lua`**. Los `.conf` de hyprlang ya no están en el repo (git los conserva si
hiciera falta consultarlos). Los `.conf` que **siguen** en `hypr/` son de **otros programas**
(`hypridle`, `hyprlock`, `hyprpaper`), que mantienen hyprlang a propósito.

**Historia completa, motivo y trampas medidas al portar (léelo antes de tocar cualquier `.lua` bajo
`hypr/`): [`docs/hyprland-lua-migracion.md`](docs/hyprland-lua-migracion.md).** Resumen de lo
imprescindible para no romper la sesión:

- Un error de Lua deja la sesión **sin atajos** salvo `SUPER + Q` (abre kitty). Cada módulo se
  carga con `util.carga` (require + pcall) para que uno roto no tumbe el resto. Si un arranque sale
  mal: TTY (`Ctrl+Alt+F2`) y `dotfiles checkout -- GiGiOS/hypr`.
- **`hyprctl keyword` YA NO EXISTE** → `hyprctl eval 'hl.config({...})'`.
- **`hyprctl dispatch` con sintaxis legacy tampoco funciona** → `hyprctl dispatch
  "hl.dsp.exec_cmd('cmd')"`. Ojo: ninguna de las dos formas falla por código de salida en la sesión
  equivocada — hay que mirar el stdout, no el rc. Los scripts migrados llevan fallback inline.
- **Un dispatcher conmutable con argumento de CADENA es un TOGGLE SILENCIOSO.**
  `hl.dsp.dpms('on')` NO enciende: `tableToggleAction()` sale por
  `if (!lua_istable(...)) return TOGGLE_ACTION_TOGGLE` y tira el `'on'`, respondiendo `ok`.
  La forma correcta es la TABLA: `hl.dsp.dpms({ action = 'on' })`. Vale para todo
  `eTogglableAction` (dpms, fullscreen, float, pin, lockgroups…). Costó el bug de la pantalla
  negra al salir de suspensión — ver la sección de suspensión en
  [`docs/hyprland-modulos.md`](docs/hyprland-modulos.md).
- `hyprctl binds -j` sigue roto en 0.56; usa la salida de texto.
- Los callbacks (`hl.on`, binds con función) tienen **timeout de 100 ms**: nada bloqueante dentro.
- **Todo atajo nuevo debe pasar por el envoltorio `bind()`** de `gigios/keybinds.lua`, no por
  `hl.bind` directo — si no, no da error, solo deja un bind sordo duplicado (ver
  `gigios/nop-binds.lua` en el documento enlazado).
- AGS **no genera código Lua**: escribe JSON (`display.json`, `devices.json`, `datetime.json` …) y
  el config lo lee con `util.leer_json`. Un JSON ausente o corrupto degrada al valor por defecto sin
  tumbar la sesión.
- Sin decodificador JSON nativo en el intérprete embebido: usa el vendorizado `gigios/json.lua`.

## Hyprland structure

Para el directorio, el orden de carga de módulos y qué script se dispara desde dónde, ver
[`docs/hypr-estructura.md`](docs/hypr-estructura.md). Para el detalle y el porqué de cada módulo
individual (GPU/pantalla/idioma por máquina, Wake up, congelar tareas al jugar, USB, brillo DDC,
puntero/hyprcursor, TLP, security monitor, ClamAV, desinstalar apps, almacenamiento y autolimpieza,
boot-healthcheck, grabar pantalla, portapapeles, franjas horarias de fondos, monitores de
batería/temperatura/RAM/disco/BT, y una decena más), ver
**[`docs/hyprland-modulos.md`](docs/hyprland-modulos.md) — léelo antes de
tocar el script o módulo que nombra su título**, porque casi todos documentan un fallo silencioso
ya medido (efecto sin error visible) que se repite si no se conoce.

Puntos que conviene recordar sin abrir el documento:

- El **perfil de GPU** es machine-specific y lo elige `~/.config/gigios/gpu-perfil` (fichero local
  fuera del repo), no un comentario a mano.
- `gigios/dispositivos.lua`, `gigios/pantalla.lua` y `gigios/env.lua` leen JSON de
  `~/.config/gigios/` (dispositivos, pantalla, idioma) escrito por AGS — ausencia de clave = no se
  aplica nada, nunca un valor de fábrica que sorprenda en otra máquina.
- `render.cm_enabled` está deliberadamente **off**: `hyprsunset` posee la CTM de KMS para la luz
  nocturna, y el color management de Hyprland encima lava la imagen.
- El arranque (`gigios/autostart.lua`) está **escalonado a propósito** (t=0 lo visible, t=3..6
  eventos, t=8..15 sondeos, t=20..30 lo caro) — no captures ese detalle sin leer el documento si vas
  a tocar los tiempos.
- **Editar un `*-monitor.sh` no afecta al que ya está corriendo**: hace falta `pkill -f
  <script>` + relanzarlo, o `hyprctl reload full-reset` (que sí re-ejecuta el autostart; un
  `hyprctl reload` normal no).

## init.sh (hardware state restore)

`inicializador/init.sh` reads `~/.config/gigios/{display,system_state}.json` and applies
brightness (`brightnessctl`), night light (`hyprsunset`), wifi (`nmcli`), bluetooth
(`bluetoothctl`), and volume/mute (`wpctl`), falling back to hardcoded defaults when a key is
absent. It's the counterpart to the AGS UI that *writes* those JSON files.

El brillo **no se restaura en un sobremesa** y no hace falta que se restaure: `apply_brightness` sale
si `/sys/class/backlight` está vacío (solo el panel interno de un portátil publica esa clase), porque
allí el brillo lo guarda el **propio monitor** en su firmware y AGS se lo lee por DDC/CI al arrancar.
Cuando sí aplica, la llamada fija `-c backlight`: sin dispositivos de esa clase `brightnessctl` **no
falla** — cae al primer dispositivo `leds` y encendía el **LED de scroll-lock del teclado** en cada
login. Ver la sección de brillo en [`docs/hyprland-modulos.md`](docs/hyprland-modulos.md).

El volumen espera antes (`wait_for_sink`, techo 10 s): init.sh sale de un `exec-once` de Hyprland
y puede ganarle la carrera al arranque de PipeWire/WirePlumber en la sesión de usuario. Hasta que
WirePlumber no publica un sink por defecto, `@DEFAULT_AUDIO_SINK@` no resuelve y los `wpctl`
fallan **en silencio** — el volumen/mute guardado simplemente no se aplicaba en los arranques que
perdían la carrera.
