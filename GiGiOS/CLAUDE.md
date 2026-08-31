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
- `inicializador/` — lo que se restaura o se abre al empezar la sesión, llamado desde el autostart
  de Hyprland. `init.sh` repone el estado del hardware guardado (brillo, luz nocturna, wifi,
  bluetooth, volumen); `apps-inicio.sh` abre las apps que el usuario haya puesto en la lista de
  inicio (`~/.config/gigios/apps-inicio.json`, escrita desde Ajustes > Apps al inicio). Ninguno de
  los dos corre "antes de Hyprland" pese al nombre del directorio: los dos salen de un `exec-once`,
  porque hasta que el compositor no está en pie no hay `WAYLAND_DISPLAY`. Symlinked to
  `~/.config/inicializador`.

Supporting dirs: `Wallpapers/` (used directly by `wallpaper.sh`, no symlink),
`audio/` (los sonidos de alarmas y notificaciones, también sin symlink: se leen de
`~/GiGiOS/audio` — un `sound-name` se resuelve **primero** contra esta carpeta y solo si falta se
delega en el tema de sonidos del sistema, que sin `sound-theme-freedesktop` instalado deja la
alarma muda sin dar ningún error; ver `audio/README.md`),
`bin/link.sh` (symlink manager), `install.sh` (fresh-machine bootstrap), `docs/` (specs/plans),
`system/` (ficheros que van a `/etc` y `/usr/local/bin`, **no** se symlinkean: se instalan con `sudo` —
la regla udev de escritura en USB, la carga del módulo `i2c-dev`, los perfiles TLP, el helper de
firmas de ClamAV, el helper de limpieza de disco, el helper de bloqueo de la cámara, el helper y la
preparación de la **hibernación**, la cesión del
botón de encendido a Hyprland y la configuración de SDDM; ver las secciones de USB, de brillo, de TLP, de ClamAV, de almacenamiento, de
cámara, de hibernación y del botón de encendido).

`system/sddm/zz-gigios.conf.in` es la única pieza de `system/` que **no se copia tal cual**: es una
plantilla que `install.sh` (paso `sddm`) materializa en `/etc/sddm.conf.d/zz-gigios.conf`
sustituyendo lo que es de cada máquina — el usuario del autologin, el `.desktop` de la sesión, el
tema (sólo si existe en el equipo) y el método de entrada. Junto a ella, `system/sddm/tema/` es el
**tema del saludador** (la variante `jake_the_dog` de sddm-astronaut-theme, recortada a lo que esa
variante usa de verdad): el mismo paso lo copia a `/usr/share/sddm/themes/gigios` y su fuente a
`/usr/share/fonts/gigios`. **Ver `system/sddm/tema/README.md`** — explica por qué el tema no puede
vivir bajo `$HOME` (el greeter corre como el usuario `sddm`, antes de que `/home` esté montado) y
por qué la fuente va aparte (el tema no usa `FontLoader`: pide `Font="Thunderman"` por nombre y la
resuelve fontconfig; sin instalar, Qt sustituye en silencio y el saludador se ve distinto sin dar
ningún error). Cuatro trampas que ya costaron su tiempo:

- **Activar SDDM es crear un SYMLINK**: `systemctl enable sddm.service` deja
  `/etc/systemd/system/display-manager.service -> /usr/lib/systemd/system/sddm.service` (la unidad
  declara `Alias=display-manager.service`). Sin ese enlace **no hay ningún error**: el equipo
  arranca hasta un TTY con todo el escritorio bien instalado y nada que lo lance. Por eso el paso
  comprueba el enlace después de activar, en vez de fiarse del código de salida, y `preflight.sh` lo
  da como ERROR.
- **`/etc/sddm.conf` gana sobre TODO `/etc/sddm.conf.d/`**, pese al nombre (`man 5 sddm.conf`). Si
  define una clave que también fijamos, manda la suya y editar el drop-in no se nota. El instalador
  compara las claves y avisa; no toca ese fichero, que es de la distribución.
- El prefijo **`zz-`** no es decorativo, y el que había antes (`99-`) **estaba mal**: `conf.d` se
  lee en orden alfabético y gana **el último**, pero los dígitos van *antes* que las letras. Con los
  restos de HyDE de esta máquina (`the_hyde_project.conf`, que fija `[Theme] Current=Candy`), un
  `99-gigios.conf` se leía **primero** y quedaba pisado entero — tema y autologin incluidos — sin un
  solo error: el saludador salía con el aspecto de HyDE y parecía que el paso `sddm` no se hubiera
  ejecutado. El instalador retira el fichero con el nombre viejo, y `preflight.sh` avisa de
  cualquier drop-in que ordene después del nuestro y fije una de nuestras claves.
- **`InputMethod=qtvirtualkeyboard` sin `qt6-virtualkeyboard` no degrada, ROMPE**: el greeter no
  llega a dibujarse y el equipo arranca a una pantalla negra, sin mensaje. Por eso es un campo de la
  plantilla y no una línea fija: el instalador sólo lo escribe si encuentra el módulo QML instalado.

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
Ajustes no copia el original: lo endereza por EXIF, lo recorta cuadrado y lo reduce a 512x512 PNG
(`ags/modulos/ajustes/cuenta/avatar.ts`), que es lo que necesitan los tres círculos donde se ve.
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
`limpieza-arranque.sh` con `jq`—, `apps-inicio.json` —las apps que se abren al iniciar sesión, que
lee `inicializador/apps-inicio.sh`—, `camara.json` —los controles V4L2 guardados por aparato, que
se reponen solos porque el kernel los pierde al desenchufar o reiniciar— y `camara-uso.json` —lo
que escribe `hypr/scripts/camara-monitor.sh` cuando una app abre la cámara— y `hibernacion.json`
—el tiempo total de inactividad hasta hibernar y **cuál de los dos mecanismos** lo cumple; lo lee
`idle-action.sh` para decidir si suspende con alarma RTC o sin ella—, …), plus `~/.config/jarvis/`
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
boot-healthcheck, apps al inicio, grabar pantalla, portapapeles, cámara (ajustes V4L2 y
detector de uso), franjas horarias de fondos,
monitores de batería/temperatura/RAM/disco/BT, y una decena más), ver
**[`docs/hyprland-modulos.md`](docs/hyprland-modulos.md) — léelo antes de
tocar el script o módulo que nombra su título**, porque casi todos documentan un fallo silencioso
ya medido (efecto sin error visible) que se repite si no se conoce.

Puntos que conviene recordar sin abrir el documento:

- El **perfil de GPU** es machine-specific y lo elige `~/.config/gigios/gpu-perfil` (fichero local
  fuera del repo), no un comentario a mano. Lo escribe el instalador (paso `gpu`, detección por
  clase PCI en `/sys`) y **nunca pisa uno que ya exista**. `integrada.lua` es el perfil vacío a
  propósito de una Intel/AMD sola: con el fichero ausente, `gpu.lua` avisa en pantalla en cada
  inicio de sesión porque no puede distinguir «no hay nada que configurar» de «no lo he elegido».
- `gigios/dispositivos.lua`, `gigios/pantalla.lua` y `gigios/env.lua` leen JSON de
  `~/.config/gigios/` (dispositivos, pantalla, idioma) escrito por AGS — ausencia de clave = no se
  aplica nada, nunca un valor de fábrica que sorprenda en otra máquina.
- `render.cm_enabled` está deliberadamente **off**: `hyprsunset` posee la CTM de KMS para la luz
  nocturna, y el color management de Hyprland encima lava la imagen.
- El arranque (`gigios/autostart.lua`) está **escalonado a propósito** (t=0 lo visible, t=3..6
  eventos, t=8..15 sondeos, t=20..30 lo caro) — no captures ese detalle sin leer el documento si vas
  a tocar los tiempos.
- **Nadie llama a `hyprlock` directamente**: los cuatro sitios que bloquean la sesión pasan por
  `hypr/scripts/bloquear.sh`, que sortea el fondo del bloqueo (un wallpaper al azar, vía un symlink
  sin extensión en la caché — hyprlang no sabe sustituir comandos) y lleva la única guarda de
  instancia única, que hyprlock no tiene. Ver su sección en
  [`docs/hyprland-modulos.md`](docs/hyprland-modulos.md).
- **Editar un `*-monitor.sh` no afecta al que ya está corriendo**: hace falta `pkill -f
  <script>` + relanzarlo, o `hyprctl reload full-reset` (que sí re-ejecuta el autostart; un
  `hyprctl reload` normal no).

## Hibernación: un número en la UI, dos mecanismos debajo

Ajustes > Pantalla > Suspensión tiene **un solo** tiempo de hibernación (inactividad total), pero
por dentro hay dos caminos y elegir mal es un fallo mudo. La razón, en una frase: **durante una
suspensión el userspace está congelado**, así que un listener de hypridle posterior a la suspensión
NO SE DISPARA NUNCA. Cuando se puede, quien cuenta es systemd (`suspend-then-hibernate` + alarma
RTC, con `HibernateDelaySec` = total − suspensión, que es una **resta**); el listener `hibernate`
de `hypridle.conf` queda solo para cuando hibernar no llega a pasar por la suspensión.

La autoridad es `~/.config/gigios/hibernacion.json`; el listener de `hypridle.conf` es su espejo.
Habilitarla en una máquina nueva es un paso propio del instalador (`--solo hibernacion`: swapfile
persistente, `resume=` en el kernel, VRAM de NVIDIA) y **no surte efecto hasta reiniciar**. Nada se
asume: `gigios-hibernacion estado` pregunta a logind y, si dice que no, la fila de Ajustes sale
apagada con el motivo escrito **y un botón «Preparar hibernación…»** que lanza ese paso en una
terminal (con «Quitar hibernación…» a la inversa) — ninguno de los dos por NOPASSWD, a propósito.
**Detalle completo, trampas y por qué de cada pieza en la sección de
hibernación de [`docs/hyprland-modulos.md`](docs/hyprland-modulos.md) — léela antes de tocar
`servicios/energia/hibernacion.ts`, `system/hibernacion/` o el listener `hibernate`.**

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
