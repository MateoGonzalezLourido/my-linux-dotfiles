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
`system/` (ficheros que van a `/etc`, **no** se symlinkean: se instalan con `sudo` — la regla udev de
escritura en USB, la carga del módulo `i2c-dev`, los perfiles TLP y la cesión del botón de encendido
a Hyprland; ver las secciones de USB, de brillo, de TLP y del botón de encendido).

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
and re-applies `core.hooksPath`. `install.sh` is the fresh-machine path: it clones the bare
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
`system_state.json`, `notifications.json`, `preferences.json`, …), plus `~/.config/jarvis/`
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
mira ningún `hyprland.conf`** (no conviven; la comprobación es una sola vez al arrancar). El config
de esta máquina es **`hypr/hyprland.lua`** + los módulos de **`hypr/gigios/*.lua`**. Los `.conf` de
hyprlang **ya no están en el repo**: se borraron al terminar la migración, tras verificar la sesión
real. `git` los conserva si hiciera falta consultarlos.

Los `.conf` que **siguen** en `hypr/` son de **otros programas** —`hypridle`, `hyprlock`,
`hyprpaper`—, binarios `hypr*` aparte que mantienen hyprlang a propósito. Toda la lógica de
`idle-action.sh`, la puerta del Wake Up y el truco `# GIGIOS-OFF` sigue exactamente igual.

**Si un arranque sale mal** (desde una TTY con Ctrl+Alt+F2 si no hay escritorio): **un error de Lua
deja la sesión SIN ATAJOS** salvo el de emergencia (`SUPER + Q`, que aquí abre kitty), así que desde
esa terminal se arregla el módulo o se recupera con
`dotfiles checkout -- GiGiOS/hypr`. `--verify-config` solo detecta errores de **parseo**, no de
ejecución — por eso cada módulo se carga con `util.carga` (require + pcall): uno roto avisa en
pantalla y el resto sigue, que es lo que evita el escenario "sin atajos" en la práctica.
`bin/preflight.sh` pasa `--verify-config` sobre `hyprland.lua`, así que un error de sintaxis no
llega a commitearse.

**Lo que cambia para cualquiera que toque esto:**

- **`hyprctl keyword` YA NO EXISTE** (`keyword can't work with non-legacy parsers. Use eval.`).
  El equivalente es `hyprctl eval 'hl.config({...})'`.
- **`hyprctl dispatch` con sintaxis legacy TAMPOCO funciona** — se reinterpreta como código Lua y
  da error de sintaxis. La forma es `hyprctl dispatch "hl.dsp.exec_cmd('cmd')"`. Ojo: en sesión
  legacy la forma Lua responde `Invalid dispatcher` **con rc=0**, y en sesión Lua la legacy también
  falla sin rc útil — **hay que mirar el stdout (`ok`), nunca el código de salida**. Los scripts
  migrados (`idle-action.sh`, `anclaje.py`, `lanzar-anclado.py`) llevan por eso fallback inline.
- **`hyprctl binds -j` sigue roto** en 0.56 (JSON inválido); usa la salida de texto.
- **Los callbacks (`hl.on`, binds con función) tienen timeout de 100 ms**: nada bloqueante dentro.
  Los `*-monitor.sh` siguen en bash por eso, lanzados igual desde `gigios/autostart.lua`.
- **Lo que se inlineó** (ya no se invocan sus scripts, que quedan solo para la config legacy):
  `toggle-gaps-borders.sh` → `GiGiOS.toggle_gaps()`, `aplicar-filtro-daltonismo.sh` →
  `GiGiOS.daltonismo(modo)`, `boton-apagado.sh` → `GiGiOS.boton_apagado()`,
  `compact-workspaces.sh` → `GiGiOS.compactar()`, `escaner-apps-inicio.sh` →
  `gigios/escaner-apps.lua`. Son globals del config, así que **AGS los llama por
  `hyprctl eval 'GiGiOS.daltonismo("...")'`** (verificado: `eval` comparte el estado Lua del config).
- **`keybinds-nop.conf` (335 líneas) y `generar-nop-binds.sh` están OBSOLETOS**: los 317 binds
  sordos los calcula ahora un bucle en `gigios/nop-binds.lua` contra la tabla `usados` que llena el
  envoltorio `bind()` de `gigios/keybinds.lua`. **Todo atajo nuevo debe pasar por ese envoltorio**,
  no por `hl.bind` directo (no da error: solo deja un bind sordo duplicado encima). El no-op es
  `hl.dsp.no_op()` nativo, no el `submap, reset` de antes.
- **El perfil de GPU ya no se descomenta a mano**: lo elige `~/.config/gigios/gpu-perfil`, un
  fichero local de una línea (`sobremesa-nvidia`) **fuera del repo** — la elección de máquina es
  estado local, como manda `docs/anadir-perfiles-por-equipo.md`. Ausente o inválido = ningún perfil
  + aviso en pantalla (fail-open: el compositor arranca igual).
- **Los generados por AGS pasan a `.lua`**: `monitor-settings.lua` e `input-settings.lua` (chunks
  Lua puros, cargados con `util.carga_opcional` = `dofile` + pcall). Ausentes **ya no son error
  duro** (con `source =` sí lo eran), pero su ausencia sí devolvería la pantalla al comodín
  (240 Hz → 60, escala 1.25 → 1), así que se generaron a mano al activar y AGS los reescribe al
  tocar Ajustes.
- **Sin decodificador JSON nativo** en el intérprete embebido: hay uno vendorizado en
  `gigios/json.lua` (solo lectura). `io`, `os.execute`, `require` y `dofile` sí están (Lua 5.5), y
  `package.path` apunta al directorio del config, así que `require("gigios.x")` resuelve solo.

**Trampas medidas al portar** (no las redescubras):

- **`size = "60% 60%"` NO funciona en Lua.** `size`/`move` van al motor de expresiones (muParser),
  que **no tiene operador `%`**: la regla se registra sin error, no sale nada en el log ni en
  `configerrors`, y el tamaño sencillamente no se aplica. Se escribe `monitor_w*0.6 monitor_h*0.6`.
- **`{mouse=true}` no existe** como opción de `hl.bind` pese a aparecer en el ejemplo oficial de
  `/usr/share/hypr/hyprland.lua`. Los `bindm` van con **`{drag=true}`**.
- **`cursor:no_hardware_cursors = false` se descarta en silencio** en 0.56 (queda en auto). Por eso
  `gpu/laptop-hibrida.lua` no la pone.
- **En `hl.dsp.window.move`, "silent" se dice `follow = false`** (un `silent = true` se ignora), y el
  selector por string necesita el prefijo `address:` — un `'0x…'` a secas no casa y el dispatcher
  mueve **la ventana activa**. `hl.get_window("0x…")` devuelve `nil`: el objeto sale de
  `hl.get_windows()`.

**Lo que se llevó por delante la limpieza** (todo sustituido, nada perdido): los `.conf` portados,
`keybinds-nop.conf` y `generar-nop-binds.sh`, y los cinco scripts inlineados
(`toggle-gaps-borders.sh`, `aplicar-filtro-daltonismo.sh`, `boton-apagado.sh`,
`compact-workspaces.sh`, `escaner-apps-inicio.sh`). `bin/preflight.sh` ya no parsea `source =`:
valida los `util.carga()` de `hyprland.lua`, los perfiles de `gigios/gpu.lua`, las rutas de
`gigios/autostart.lua` y que el config pase `--verify-config`.

**La sección "Atajos" de Orion parsea el CONFIG COMO CÓDIGO FUENTE**, y eso era el bloqueante de
esta limpieza: leía `keybinds.conf` + `variables.conf` como texto. Hoy lee `gigios/keybinds.lua` +
`gigios/variables.lua` (`ags/modulos/orion/data/keybinds.parse.ts`, puro y con tests de node). El
Lua trae dos formas que hyprlang no tenía y que el parser **debe** entender: expresiones
(`mod .. " + SHIFT + F"`) y **bucles** — los 20 atajos de workspace y los 8 de foco/movimiento ya no
están escritos uno a uno. Sin expandir los bucles la lista perdía 28 de 67 atajos **en silencio**,
de ahí el test que cuenta.

## Hyprland structure

For the directory layout, the module load order, and which script fires from where, see
[`docs/hypr-estructura.md`](docs/hypr-estructura.md) — this section only covers the *why* behind
specific decisions, not a structural map.

**El razonamiento de abajo sigue vigente aunque la sintaxis haya cambiado**: `gigios/*.lua` es un
port fiel de los `.conf`, así que donde se lea "`keybinds.conf`" o "un `source =`" hay que entender
su módulo equivalente. `hypr/hyprland.lua` is a thin entry point that loads the split modules
(`env`, `monitores`, `input`, `ventanas`, `animaciones`, `reglas`, `keybinds`, `autostart`,
`permisos`, …). Note:

- **GPU profile is machine-specific**: exactly one module under `hypr/gigios/gpu/` is loaded
  (`laptop-hibrida.lua` / `sobremesa-nvidia.lua` / …), y **ya no se descomenta a mano** — lo elige
  `~/.config/gigios/gpu-perfil`, un fichero local de una línea fuera del repo.
- `input-settings.lua` is **generated by AGS** and loaded after `gigios/userprefs.lua` — don't
  hand-edit it as the source of truth.
- `monitor-settings.lua` is **también generado por AGS** (Ajustes > Pantalla, vía
  `ags/servicios/pantalla/service.ts`) y se carga **después de `gigios/monitores.lua`**, cuya única
  regla es la comodín (preferido, escala 1). Resolución/Hz/escala/VRR/posición se aplicaban
  antes solo **en vivo** (`hyprctl keyword monitor`) y al arrancar AGS, guardándose únicamente en
  `~/.config/gigios/display.json` — que Hyprland no lee. Resultado: cualquier **`hyprctl reload`**
  releía los configs y devolvía la pantalla a modo preferido y escala 1 (240 Hz → 60 Hz, 1.25 → 1),
  sin que AGS se enterara (no hay señal de recarga, y su poller solo observa). Las reglas van por
  `desc:` (estable entre reconexiones, a diferencia de `DP-1`) y una regla concreta gana a la
  comodín. Efecto extra: el compositor ya arranca en el modo bueno, sin el parpadeo de la
  re-aplicación. `display.json` sigue siendo la fuente de verdad; este `.lua` es un volcado.
  **Que falte ya no es error duro** (con `source =` sí lo era: sacaba el overlay de Hyprland), pero
  su ausencia devolvería la pantalla al comodín, así que no lo borres a la ligera.
- Colour management (`render.cm_enabled`) is deliberately **off** because `hyprsunset` owns the
  KMS CTM for night light; enabling Hyprland's CM too washes out the image.

`hypr/gigios/autostart.lua` launches the shell (`ags run ~/.config/ags/`), `hypridle`, `init.sh`,
`wallpaper.sh`, and a set of `hypr/scripts/*-monitor.sh` background daemons (battery, temp,
ram, disk, oom, wifi, usb, bt, screencast, updates). Todo ello cuelga de un
`hl.on("hyprland.start", …)`, que es el equivalente EXACTO de `exec-once`: se dispara una vez por
sesión y un `reload` **no** lo repite (medido). El código de nivel superior del config sí se
re-ejecuta en cada reload — esa es la semántica del viejo `exec =`, y es donde vive la llamada a
`GiGiOS.daltonismo()`. Use `hyprctl reload` for a normal config reload. To restart Hyprland
correctly —including re-running the autostart— use the newer `hyprctl reload full-reset`; a plain
reload does not restart those commands. Relaunch AGS separately when its code changes.

**El arranque está ESCALONADO, y `gigios/autostart.lua` es el único sitio donde se lee el
calendario entero.** Todo esto salía a la vez y competía con la carga de Hyprland y del shell con la caché
fría. La regla: lo que se ve (wallpaper, AGS, `init.sh`) o lo que no puede perder eventos va a
t=0; lo que solo consulta el estado del PC se aparta — eventos a t=3..6 (bt, usb, wifi,
screencast), sondeos a t=8..15 (ram, temp, batería, disco), y lo caro al final (updates t=20,
`boot-healthcheck` t=30, que antes esperaba 5 s por dentro). Van a segundos DISTINTOS a
propósito: darles a todos el mismo `sleep` solo movería la avalancha unos segundos más tarde.

**El retardo vive en el punto de llamada, no dentro de los scripts**, y eso es deliberado:
`screencast-monitor` y `updates-monitor` también los lanza AGS en caliente desde sus
interruptores de Ajustes (setter maestro = `pkill` + re-exec), así que un `sleep` interno haría
que encender el interruptor tardara y pareciera roto. La excepción es `oom-monitor.sh`, que se
escalona por dentro porque sus sub-monitores no corren el mismo riesgo (ver su sección).

**Editar un `*-monitor.sh` NO afecta al que ya está corriendo — hay que matarlo y relanzarlo.**
Son `exec-once`, así que viven desde el login; una recarga normal (`hyprctl reload`) **no** los
reinicia, mientras que `hyprctl reload full-reset` sí vuelve a ejecutar el autostart. Bash además
ya tiene el bucle parseado en memoria, de
modo que el proceso vivo sigue ejecutando el código **anterior** a tu edición: el fichero en disco
y lo que corre divergen sin ningún aviso. Se manifiesta como "mi cambio no hace nada" horas
después — así se coló una tanda de notificaciones de USB sin el hint `x-gigios-source` cuando ya
estaba puesto en el script. Tras editar: `pkill -f ~/.config/hypr/scripts/<x>-monitor.sh` y
relanzarlo (`setsid nohup … &`), o cerrar sesión. Ojo al comprobarlo: `battery-monitor` y
`temp-monitor` **salen solos** si su toggle está a `false` en `preferences.json`, y `disk-monitor`
/ `wifi-monitor` no son daemons persistentes — que no aparezcan en `ps` no significa que fallen.

**`wifi-monitor` distingue tres desenlaces, y antes no.** Salía con un aviso **crítico** en cuanto
`nmcli` no le daba interfaz, sin mirar por qué, juntando dos casos opuestos: en un **sobremesa sin
wifi** (este equipo: solo `enp4s0`; ni `/sys/class/net/*/wireless`, ni entrada en `rfkill`, ni
tarjeta PCI) era un popup rojo en **cada login** anunciando que un hardware inexistente no existe
—ruido del que enseña a ignorar los críticos—; y en un **portátil** era una carrera que se
resolvía **mintiendo** (sale de un `exec-once` a la vez que NetworkManager: perder la carrera
avisaba de "no hay WiFi" habiéndola, y dejaba la sesión sin monitor). Hoy: hay interfaz → vigila;
**no hay hardware → sale en silencio** (se mira `/sys/class/net/<if>/wireless`, que lo publica el
**kernel** y no depende de NM, así que no reintroduce la carrera); hay antena pero NM no la
publica → reintenta 30 s y solo entonces avisa, que ahí sí es un problema real.

**Una vez con interfaz, es 100 % dirigido por eventos**: bloquea en `nmcli monitor` (D-Bus de
NetworkManager) y no sondea nada mientras está inactivo. La línea global `"Connectivity is now
'X'"` de `nmcli monitor` refleja la conectividad **primaria** de NetworkManager, no la de la wifi
en concreto — con cable y wifi a la vez ese evento puede venir del cable —, así que ante cualquier
cambio se reconsulta la conectividad **por interfaz** (`IP4-CONNECTIVITY` de `$IFACE`) y solo se
avisa de portal cautivo si el portal es el de la wifi. `LC_ALL=C` fuerza inglés en la lectura de
`nmcli monitor` porque sus palabras clave (`connected`/`disconnected`) son fijas en ese idioma
independientemente del locale del sistema — lo que ve el usuario por `notify-send` sigue en
español, definido aparte en las funciones `notify_*`. Si `nmcli monitor` muere (NetworkManager se
reinicia), el bucle exterior lo relanza en vez de dejar el daemon colgado para siempre.

### Wake up: la puerta `idle-action.sh` delante de hypridle

**Los `on-timeout` de `hypridle.conf` ya no llaman a la acción: llaman a
`hypr/scripts/idle-action.sh {dpms-off|lock|suspend}`**, que la ejecuta salvo que la función
**Wake up** del menú del logo Arch la esté vetando ("que el PC no se suspenda aunque no lo toque").
Hizo falta una puerta porque hypridle **no tiene API en caliente**: no se le puede desactivar un
listener suelto ni recargarle el config. Las dos alternativas se descartaron con motivo.
`systemd-inhibit --what=idle` (que hypridle sí respeta) apaga **todos** los listeners a la vez, y
entonces "que no se suspenda **pero la pantalla sí se apague**" —el modo por defecto— es
inexpresable. Y reutilizar el `# GIGIOS-OFF` que ya sabe comentar listeners (Ajustes > Pantalla)
significaría **escribir en el config del usuario** para un estado temporal: si AGS muere a mitad,
sus tiempos quedan desactivados para siempre y la UI de Ajustes los enseña apagados, confundiendo
"lo apagué yo" con "lo apagó el Wake up".

**Alcance**: Wake up a secas veta **solo `suspend`** — la pantalla se apaga a los 10 min y bloquea
a los 11, como siempre. Con la subopción **Pantalla** veta además `dpms-off` **y `lock`**: el
bloqueo va atado a la pantalla porque hyprlock la taparía, que es justo lo que la opción evita.
`on-resume` **no** pasa por la puerta: encender la pantalla al volver no se veta nunca, y es lo
único que la despierta si vuelves con el ratón (`mouse_move_enables_dpms = false` en
`gigios/ventanas.lua`; solo una tecla la enciende por su cuenta).

**Estado**: `~/.config/gigios/wakeup.json`, `{active, until, screen, pid}`, escrito por AGS
(`ags/servicios/energia/mantenerDespierto.ts`) y leído por el script — misma dirección que
`runtime-state.json`, no al revés que los `*-monitor.sh`. `until` es **epoch absoluto**, no un
contador: así la puerta resuelve la caducidad sola contra el reloj de pared aunque nadie reescriba
el fichero, y la cuenta atrás no se desfasa tras una suspensión manual (los timeouts de GLib no
corren dormidos). `pid` es el de AGS y la puerta comprueba que sigue vivo.

**Todo error ejecuta la acción (fail-open), y esa asimetría es el diseño**: sin fichero, con JSON
corrupto, sin `jq`, con el pid muerto o con el plazo vencido, la acción sale. Un fallo aquí debe
degradar a "el Wake up no funciona" —visible y arreglable— y nunca a "el PC no se suspende jamás",
que es silencioso, permanente, se come la batería y **no tiene UI donde apagarse** si AGS ya no
está. Por eso hay dos guardas encadenadas y no una: el `pid` cubre "AGS murió y no volvió", pero
los pid **se reciclan** —tras un reinicio el del AGS anterior puede estar ocupado por otro proceso
vivo y la puerta lo daría por bueno—, así que además `initWakeUp()` **limpia el JSON al arrancar**
el shell. El Wake up es por sesión, como el resto del menú de funciones.

**Al caducar se reinicia hypridle** (`pkill hypridle; hypridle &`, el mismo gesto que ya hace
`ags/modulos/ajustes/pantalla/Inactividad.tsx` al guardar los tiempos). No es opcional: hypridle **no repite un `on-timeout`
ya disparado** en esa tanda de inactividad, así que un Wake up de 30 min que veta la suspensión en
el minuto 11 y caduca en el 30 dejaría el PC despierto **para siempre** — nadie volvería a
intentarlo hasta que tocaras el teclado. Reiniciarlo rearma los contadores desde cero: se suspende
~11 min después de caducar, y nunca estando tú delante. El peaje aceptado es ese margen extra.

**Si tocas los `on-timeout`, mira `kindOf()`** en `ags/servicios/pantalla/hypridle.ts`: Ajustes >
Pantalla reconoce los tres listeners **por su comando**, y ahora los tres nombran el mismo script
—los distingue el argumento—. Si dejara de reconocerlos, sus tiempos se volverían ineditables **en
silencio** (`parseHypridle` degrada a "no encontrado", no a un error). Sigue leyendo también el
formato directo (`hyprctl dispatch dpms off` / `hyprlock` / `systemctl suspend`) para un config
traído de otra máquina. Cubierto por `hypridle.test.ts`.

**Desactivar un tiempo se hace comentando la línea, NUNCA con `timeout = 0`.** Cada fila de Ajustes
> Pantalla lleva un interruptor que apaga *ese* listener (`FilaInactividad` en
> `ags/modulos/ajustes/pantalla/Inactividad.tsx` →
`writeHypridle(…, {enabled:false})` → `# timeout = N   # GIGIOS-OFF`). El 0 no es una forma pobre de
decir "nunca": es lo contrario. Medido en hypridle 0.1.7 — con `timeout = 0` el listener **se
registra y se dispara al instante** (`Registered timeout rule for 0s`, y la acción ejecutada ya), o
sea que ponerlo en la fila "Suspender" apagaría el PC nada más guardar. Comentado, hypridle saca un
`Category has a missing timeout setting`, **ignora ese listener y sigue con los demás** (también
medido) — y el valor sobrevive dentro del comentario, así que al reencender vuelve el número del
usuario. De ahí el suelo de 1 min al leer el fichero: un listener ausente parsea a `{timeout: 0}`, y
ese 0 llegaría al `.conf` al encender la fila. **El estado del interruptor sale de `parseHypridle`,
no de un `true` fijo**: cuando la UI escribía `enabled: true` a pelo, mover cualquier stepper
reescribía los tres listeners como activos y resucitaba en silencio un GIGIOS-OFF ya puesto.

### Botón de encendido: `gigios/boton-apagado.lua` + `system/logind.conf.d/`

Ajustes > Energía decide qué hace la pulsación **corta** del botón físico (apagar, suspender,
hibernar, bloquear, apagar la pantalla, abrir el menú de energía, cerrar sesión, reiniciar o
nada). Lo ejecuta `GiGiOS.boton_apagado()` (`hypr/gigios/boton-apagado.lua`) desde el bind de
`XF86PowerOff` con **`{ locked = true }`** en `gigios/keybinds.lua` — `locked` (el viejo `bindl`)
porque el botón tiene que responder también con hyprlock puesto, que es justo cuando más se pulsa.
Era un script de bash (`boton-apagado.sh`); se inlineó al migrar a Lua, y con él desapareció la
doble indirección bind → bash → `hyprctl dispatch`.

**El shell NO ejecuta la acción, solo guarda la elección** (`botonApagado` en
`preferences.json`), y el config la relee **en cada pulsación** (`util.leer_json`, no la caché de
`util.prefs()`). Así el botón sigue funcionando
con AGS caído (con la acción de fábrica, `apagar`) y cambiar el ajuste no necesita relanzar nada
— se aparta de la advertencia general de los `*-monitor.sh` porque no hay proceso vivo. La única
acción que sí pasa por AGS es `menu`, vía `ags request toggle-power-menu`, y bajo hyprlock **no
se hace**: el menú quedaría dibujado por debajo del bloqueo y abierto al desbloquear.

**Sin ceder la tecla, el bind se ejecuta pero NO se nota — y ese es el modo de fallo.**
`systemd-logind` maneja esa misma tecla por su cuenta (`HandlePowerKey`, **`poweroff` de
fábrica**) a nivel de **asiento**, leyendo el evento de entrada sin pasar por el compositor. O
sea que las dos acciones ocurren a la vez y gana el apagado de logind: elijas lo que elijas, el
PC se apaga, y sin ningún error por ningún lado. De ahí `system/logind.conf.d/99-gigios-powerkey.conf`
(`HandlePowerKey=ignore`), que como la regla udev de USB y el `i2c-dev` va a `/etc` y **no se
symlinkea**: lo copia `install.sh` (paso 9) y recarga con **`systemctl reload systemd-logind`**
— `reload`, no `restart`, que puede llevarse la sesión por delante. La pulsación **larga** se
deja como esté (`HandlePowerKeyLongPress`, `ignore` por defecto): es la salida de emergencia del
firmware y no debe depender de que el shell responda.

**La UI comprueba la propiedad REAL de logind, no la presencia del fichero**: `busctl --system
get-property … HandlePowerKey` (sin privilegios), en `ags/servicios/energia/botonEncendido.ts`.
El fichero puede estar en otro sitio, o el valor cambiado a mano, así que preguntar a logind es
la única respuesta que no miente. El aviso solo sale cuando la elección **de verdad no puede
cumplirse**: con `apagar` el resultado es el mismo venga de quien venga, y avisar ahí sería ruido.
Un `null` (no se pudo consultar) **no** avisa — no poder comprobarlo no es saber que está mal.

### Notificaciones de los scripts: el hint `x-gigios-source`

**Todo `notify-send` de `hypr/scripts/` lleva `-h string:x-gigios-source:system`** (44 llamadas,
12 scripts; dos de ellos —`run-untrusted.sh`, `scan-file.sh`— lo centralizan en su wrapper
`notify() { notify-send -h … -a "$APP" "$@"; }`). No es decorativo: es lo que hace que el popup
salga con el **skin dunst** — esquinas rectas, marco de 3 px, monoespaciada y fondo sólido por
urgencia (azul `#285577` normal, `#900000` con marco `#ff0000` crítica, `#222222` baja), y **sin
nombre de app ni icono**, porque el `format` por defecto de dunst es `"<b>%s</b>\n%b"`. Las apps
normales conservan el diseño del shell. **Un script nuevo que se olvide del hint saldrá con el
diseño normal**, sin error ni aviso — es el único modo de fallo aquí.

El hint no pinta nada por sí mismo: lo lee el **motor de reglas** (`match.source`), y quien pide
el skin es una regla builtin visible y desactivable desde Ajustes, **`builtin.system-dunst`**
(`ags/modulos/notificaciones/rules/defaults.ts`). Una regla de usuario de más prioridad la pisa —
para sacar del skin a algo del sistema, o para metérselo a una app normal. **Consecuencia
aceptada**: al estar cubiertas por una regla, las notificaciones de los scripts **no aparecen en
el historial** ("Tipos sin regla"). Ver `ags/CLAUDE.md`.

Se eligió el hint y no "casar por nombre de app" porque 44 de las 47 llamadas no pasan `-a`, así
que llegan como app `notify-send`: filtrar por ahí le habría puesto el skin también a cualquier
`notify-send` lanzado a mano desde una terminal. El hint es inequívoco y no cambia el nombre que
se ve. Ojo al leerlo en AGS: se saca con `hints.lookup_value()` de la clave suelta, **no** con el
`extractHints()` que ya existe — ese hace `recursiveUnpack()` de todo el `a{sv}`, y un
`image-data` trae los píxeles en crudo; hoy solo se libra de ese coste porque únicamente corre
cuando una regla reescribe texto.

### Congelar tareas de fondo al jugar — y en modo ahorro (`lib/gaming-gate.sh`)

**El "modo juego" tiene dos mitades, y antes solo existía una.** El auto-DND ya callaba las
notificaciones mientras juegas, pero nada quitaba la CARGA: los sondeos de mantenimiento seguían
despertando discos, forkeando y tocando la red en mitad de una partida. `hypr/scripts/lib/gaming-gate.sh`
es la otra mitad — se **sourcea** (no se ejecuta) y expone `gaming_active` / `gaming_gate_wait`.

**No detecta nada nuevo**: reutiliza el flag que ya escribía AGS en `runtime-state.json`
(`servicios/energia/gamingState.ts`, que a su vez reutiliza el `isGameClient` de la barra). Bash no
sabría detectar un juego mejor que el shell.

**Qué se congela** — solo sondeo de mantenimiento, caro y sin nada urgente que mirar:
`updates-monitor.sh` (red + BD temporal de pacman), `monitor_smart` (smartctl **despierta cada
disco físico**) y `monitor_units` (4 forks de `systemctl` + awk cada 120 s). `monitor_downloads`
conserva su propia pausa `dlPauseWhileGaming` — más específica y ya tiene UI —, que es **la más cara
de todas** (clamscan recarga ~200 MB de firmas por invocación) y por eso **viene ACTIVADA por
defecto**, al revés que sus dos hermanas (`dlPauseOnBattery`/`dlPauseInPowerSave` siguen en `false`:
sacrificar seguridad por autonomía lo decide el usuario). De ahí que los defaults sean **por clave**
en `ags/modulos/ajustes/seguridad/preferencias.ts` y no uno común. En bash **no puede leerse con `.dlPauseWhileGaming // true`**:
el operador `//` de jq trata un `false` literal como ausente, así que apagar la pausa desde la UI no
habría servido de nada — va con la forma `if has(…)`, el mismo tropiezo ya documentado en
`battery-monitor.sh`.

**Qué NO se congela, y no es un olvido.** Los tres **seguidores** de eventos (`monitor_kernel`,
`monitor_system`, `monitor_files`) leen con `-n 0` a propósito y **no recuperan el pasado**:
congelarlos convertiría un OOM, un `sudo` fallido o un cambio en `/etc/shadow` en una **ventana
ciega**, y encima no ahorraría nada — bloqueados en `journalctl -f`/`inotifywait` ya cuestan ~0 %
de CPU. `temp-monitor.sh` tampoco: jugar es exactamente cuando la CPU y la GPU se cuecen, así que
congelar el termómetro apagaría la alarma en el único momento que importa. `ram-monitor` y
`battery-monitor` son bucles de builtins puros (cero forks por tick) y vigilan cosas que importan
MÁS con un juego delante. `usb`/`bt`/`wifi`/`screencast` son event-driven y de cara al usuario.
`disk-monitor` es one-shot: para cuando juegas ya salió.

**El gate BLOQUEA, no SALTA**: el trabajo aplazado se hace al descongelar, no se pierde. Por eso
va justo **antes del cuerpo del sondeo y después de la espera** — así `updates-monitor` sigue
bloqueado en su `inotifywait` (que no cuesta nada) y solo se retiene el `run_check`.

**"Juego abierto" no es "estás jugando", y confundirlos congelaba el mantenimiento el día entero.**
`gaming` vive hasta que la ventana **cierra** —a propósito: irte a otro workspace 30 s no es dejar de
jugar—, así que con eso solo, dejar un juego aparcado en el ws9 mientras trabajas bloqueaba
updates/SMART/units **indefinidamente y en silencio**. Por eso `gamingState.ts` publica además
`gameFocused` y `lastGameFocus` (epoch **absoluto**, por lo mismo que el `until` de `wakeup.json`:
la gracia se resuelve contra el reloj de pared sin que nadie reescriba el fichero, y no se desfasa
tras una suspensión). El gate congela si el juego **tiene el foco**, o si lo perdió hace menos de
`GAMING_FOCUS_GRACE` (5 min). La gracia evita el fallo contrario, que sería peor: descongelar en
cada alt-tab haría que un vistazo de 10 s a Discord lanzara `smartctl` y `clamscan` con el juego
cargado y a punto de recuperar el foco. Se escribe solo en la **transición** (el juego coge o pierde
el foco), no en cada cambio de ventana. Un fichero de un AGS anterior, sin esas claves, conserva el
comportamiento de antes (congelar mientras el juego viva) y se auto-corrige al reescribirse.
Verificado en vivo con eventos reales: abrir → congela; cambiar de workspace → sigue congelado
dentro de la gracia y descongela fuera de ella; volver al juego → **vuelve a congelar**; cerrar → libera.

**Al descongelar espera `GAMING_GATE_RESUME_DELAY` (5 s) antes de trabajar.** Al cerrar un juego el
sistema todavía está devolviendo RAM y VRAM y bajando relojes, y arrancar ahí mismo un `smartctl` o
un `clamscan` es justo el tirón que se nota al volver al escritorio. No le importa a nada de lo que
hay detrás del gate (el sondeo más frecuente es de 120 s) y **solo se paga si hubo congelación**: el
camino sin juego sale antes, sin dormir ni forkear.

**En `monitor_units` el gate se salta la PRIMERA pasada, y esa condición no sobra.**
`systemctl --failed` es estado de **nivel**, no de flanco: una unidad que caiga durante la partida
sigue en la lista al reanudar y se avisa entonces. Pero si el gate atrapara la pasada de **siembra**,
todo lo que hubiera fallado durante esas horas se sembraría como "preexistente" y no se notificaría
**nunca**. La siembra son 4 forks una sola vez: congelarla no ahorra nada y cuesta avisos.

**Fail-open, igual que la puerta del Wake up.** Sin fichero, con JSON corrupto, sin `pid` o con el
pid muerto, el gate responde "no estoy jugando" y **el trabajo se hace**. Un fallo aquí debe
degradar a "la congelación no funciona" —visible, y lo peor es un tirón en el juego— y nunca a "los
escáneres no vuelven a correr jamás", que es silencioso, permanente y no tiene UI donde notarse.
De ahí que `gamingState.ts` escriba ahora **también el pid de AGS**: mientras el flag solo pausaba
las descargas (opcional y por defecto apagado) que se quedara pegado en `true` daba casi igual;
ahora congela tres monitores más. La otra mitad de la cadena es que `initGamingState()` reescribe el
fichero al arrancar el shell, necesaria porque los pid **se reciclan**.

**Sin forks en el camino caliente**: el flag se lee con un redirect builtin + regex, no con `jq` —
un `jq` cada 10 s durante una partida de tres horas sería justo el coste que este gate existe para
quitar. El ajuste (`gamingFreeze` en `preferences.json`, ausente = activado) sí usa `jq`, pero
cacheado 30 s; se lee **en vivo**, no una vez al arrancar, porque es un control de recursos:
apagarlo descongela en ≤30 s sin reiniciar ningún monitor, incluso a mitad de partida.

**El mismo gate congela también en MODO AHORRO, y ese es su segundo motivo.** La lista de lo que
se congela es idéntica —sondeo caro y aplazable— porque la razón es hermana: al jugar el
mantenimiento molesta, con la batería baja **cuesta autonomía** (`smartctl` despierta discos,
`updates-monitor` enciende la radio). Lo decide AGS y llega **ya combinado** (ahorro activo **Y**
el interruptor de Ajustes > Energía > "Reducir procesos en segundo plano", `freezeBackground` en
`~/.config/power-save/config.json`, ausente = activado) como **`powerSaveFreeze`** en ese mismo
`runtime-state.json` — mismo fichero porque se reescribe **entero** en cada cambio y dos
escritores se pisarían; lo publica `gamingState.ts`, suscrito al estado de `powerState.ts`.

**Bash NO rederiva "¿estoy en ahorro?", y esa es la decisión.** Mirar `/sys/class/power_supply` a
mano ya salió mal una vez —lista también la pila del **ratón**, que reporta `Discharging` para
siempre (ver `_is_system_battery` en `oom-monitor.sh`)—, mientras que AGS ya tiene la respuesta
buena por upower y con el umbral que enseña la UI. Una sola fuente de verdad, y el error de
paralaje entre lo que dice Ajustes y lo que hace el gate deja de ser posible.

**Son dos interruptores, no uno**: `gamingFreeze` gobierna **solo** el motivo "juego" — apagar la
congelación al jugar no debe apagar la del ahorro, y al revés. Lo demás se comparte tal cual: la
guarda del `pid` de AGS, el fail-open (sin fichero, JSON corrupto, pid muerto o clave ausente → se
trabaja) y el bucle de espera, que **relee ambos motivos** en cada vuelta, así que salir del ahorro
—o desactivar el ajuste— descongela en ≤`GAMING_GATE_POLL` sin reiniciar ningún monitor.

**`GAMING_GATE_SLEEP` no es decorativo.** `updates-monitor` lo pone a `blocking sleep` porque bash
**difiere las señales** mientras espera a un hijo en primer plano: con un `sleep` normal, el `pkill`
del toggle maestro de AGS no mataría el script hasta acabar la espera. En `oom-monitor` los
sub-monitores ya duermen en primer plano, así que ahí `sleep` a secas es lo coherente.

### Escáner de apps al iniciar sesión (`gigios/escaner-apps.lua`)

Al empezar la sesión se abren ventanas **solas** (autostart, restauración de sesión) y no siempre
en el escritorio que estás mirando: acabas delante de uno vacío mientras tus apps están en otro.
Esto mira los primeros 30 s y te lleva donde hayan quedado. `0` ventanas nuevas → no hace nada;
**un** escritorio destino → salta a él; **dos o más** → llama a `GiGiOS.compactar()` y salta al
destino **más cercano** al activo (empate → id menor).

**Era un script de bash que parseaba el socket de eventos a mano**, con la trampa de que la
dirección de `openwindow>>` llega SIN el `0x` que sí trae `hyprctl clients` — cruzar ambas fuentes
sin normalizar daba cero coincidencias en silencio. Con `hl.on("window.open", …)` la ventana llega
ya tipada (`win.address` con su `0x`) y esa clase de fallo desaparece de raíz.

**La decisión se toma AL FINAL de los 30 s, no en cada evento, y esa es la diferencia entre la
función y un tic nervioso.** Saltar según llega cada `openwindow` haría rebotar el escritorio
activo cuatro o cinco veces mientras arranca la sesión — justo el desconcierto que esto viene a
quitar. El peaje aceptado es que la corrección llega a los 30 s, no al instante.

**Se registra a t=0, y es la excepción al calendario escalonado**: escucha las aperturas de ventana
desde el propio `hyprland.start`, y las apps de autostart abren **exactamente ahí**. Retrasarlo no
es apartarlo del pico de carga, es perderse las ventanas que existe para seguir — el mismo motivo
por el que `oom-monitor` no se retrasa entero. Ya no cuesta ni un proceso: es un callback del
compositor, y a los 30 s se desuscribe (`sub:remove()`) en vez de morir un `nc`.

**La dirección del evento viene SIN el `0x`** que sí trae `hyprctl clients` (`openwindow>>ADDRESS,
workspace,class,title`, y hay que cortar en la primera coma: la línea entera trae también
workspace, clase y título). Cruzar ambas fuentes sin normalizar da cero coincidencias **en
silencio** — el script recolecta bien, resuelve a lista vacía y sale con éxito sin saltar a ningún
sitio. Fue el primer fallo real y no da ningún error.

**Los escritorios se re-resuelven DESPUÉS de compactar**, porque `GiGiOS.compactar()` renumera:
un id leído antes de compactar apunta a otro sitio (o a nada) al terminar. Como la llamada es
síncrona, la re-resolución va justo detrás, sin temporizadores de por medio. Solo cuentan las
ventanas que **no existían** al registrarse (la base se toma con `hl.get_windows()`) — lo ya
abierto no es un autolanzamiento — y se ignoran los escritorios especiales, que no son una posición
donde dejar al usuario.

**Es de un solo disparo, no un vigilante permanente**, así que se aparta de la advertencia general
de los `*-monitor.sh`: lee su preferencia al cargar el config, mira 30 s y se desuscribe. No hay
proceso vivo que se quede ejecutando código viejo, ni hace falta `pkill` + re-exec al cambiar el
ajuste — se aplica en la próxima sesión, como `limpiezaPortapapelesAlIniciar`.

**Alcance real**: corre al arrancar **Hyprland**, no al volver de una suspensión o hibernación
(volver no reinicia el compositor, así que `hyprland.start` no se vuelve a disparar). Cubre el
autostart y cualquier restauración de sesión que ocurra tras un arranque completo.

La ventana de 30 s la cierra un `hl.timer` de un disparo. Toda la maquinaria que hacía falta en
bash —leer el socket con `nc -U`/`socat`, el sondeo de repliegue cada 2 s, distinguir "el lector no
ha dicho nada" de "no se ha abierto ninguna ventana"— desapareció con la reescritura: aquí los
eventos los entrega el compositor al callback.

**Ajuste**: `escanerAppsInicio` en `~/.config/gigios/preferences.json` (Ajustes > Personalización >
Ventanas y escritorios). **Ausente = DESACTIVADO**, al revés que la mayoría de claves de este
fichero: mover el escritorio activo por su cuenta es intrusivo y hay que optar a ello. Ese default
es también lo que hace seguro leerlo con `.escanerAppsInicio // false` — el tropiezo del operador
`//` de jq documentado en `gaming-gate.sh` (que trata un `false` literal como ausente) aquí da el
mismo resultado por ambos caminos. `GIGIOS_ESCANER_SEGS` acorta la ventana para probarlo sin
esperar medio minuto, la misma costura que `GIGIOS_USB_PENDING_DIR` en el monitor de USB.

### Anclar las ventanas al escritorio donde las lanzaste (`anclaje.py` + los dos lanzadores)

Abres una app, te vas a otro escritorio mientras carga, y la ventana aparece **donde estás** en vez
de donde la abriste. `hypr/scripts/anclaje.py` es el motor que lo corrige, y lo comparten los **dos**
lanzadores: `rofi-launch.py` (SUPER+SPACE) y `lanzar-anclado.py`, por el que **Orion** abre sus apps
(`ags/modulos/orion/data/launch.ts`). Antes solo lo tenía rofi y Orion hacía `sh -c <exec>` a pelo,
así que la misma app se comportaba de una forma u otra según por dónde la abrieras.

**Dos mecanismos, no uno, y el orden importa.** `lanzar-anclado.py` lanza con
**`hyprctl dispatch exec [workspace N silent] <cmd>`**: la ventana **nace** ya en su escritorio. Antes
se lanzaba a secas y se corregía con un `movetoworkspacesilent` al llegar el `openwindow`; el
resultado final era el mismo, pero por medio la ventana llegaba a **mapearse en el escritorio
equivocado** — un parpadeo de un frame, un amago de render que ni siquiera recolocaba las ventanas
que ya había allí. Con la regla ese instante no existe. Medido con el socket de eventos:
`openwindow>>…,2` + `movewindow>>…,1` (antes) frente a `openwindow>>…,1` y ningún `movewindow`
(ahora). El **`silent`** es obligatorio —sin él, lanzar algo destinado a otro escritorio te
arrastraría allí, justo lo contrario de lo que se busca— y **no rompe el foco** en el caso normal de
lanzar en el escritorio en el que ya estás (medido).

**La regla solo cubre la PRIMERA ventana**, así que el observador de `anclaje.py` sigue haciendo
falta y no es redundante. Medido con un comando que abre dos ventanas separadas 2 s: la primera nace
en el escritorio de la regla, la segunda nace en el activo. O sea que la regla mata el artefacto en
el caso que pasa siempre (una app, una ventana) y el observador queda como red para splashes y
multiventana —ahí sí con el parpadeo— y para la rama `urgent`, que trae al escritorio actual una app
single-instance ya abierta. **Rofi no puede usar la regla**: en modo `drun` ejecuta el `Exec` del
`.desktop` él mismo, así que no hay dónde interponerla y conserva el parpadeo.

**El observador**: escucha el socket de eventos hasta 15 s, deduce la identidad de la app de la
**primera ventana nueva** (`initialClass` + pid) y a partir de ahí solo ancla lo que coincida en
clase o cuelgue de ese árbol de procesos — sin eso se llevaba al escritorio de lanzamiento cualquier
diálogo o popup ajeno que naciera en esa ventana de tiempo. Los 15 s salen de medir el peor caso
real (Steam: tres ventanas, la última a los 10 s). El detalle completo del diseño está en el
docstring de `anclaje.py`.

**Ninguno de los dos es un daemon**, así que se apartan de la advertencia general de los
`*-monitor.sh`: nacen de cero en cada lanzamiento, leen el ajuste y mueren. No hay que hacerles
`pkill` + re-exec al cambiar la preferencia.

**Ajuste**: `anclarVentanasRofi` en `~/.config/gigios/preferences.json` (Ajustes > Personalización >
Ventanas y escritorios), **ausente = activado**. Es **una sola clave para los dos lanzadores** a
propósito: para quien la usa es una única función, y partirla solo permitiría dejarla a medias. El
nombre dice "Rofi" por historia —renombrarla apagaría el anclaje en silencio en la máquina que ya
tiene la clave escrita— y no por alcance. Cuando está **desactivado no se pone la regla** tampoco:
el ajuste significa "que cada ventana aparezca donde yo esté", y fijarla al escritorio de
lanzamiento sería justo lo que se apagó.

**Fallos: siempre hacia "se abre sin anclar", nunca hacia "no se abre".** Sin socket, sin Hyprland o
con un `dispatch` rechazado se relanza por `sh -c`. Ojo con lo último: **`hyprctl` no señala un
dispatch rechazado en el código de salida**, responde `ok` en el stdout, así que mirar solo el
`returncode` daría por bueno un fallo y la app no se lanzaría por ningún camino.

**El lado de la barra**: un traslado silencioso **no emite `notify::clients`** (que es de altas y
bajas, no de movimientos), así que `ags/modulos/barra/escritorios/Escritorios.tsx` escucha además **`client-moved`**.
Sin eso los iconos de la barra se quedaban en el escritorio donde nació la ventana hasta que otra
cosa forzara un refresco. Ver `ags/CLAUDE.md`.

### SUPER + tecla sin atajo no debe escribirse (`gigios/nop-binds.lua`)

Con SUPER pulsado, una tecla que **no** forma un atajo llegaba a la aplicación: `SUPER+C` escribía
una `c`. Es al revés que en Windows, donde la tecla Win sin atajo no hace nada.

**No hay opción global para esto: Hyprland solo se traga una tecla si algún bind la captura.** El
candidato obvio es `catchall`, y el compositor lo rechaza — medido, no supuesto: responde *«Invalid
catchall, catchall keybinds are only allowed in submaps»*. La API Lua tampoco lo trae:
`HL.BindOptions` no tiene `catchall` ni `any`. Así que la única vía es **enumerar** una combinación
por tecla (letras, dígitos, puntuación, F1–F12, teclado numérico, navegación y edición; para
`SUPER`, `SUPER SHIFT`, `SUPER CTRL` y `SUPER ALT`).

**Antes era un fichero generado de 335 líneas** (`keybinds-nop.conf`) más su generador
(`generar-nop-binds.sh`), que parseaba `hyprctl binds` para saber qué combinaciones estaban ya
usadas. Hoy son **~10 líneas de bucle** en `gigios/nop-binds.lua`, y esa es una de las tres cosas
que pagaron la migración a Lua ella sola: al vivir dentro del mismo config, la lista de "lo que ya
es un atajo" **no hay que descubrirla** — la tiene delante.

**El envoltorio `bind()` de `gigios/keybinds.lua` es lo que lo sostiene**: anota cada combinación
(normalizada: mods ordenados y en mayúsculas, así `"SUPER SHIFT + E"` y `"shift+super+e"` casan) en
una tabla `usados`, que `nop-binds` consulta. **Todo atajo nuevo debe pasar por ese envoltorio**, no
por `hl.bind` directo. Saltárselo **no da ningún error**: solo deja esa combinación con dos binds
—el tuyo y un sordo de más—, que Hyprland ejecuta ambos, así que es inofensivo pero deja los sordos
sin reflejar la realidad. Hay un aviso gordo en la cabecera del módulo por eso.

**El no-op es `hl.dsp.no_op()`, nativo.** Antes era `submap, reset`, que solo era inerte *mientras
no existiera ningún submap* en toda la configuración — una trampa que había que documentar y que
aquí desaparece.

**Ya no hay nada que regenerar ni que se pueda desincronizar**: el bucle se recalcula en cada carga
del config. El gesto de "recoger los atajos nuevos" (activar el ajuste para forzar una
regeneración) dejó de existir porque dejó de hacer falta.

**Ajuste**: `absorberSuperSinAtajo` en `~/.config/gigios/preferences.json` (Ajustes >
Personalización > Ventanas y escritorios), **ausente = activado** — ojo al leerlo, se comprueba
`== false` explícitamente, porque un `nil` tiene que activar. Se aplica **en caliente**: el setter
de AGS escribe la preferencia (síncrono) y dispara `hyprctl reload`, que re-ejecuta el config y
vuelve a decidir. Desactivado, los sordos sencillamente no se registran: no queda ningún fichero
residual que borrar ni comentar.

### Update monitor (`updates-monitor.sh`)

Checks for pending updates and surfaces the **important** ones as bar icons (AGS
`modulos/barra/indicadores/sistema/Actualizaciones.tsx`): **two separate icons, one for the kernel (orange Tux) and one
for GPU drivers (green)**, each shown only when its own category has something pending.
Ordinary package/dependency updates deliberately show **no icon at all** — they were pure noise;
they are only listed as context ("Otros: N paquetes") inside the popover. Launched from
`gigios/autostart.lua` as `sleep 20 && …/updates-monitor.sh` — el retardo deja que el resto de la
sesión termine de cargar antes de la primera consulta, que toca **red** y sincroniza una BD
temporal de pacman (eran 3 s; se subió a 20 al escalonar el arranque). El retardo va ahí y no
dentro del script porque el toggle maestro de AGS lo re-ejecuta en caliente, y ahí sí se quiere
inmediato.

**A package-DB watch is what makes the icon go away after you update.** Periodic re-checks alone
left the icon stuck: `updates.json` kept advertising what you had just installed until the next
interval elapsed. So the loop blocks on `inotifywait` over the distro's local package DB
(`/var/lib/pacman/local`, `/var/lib/dpkg`, `/usr/lib/sysimage/rpm`→`/var/lib/rpm`) *or* the
periodic timeout, whichever comes first. An install touches the DB hundreds of times, so an
event is followed by a **debounce** (re-check only after 5 s of quiet). This fires whether you
updated from the popover's button or from your own terminal. Without `inotify-tools` it degrades
to the plain interval sleep (and, if `updatesPeriodic` is off, simply exits after one pass).

Every blocking wait (`inotifywait`, `sleep`) goes through the `blocking()` helper — child in the
background + `wait` + a `TERM` trap — **not** a plain foreground call. Bash defers signals while
waiting on a foreground child, so a foreground `inotifywait` (which can block indefinitely) would
make the master toggle's `pkill` a no-op: the script would survive, later notice a DB change, and
rewrite `updates.json`, resurrecting the icons with the feature switched off.

All polling is **read-only and sudo-free**, one branch per distro family detected from
`/etc/os-release`: Arch/CachyOS → `checkupdates` (pacman-contrib; syncs a *temp* DB in the
user cache, never the system one; falls back to `pacman -Qu`), Fedora → `dnf -q check-update`
(rc 100 = updates), Debian/Ubuntu → `apt list --upgradable` **against the existing cache, no
`apt update`**. Each pending package lands in one of three buckets: *GPU driver* (name matches a vendor actually
present per `lspci` — `*nvidia*`, or `*mesa*`/`*radeon*`/`*amdgpu*`/`*amdvlk*` for AMD), *kernel*
(`linux`, `linux-*`, `kernel`, `kernel-*` — so `util-linux` does **not** match), or *system*
(everything else, counted only). Results are written **atomically** (tmp+`mv`, built with `jq` so
names/versions are escaped) to `~/.config/gigios/updates.json`:
`{checkedAt, distro, updateCmd, system: <count>, kernel: [{name, from, to}], gpu: [{…}], systemSample: [<=20 names]}`.
The widget watches that file with a `Gio.FileMonitor` — a missing/corrupt file simply means
"no updates" (icons hidden). Requires `jq`; without it the script exits without writing.

**Config** (`~/.config/gigios/preferences.json`, written by `PersonalizationSection.tsx`):
`updatesMonitor` (master), `updatesPeriodic`, `updatesIntervalHours` (default 3). Like
`batteryMonitor`/`tempMonitor`, the bash reads these **once at process start** — but the
*master* toggle is applied hot by its AGS setter (`pkill` + delete the JSON on off, re-exec on
on), so only the periodic/interval keys need a script restart.

### Screencast monitor (`screencast-monitor.sh`)

Detecta que **algo está capturando la pantalla** y lo publica en
`~/.config/gigios/screencast.json` (`{active, checkedAt, sources:[{kind:"share"|"record", app}]}`,
escrito atómicamente con `jq` + tmp/`mv`, y **solo cuando el conjunto de fuentes cambia** — así
compartir dos horas no reescribe el fichero ni despierta al widget; pero el memo que decide "ha
cambiado" arranca con un **centinela**, no vacío: si arrancara vacío, el primer sondeo sin nada
capturando se compararía consigo mismo y no escribiría, dejando en pie el JSON de la sesión
anterior — un "Discord compartiendo" sobrevivía al reboot y el icono se quedaba encendido). Lo consume
`ags/modulos/barra/indicadores/sistema/CapturaPantalla.tsx` con un `Gio.FileMonitor`; fichero ausente = nada
capturando = icono oculto.

Un único coordinador conserva en memoria dos estados, porque las formas de capturar no comparten
mecanismo. **Compartir pantalla** (Discord, OBS, Zoom, navegadores) pasa por
`xdg-desktop-portal-hyprland`, que crea un nodo PipeWire `Video/Source`: `pw-mon -p` alimenta un
filtro `awk` que recuerda los ids de los nodos/enlaces de vídeo y descarta todos los demás
eventos (incluido el audio); después de cada ráfaga espera **300 ms reales sin otra señal** y
solo entonces ejecuta un `pw-dump`. No se hace una consulta por cada línea encolada. Se filtra
por nodo del portal y se **excluyen las cámaras** (`v4l2_*`/`libcamera*`) para que la webcam no
encienda el icono;
además, el nodo debe estar **`running` o tener un link `active`**: Discord/Electron puede dejar
un nodo `idle` huérfano al terminar de compartir, y contar su mera existencia mantenía el icono
encendido aunque ya no hubiera captura. Cuando PipeWire lo expone, se sigue el link activo hasta
el nodo `Stream/Input/Video` para nombrar la app consumidora (si no, la etiqueta cae a
"Pantalla"). **Grabar en local** (`wf-recorder`, `gpu-screen-recorder`, `wl-screenrec`, `obs`)
usa wlr-screencopy y **no toca PipeWire**: no hay señal a la que suscribirse, así que ahí se
sondea solo `pgrep` cada 3 s, sin volver a ejecutar `pw-dump`. El coordinador combina ambos
resultados y escribe únicamente si cambia el conjunto final; no usa estado auxiliar en disco.

El trap `TERM` mata al coproceso **y a sus hijos** (`pw-mon`, `awk`) y borra el JSON. El
coproceso se ejecuta con un argv propio (`gigios-screencast-events`): si heredara
`screencast-monitor.sh`, el `pkill -f` del toggle mataría padre e hijo a la vez y podría dejar
`pw-mon` huérfano antes de que el padre hiciera la limpieza. Requiere `jq` y `pw-dump`;
sin ellos sale sin escribir.

**Filtro de PipeWire, medido en esta máquina (no supuesto):** el nodo del portal se identifica
por `node.name == "xdg-desktop-portal-hyprland"` (**no** `xdpw-stream-*`, como se asumía antes de
medir). La webcam es también `media.class=Video/Source` (`node.name=v4l2_input.*`), por eso
excluirla con `v4l2_*`/`libcamera*` es obligatorio, no una precaución de más. La app consumidora
**sí es resoluble**: siguiendo el link (`link.output.node` del nodo del portal →
`link.input.node` de un nodo `Stream/Input/Video`, ambos números en los props) se llega a un nodo
cuyo **`node.name`** trae el nombre ("Discord") — `application.name` viene **vacío** en ese nodo,
así que el orden de preferencia es `application.name // node.name // application.process.binary
// "Pantalla"`.

**Config**: `screencastIndicator` en `~/.config/gigios/preferences.json` (ausente = activado),
leído **una vez al arrancar** — pero el toggle es maestro y su setter de AGS lo aplica **en
caliente** (`pkill` + borrar el JSON al apagar; re-exec al encender), así que no hace falta
reiniciar nada.

### USB (`usb-monitor.sh`, `usb-eject.sh`, `usb-repair.sh`) + `system/udev/`

**La raíz del problema con los USB no es el shell, es `vm.dirty_ratio`.** Linux acepta hasta el
10 % de la RAM en páginas sucias (aquí ~1,5 GB) antes de forzar el volcado, así que una copia a un
pendrive lento se traga los datos a velocidad de RAM: el diálogo llega al 100 % y "termina" en
segundos con cientos de MB aún sin bajar al dispositivo. Al retirarlo — aunque sea minutos después —
el kernel escupe `Buffer I/O error on dev sdb1 … lost async page write` y los datos **se han perdido
de verdad** (a nosotros el volumen NTFS nos quedó `Mark volume as dirty`). Por eso el síntoma solo
aparecía **al mover archivos**: sin escrituras pendientes no hay writeback que fallar.

La cura vive fuera del repo, en `system/udev/99-gigios-usb-writeback.rules`. La instala **`install.sh`
(paso 6)** con `install -Dm644` en `/etc/udev/rules.d/`; en una máquina ya montada hay que copiarla a
mano con `sudo`. **No** es un symlink, y no puede serlo: udev lee `/etc` antes de que `$HOME` esté
montado, y apuntar `/etc` a un directorio escribible por el usuario sería una escalada silenciosa.
La regla baja `bdi/max_bytes` a 16 MiB y pone `strict_limit=1` **solo** en almacenamiento externo. La barra de progreso pasa a ser honesta. Dos detalles medidos, no supuestos:
el `bdi` cuelga del **disco entero** (`/sys/block/sdb/bdi`), las particiones **no tienen `bdi` ni
`removable`** propios → la regla apunta al disco; y se filtra por **`ID_BUS=="usb"`, no por
`removable=="1"`**, porque los **discos duros USB externos reportan `removable=0`** (lo extraíble es
la carcasa, no el medio) y se habrían quedado fuera justo los que más datos mueven.

`usb-monitor.sh` escucha **dos subsistemas en un solo stream** (`usb` + `block`). Un pendrive genera
eventos de ambos, así que sin cuidado saldrían **dos popups** por enchufe: si el dispositivo es de
clase *mass storage* el aviso genérico **se calla** y habla el evento de bloque, que sabe el modelo
y puede ofrecer botón.

**Deducir la clase del evento del `usb_device` no basta, y cuando falla salen los DOS popups.** Se
miraba solo `ID_USB_INTERFACES` (contiene `:08` — las entradas son de 6 dígitos entre `:`, así que
`":08"` solo puede casar al principio de una). Esa heurística falla en dos direcciones: hay bloques
de evento que llegan **con las propiedades a medias** (de ahí el "USB conectado — *dispositivo
desconocido*", que además delata que tampoco venía `ID_MODEL`), y hay dispositivos que se enganchan
a `usb-storage` por una interfaz de clase **propietaria** (`ff…`: lectores de tarjetas, algunas
carcasas) sin ningún `:08` que mirar. En ambos casos salta el genérico y **acto seguido** el de
almacenamiento con el nombre bueno.

Hoy la señal no es la clase declarada sino el hecho **observado** de que el dispositivo acabe
exponiendo un dispositivo de bloque — que solo se sabe unos instantes después. El aviso genérico se
**retiene 3 s** (`DEFER_SECS`) y se **cancela** si en esa ventana llega un evento de bloque de *ese*
dispositivo. El enlace entre ambos es `DEVPATH`: el del bloque cuelga del árbol del `usb_device`
(`…/usb1/1-5` → `…/usb1/1-5/1-5:1.0/host…/block/sdb`), o sea que el del padre es **prefijo** del
hijo. Es una relación exacta, **no una correlación por tiempo**: dos dispositivos enchufados a la
vez no se cancelan el uno al otro (verificado). El diferido también cubre el caso de tirar del
pendrive antes de los 3 s, que antes sacaba un "conectado" **después** del "desconectado".

Los pendientes son un fichero por aviso en `$XDG_RUNTIME_DIR/gigios-usb-pending/` (con su `DEVPATH`
dentro), y el subshell **reclama el suyo con un `mv`** antes de notificar: el rename es atómico y
falla si ya no está, así que no hay ventana entre "compruebo que sigue vivo" y "notifico" por la que
una cancelación pueda colarse. El directorio se **borra al arrancar** el script porque un proceso
anterior muerto a mitad deja huérfanos que nadie reclamaría.

**Al DESCONECTAR el duplicado tiene la misma raíz, pero se arregla al revés.** Un dispositivo
compuesto o detrás de un hub expone **varios `usb_device` anidados**, y el kernel emite un `remove`
por cada uno; como el aviso colgaba de ese evento, salían dos popups por un solo tirón — y el del
nodo padre no suele traer `ID_MODEL`, de ahí el "dispositivo desconocido" que acompañaba al bueno.
(Es también la otra mitad de la causa en la conexión: ahí el que se cuela es el padre, y el
diferido ya lo cancela porque el `DEVPATH` del bloque cuelga de él.) En la desconexión no hay
ningún evento posterior que sirva de prueba, así que en vez de cancelar se **fusiona**: el aviso se
retiene `DEFER_SECS` y los removes emparentados por `DEVPATH` colapsan en uno solo con el mejor
nombre disponible.

La regla de fusión es **asimétrica a propósito**, y esa asimetría es lo que la hace correcta llegue
el padre antes o después que los hijos (el kernel suele emitir hijo→padre, pero no se depende de
ello): si el entrante **desciende** de un pendiente lo absorbe y se queda con **su** `DEVPATH` —el
más profundo, que es la función real y la que tiene nombre—; si el entrante es **antecesor** de un
pendiente se **descarta**, porque el hijo ya cubre ese tirón, y solo le cede su etiqueta si el hijo
venía sin nombre. Guardar el `DEVPATH` **más profundo** es justo lo que evita colapsar **hermanos**:
al retirar un hub con tres pendrives, los tres son hermanos entre sí (ninguno desciende de otro) →
**tres** avisos, y el remove del hub se descarta; si se guardara el del hub, los tres se fundirían
en uno. Verificado con A/B sobre seis escenarios (anidado en los dos órdenes, hub con 3 discos,
hijo sin nombre y padre con él, suelto, y dos dispositivos a la vez): el original saca 13 avisos,
el nuevo 9 — uno por dispositivo físico.

Los pendientes de conexión (`c.*`) y de desconexión (`r.*`) **comparten directorio pero no glob**, y
un aviso ya reclamado se renombra a `.fired.*` —fuera de ambos globs— para que no pueda reaparecer
como pendiente vivo y falsear una cancelación o una fusión. `GIGIOS_USB_PENDING_DIR` permite
apuntar el directorio a otro sitio: es la costura para probar el script sin pisarle los pendientes
al monitor que está corriendo (que además los **borra al arrancar**).

`ID_USB_INTERFACES` y una lectura de `bInterfaceClass` en sysfs siguen ahí, pero **degradados a
atajos**: solo sirven para ahorrarse la espera cuando la respuesta ya se sabe (un pendrive normal se
calla al instante). Si dicen que no, **no se concluye nada** — se difiere. El coste aceptado es que
un teclado tarda 3 s en anunciarse; es un popup pasivo, y se prefiere eso a un falso "dispositivo
desconocido". El sysfs es atajo y no garantía porque las interfaces **no siempre existen todavía**
cuando llega el `add` del `usb_device`.

- **Expulsar** (botón en el aviso de conexión) → `usb-eject.sh <disco>`: desmonta todas las
  particiones y hace `power-off`. El unmount de udisks **hace el flush y espera**: cuando vuelve, los
  datos están físicamente en el pendrive. Si `power-off` falla (hubs que no lo soportan) **no** es
  error: ya está todo volcado, que es lo que protege los datos.
- **Volumen sucio** → en cada partición USB nueva se llama a `org.freedesktop.UDisks2.Filesystem.Check`
  (solo lectura); si no está limpia **se repara sola** (`usb-repair.sh` → `Filesystem.Repair`), sin
  botón ni pregunta. Se puede porque la operación es **conservadora, no destructiva**: en NTFS udisks
  ejecuta `ntfsfix`, que según su propio man **no es un chkdsk** — repara inconsistencias
  fundamentales, resetea el journal y **programa la comprobación de verdad para el primer arranque de
  Windows**. Auto-reparar no esconde nada. Y el instante del enchufe es la **única ventana** en la que
  el volumen está sucio y todavía sin montar, que es lo que `Repair` exige: preguntar aquí solo servía
  para que la ventana se cerrara mientras el usuario decidía. Se recomprueba `/proc/mounts` justo antes
  de reparar — si el gestor de archivos lo montó en ese hueco, **no** se le desmonta por la cara: ahí
  (y solo ahí) se cae al aviso con botón, donde el desmontaje lo autoriza el clic.

**Por qué udisks y no `fsck`/`ntfsfix` directos**: van a un dispositivo `root:disk 660`, harían falta
privilegios, y escalarlos desde un script de `~/.config` (escribible por el usuario) sería
exactamente la escalada silenciosa contra la que avisa la sección de `PRIVESC_ALLOW`. Con udisks el
trabajo privilegiado lo hace `udisksd` y lo autoriza polkit — y **no hay prompt de contraseña**
porque `modify-device` es `allow_active=yes` para dispositivos que **no** son del sistema (en un
disco interno sí lo pediría: `modify-device-system` → `auth_admin_keep`). `Check`/`Repair` **exigen
el volumen desmontado**; si ya está montado, `check_volume` se calla (no vamos a desmontar por la
cara). Cualquier error —fs no soportado, falta la herramienta— también es silencio: esto es una
comodidad y no puede convertirse en una fuente de ruido. Reparar **NTFS** necesita `ntfsfix`, que
viene en el paquete **`ntfsprogs`** — **no** en `ntfs-3g`, que hoy solo trae el driver FUSE
(`pacman -F` puede decir lo contrario: su base de ficheros va desfasada respecto a lo instalado).

### Brillo: dos hardwares, y uno de ellos necesita `sudo` una vez (`system/modules-load.d/`)

El brillo **no es una sola cosa**. En un **portátil** lo maneja la GPU y el kernel lo publica en
`/sys/class/backlight` → `brightnessctl`. En un **sobremesa** ese directorio está **vacío**: el
monitor externo no aparece ahí porque su brillo vive en el firmware del propio monitor, y solo se
habla con él por **DDC/CI** (I2C sobre el cable de vídeo) → `ddcutil setvcp 10`. Lo implementa AGS
en `ags/servicios/pantalla/brightness.ts`, que elige backend solo; ver `ags/CLAUDE.md`.

Para el camino DDC hace falta el módulo **`i2c-dev`**, que no carga nadie por su cuenta. Sin él no
existen los nodos `/dev/i2c-*`, `ddcutil` no ve nada y el slider **desaparece** (que es el
comportamiento correcto: no hay backend). Lo persiste `system/modules-load.d/i2c-dev.conf`, que como
la regla udev de USB va a `/etc` y **no se symlinkea**: lo copia **`install.sh` (paso 6)**, que además
hace el `modprobe` para no obligar a reiniciar. En una máquina ya montada, a mano:

```sh
sudo install -Dm644 system/modules-load.d/i2c-dev.conf /etc/modules-load.d/i2c-dev.conf
sudo modprobe i2c-dev   # modules-load.d solo actúa en el arranque
```

El **acceso** a los nodos no requiere nada más: la regla udev que ya trae el paquete `ddcutil`
(`/usr/lib/udev/rules.d/60-ddcutil-i2c.rules`) marca los buses de la tarjeta gráfica con
`TAG+="uaccess"`, o sea ACL para el usuario de la sesión — **no** hace falta meterse en el grupo
`i2c` ni relogear. Medido en esta máquina (RTX 3060 + ASUS XG27AQDMES por DP): bus `/dev/i2c-3`,
VCP 10 soportado, rango 0–100.

**El brillo por hardware tiene un SUELO, y por debajo atenúa el gamma.** `setvcp 10 0` es el
mínimo que acepta la electrónica del panel — en el OLED de esta máquina, todavía claramente
luminoso. Así que el slider está partido en dos tramos: por encima de un suelo manda el hardware
(DDC/backlight) y por debajo se atenúa el **gamma**, que aplica `hyprsunset` sobre la CTM del KMS.
Es el mismo proceso que sostiene la luz nocturna, y por eso `applyNight()` en
`ags/servicios/pantalla/service.ts` es el **único dueño** y reconcilia los dos canales juntos: lo
mantiene vivo si lo pide cualquiera de los dos, y usa una temperatura neutra (6000 K) cuando solo
hace falta para el gamma — si no, bajar el brillo encendería de paso la luz nocturna. La lógica del
reparto es pura y probada (`ags/servicios/pantalla/atenuacion.ts`); ver `ags/CLAUDE.md` para el
detalle, incluida la restauración desde disco (el gamma no deja residuo: muere con la sesión, al
revés que el valor DDC, que el monitor graba en su firmware).

**`brightnessctl` no se invoca desde ningún otro sitio, y es a propósito.** Sin dispositivos de clase
`backlight` **no falla**: cae al primer dispositivo de clase `leds` y acaba encendiendo el **LED de
scroll-lock del teclado**, devolviendo 0 — un fallo mudo que la UI no podía detectar. Por eso las
teclas `XF86MonBrightness*` de `gigios/keybinds.lua` ya **no** lo llaman (van por `ags request
brightness-up|down`, que aplica al backend que haya y enseña el OSD) y la llamada que queda en
`init.sh` lleva `-c backlight` explícito.

### Perfiles TLP conmutables (`system/tlp/` + `servicios/energia/tlp.ts`)

Ajustes > Energía ofrece un selector **Normal/Ahorro** que cambia el perfil TLP en batería. El
problema de fondo es el mismo que el del brillo DDC y la regla udev de USB: **`tlp.conf` vive en
`/etc` y aplicarlo (`tlp start`) necesita root, pero AGS corre como usuario**. La regla de oro del
repo prohíbe que algo que toca root sea un symlink al árbol escribible por el usuario (escalada
silenciosa), así que la estructura separa **fuente versionada** de **copia de confianza root-owned**:

- **Fuente (versionada, la editas tú):** `system/tlp/{normal,ahorro}.conf` (perfiles completos que
  se intercambian **enteros**), `system/tlp/gigios-tlp-apply.sh` (el helper) y
  `system/tlp/sudoers-gigios-tlp` (la regla, con `__GIGIOS_USER__` de placeholder).
- **Instalado por `install.sh` paso 6, todo root-owned:** helper → `/usr/local/bin/gigios-tlp-apply`
  (755); perfiles → `/etc/gigios/tlp/{normal,ahorro}.conf` (644); regla → `/etc/sudoers.d/gigios-tlp`
  (440), generada sustituyendo el usuario real y **validada con `visudo -cf` ANTES de instalarla** (una
  regla sudoers malformada rompe `sudo` en toda la máquina). Se instala **solo si `tlp` está presente**;
  en un equipo sin TLP la función queda oculta.

**El flujo:** AGS ejecuta `sudo -n /usr/local/bin/gigios-tlp-apply {normal|ahorro}`, que copia
`/etc/gigios/tlp/<modo>.conf` → `/etc/tlp.conf` (atómico, tmp+`mv`), lanza `tlp start` y anota el modo
en `/etc/gigios/tlp/active` (world-readable, que AGS relee al arrancar sin sudo). **`install.sh` NO
toca `/etc/tlp.conf`** — eso lo hace el helper la primera vez que el usuario elige un perfil; si tenías
un `tlp.conf` afinado, pega su contenido en `system/tlp/normal.conf` antes de reinstalar.

**Por qué es seguro y no una escalada:** todo lo que `sudo` toca es root-owned, y la regla sudoers
casa el comando **exacto con argumento fijo** (`normal`/`ahorro`), no un script en `~/.config`. Editar
la copia del repo no cambia lo que corre como root hasta reinstalar con `sudo` a propósito. El `-n` de
`sudo` evita colgarse pidiendo contraseña: sin la regla, falla en el acto.

**Lado AGS (`servicios/energia/tlp.ts`):** `tlpAvailable` exige `tlp` + el helper + batería presente
(mismo patrón que el brillo sin backend DDC — la tarjeta se oculta entera si falta algo). El estado
inicial sale de leer `/etc/gigios/tlp/active` directamente. `tlpBusy` bloquea el selector mientras el
helper corre (evita dos `tlp start` a la vez). Es un **selector manual e independiente** del "Forzar
modo ahorro" y del umbral de batería. **Forzar modo ahorro** (`forcePowerSave` en
`~/.config/power-save/config.json`) es lo otro nuevo: hace `powerSaveActive` verdadero ignorando
nivel/carga/presencia de batería, así que también funciona en un sobremesa.

### Security monitor (`oom-monitor.sh`) + sandboxed launcher (`run-untrusted.sh`)

Despite the filename, `hypr/scripts/oom-monitor.sh` is the general **security event monitor** —
OOM killer is just one of ~16 scanned event types. Five sub-monitors run in parallel (`&` + `wait`):

**No se retrasa entero desde `gigios/autostart.lua` — se escalona por dentro, y la asimetría es el
diseño.** Sus sub-monitores no corren el mismo riesgo si empiezan tarde. Los que **siguen**
(`journalctl -kf`/`-f` con `-n 0`, que salta el backlog a propósito, e `inotifywait`) no
recuperan lo pasado: retrasarlos convertiría un OOM, un `sudo` fallido o un cambio en
`/etc/shadow` en una **ventana ciega** — justo lo que el script existe para evitar. Los que
**sondean** leen un estado que sigue ahí cuando lo mires, así que apartarlos no pierde nada y son
además los caros: `DELAY_UNITS=25` (su primera pasada solo siembra, no notifica: retrasarla es
literalmente invisible), `DELAY_SMART=45` (despierta cada disco; el sondeo es horario) y
`DELAY_DOWNLOADS=60` (el más caro: recorre Descargas y, ante un fichero nuevo, lo hashea y lo pasa
por ClamAV, que recarga ~200 MB de firmas **por invocación**). Los `sleep` van **dentro de cada
función y tras sus guardas**, para no dejar uno colgando por un monitor apagado. Medido en vivo:
los tres seguidores enganchan a t=0 y las pasadas caen en t=25/45/60.

- `monitor_kernel` — `journalctl -kf` (kernel-only, avoids matching app logs): OOM, panic,
  hung tasks, disk I/O errors, hardware errors (MCE/ECC/EDAC), unsigned/out-of-tree kernel
  modules, GPU/NVIDIA errors, CPU throttling, segfaults.
  **`diskError` clasifica el dispositivo antes de alarmar.** Casaba `*"i/o error"*` a pelo contra
  cualquier línea del kernel, así que arrancar un pendrive sin expulsarlo (que suelta un
  `Buffer I/O error on dev sdb1 … lost async page write` por cada página no volcada) disparaba una
  **crítica "💾 Error de disco" por línea** — un disco sano denunciado como moribundo. Ahora se saca
  el dispositivo de la línea (`_io_dev`), se resuelve a su disco padre (`_disk_base`; las particiones
  no tienen `bdi`/`removable` propios) y solo es "Error de disco" si `_disk_is_internal`: el nodo
  **sigue existiendo** y `removable=0`. No basta con mirar si existe — el nodo sobrevive unos ms al
  desconecte, y el flag `removable` cubre esa carrera. Si es extraíble o ya desapareció, sale un
  aviso normal **"⏏️ Extracción insegura"** (datos, no hardware). Una línea que no nombre dispositivo
  **sí** alarma (fail-safe). Además hay cooldown de 30 s **por dispositivo**: un disco muriéndose de
  verdad suelta decenas de líneas por segundo. Ver la sección de USB para la causa raíz y la cura.
- `monitor_system` — `journalctl -f` filtered by `-t` identifier (sudo, sshd, su, pkexec,
  polkitd, systemd, systemd-coredump): failed-to-start services, sudo/su/polkit auth failures,
  SSH accepted/failed, coredumps, and a sliding-window "crash storm" detector (≥3 coredumps
  in <60s).
  **Escaladas de privilegios (`privEsc`) — dos filtros contra el ruido de los juegos.** pkexec
  emite **dos** líneas por escalada: la de PAM (`pam_unix(polkit-1:session): session opened`, que
  no dice *qué* se ejecuta) y la de `Executing command … [COMMAND=…]`. Se avisaba en ambas → doble
  notificación, y la de PAM era además infiltrable por comando. Ahora **solo** notifica la de
  `COMMAND`; no se pierde nada, porque un pkexec **denegado** no abre sesión PAM pero sí loguea su
  `Not authorized`, que la rama sigue captando. Sobre esa línea se aplica `PRIVESC_ALLOW`, una
  allowlist de **globs** comparados contra el `COMMAND=` (que viene con argumentos). Contiene
  **GameMode**: `gamemoded` escala por pkexec **cada vez que un juego arranca y otra vez al
  cerrarse** (`/usr/lib/gamemode/cpugovctl set performance`, `procsysctl split_lock_mitigate`,
  `gpuclockctl`), así que jugar era una lluvia de avisos críticos "🔓 Escalada de privilegios" —
  la clase de ruido que enseña a ignorar la categoría entera. **No se puede exponer la allowlist
  en `security.json`**: el guardado de `ags/modulos/ajustes/seguridad/preferencias.ts`
  reconstruye ese JSON desde cero, así que
  una clave añadida a mano moriría al tocar cualquier switch de la UI. Se amplía editando el array
  en el script — y cada patrón es un agujero permanente, porque una ruta *escribible por el
  usuario* en esa lista es una escalada silenciosa.
- `monitor_files` — `inotifywait` on the *parent directories* of critical paths (not the files
  themselves, so atomic write+rename replacements like `visudo`/`passwd` are still caught):
  `/etc/passwd`, `shadow`, `sudoers`, `ld.so.preload`, `sshd_config`, plus persistence
  locations (`sudoers.d/`, `pam.d/`, `cron.d/`, `systemd/system/`, `~/.config/autostart/`,
  `~/.ssh/authorized_keys`, `/boot/`).
- `monitor_smart` — hourly `smartctl -H -A` polling per physical disk (zram/loop/dm-/sr
  excluded); warns once if it can't read SMART (permissions), alerts on `FAILED`/`FAILING_NOW`.
- `monitor_units` — polls `systemctl --failed` (system *and* user buses) every 120s; the first
  pass only seeds state so pre-existing failures aren't reported as new.
- `monitor_downloads` — **event-driven `find` sweep** of the locale-aware Downloads dir
  (`xdg-user-dir DOWNLOAD`, falling back to `~/Downloads`/`~/Descargas`; this machine's is
  `~/Descargas`). **inotify is a *wakeup*, not the scanner**: the body is `_dl_sweep` (a nested
  function that sees the persistent state — `_idx`/`_scanned`/`seeded`/`dir` — via bash dynamic
  scope), and the loop blocks on `inotifywait -q -r -t <safety> -e create,close_write,moved_to,moved_from,delete`.
  On an event it **debounces** (~3s of quiet, 30s hard cap) so extracting a game = *one* sweep, not
  thousands; on the `<safety>`=300s timeout it sweeps anyway (net for inotify `IN_Q_OVERFLOW` / the
  `-r` new-subdir blind spot — the sweep is authoritative regardless of which events inotify dropped).
  Idle = blocked, ~zero CPU (vs the old fixed 30s poll). Falls back to a plain 30s poll if
  `inotify-tools` is absent, and degrades to it on inotify errors (rc=1, e.g. watch-limit).
  **Content-hash dedup** (replaced the old permanent `path|size` scheme in `download-seen`, whose
  append-only, never-pruned, reboot-surviving state meant a file was scanned exactly once *ever* —
  re-adding it, even a *different* file of the same size at the same path, was silently skipped).
  Two state files under `~/.cache/gigios/`: `download-index` (`mtime|size|path`, a cheap per-file
  memo, **pruned** to currently-existing files each pass so it can't grow unbounded) and
  `download-hashes` (one `xxh64sum` per already-analyzed *content*, persistent — append-only but
  **capped**: once it passes 10 MB it's truncated to the last 100 entries via `tail -n 100` and the
  in-memory `_scanned` set is rebuilt to match; ~17 B/entry so this is a years-away hard valve, not
  routine). Rule: memo hit
  (`mtime|size` unchanged) → skip without hashing; changed/new → hash it — if that content hash was
  already analyzed, skip (same file re-added ≠ re-scan), else scan it (different content = different
  hash = scanned, even at the same path/size). `download-seen` is deleted on startup by the new code.
  Two jobs: (1) **flags new executables** (`is_runnable`: `+x`, ELF magic, `.appimage/.run/.exe/…`)
  with a "Lanzar aislado" action button — seeded silently on first run to avoid a flood; (2)
  **ClamAV-scans ALL new files** (not just executables — a virus can be a `.com`, document, etc.).
  Prefers `clamscan` (standalone) over `clamdscan` (needs the `clamd` daemon running). NB: the first
  sweep after the state is reset (or after this migration) hashes+scans every existing download once
  — a one-time heavier pass.
  **Resource controls (all live-read from `security.json` each sweep — no reboot needed, unlike the
  event toggles):** hashing and ClamAV run under `nice -n19 ionice -c3` (idle). `_dl_paused` defers
  the *whole* sweep when an enabled pause gate is active *now* — `dlPauseOnBattery` / `dlPauseInPowerSave`
  (battery read from `/sys/class/power_supply`, ver el aviso de abajo; threshold from
  `~/.config/power-save/config.json`) /
  `dlPauseWhileGaming` (reads `~/.config/gigios/runtime-state.json` `{gaming}`, written by AGS
  `servicios/energia/gamingState.ts`, which reuses the `isGameClient` heuristic — `ags/modulos/barra/juegos/`,
  ver `ags/CLAUDE.md`). Deferred work marks nothing, so
  it's picked up when the gate clears. The size cap is `dlMaxScanGB` (default 1 GB), also live.

  **`/sys/class/power_supply/` NO lista solo la batería del equipo, y creerlo rompía la pausa por
  batería en un sobremesa.** El ratón inalámbrico aparece ahí (aquí un Logitech G305 →
  `hidpp_battery_0`) y reporta `status=Discharging` **siempre**: un ratón sin cable siempre tira de
  su pila. `_on_battery`/`_battery_pct` recorrían el directorio entero y se quedaban con el primero
  que casara, así que este sobremesa se creía **"a batería" de forma permanente** y el % era el del
  **ratón**. Con `dlPauseOnBattery` activado eso habría pausado el escáner de descargas **para
  siempre**, en silencio y sin nada en la UI que lo delatara (no llegó a saltar solo porque esa
  pausa está en `false`). El kernel ya lo distingue y `_is_system_battery()` lo usa: fuera
  `scope=Device` (así marca las pilas de periféricos; la del equipo es `scope=System` o **no trae
  `scope`**, como los `BAT0` de portátil) y fuera `type != Battery` (el adaptador es `type=Mains`).
  Verificado con A/B (viejo: "con batería" = sí; nuevo: no) y con un BAT0 simulado para no romper
  el portátil. Mismo patrón en el `HAS_BATTERY` de `boot-healthcheck.sh`, que hace `grep -i bat`
  sobre esa lista y **también** casa con el ratón — ahí sale inofensivo de milagro, porque el bucle
  que va detrás globa `BAT*` y no encuentra nada.
  **Un `clamscan` que FALLA no es un `clamscan` limpio — y darlo por limpio era un agujero real.**
  El lote va a `2>/dev/null` y solo se leían las líneas `FOUND`, sin mirar el código de salida
  (0 = limpio, 1 = virus, **2 = ERROR**: sin base de firmas, permisos, fichero ilegible). Con la
  DB vacía —ClamAV recién instalado y `freshclam` **sin ejecutar nunca**, que es como se encontró
  esta máquina: `/var/lib/clamav` a 0 ficheros— `clamscan` salía con 2 y cero `FOUND`, así que el
  lote caía en la rama de "terminó bien" y **se marcaba como analizado**. Y como el memo va por
  **hash de contenido y es permanente**, esos ficheros no se volverían a analizar **nunca**, ni
  después de instalar las firmas: el escáner era un sello de "analizado" que no analizaba nada
  (medido aquí: **747 hashes** sellados con 0 firmas cargadas). Hoy `rc == 2` → `engine_ok=false`
  → **no se marca `_idx` ni `_scanned`** (el lote se reintenta solo cuando haya motor) + un aviso
  crítico **una vez por proceso** (`_dl_warned_engine`, mismo patrón que `warned_perm` en
  `monitor_smart`; sin el freno sería un aviso por barrido). Un `rc=1` **sí** marca: el análisis
  ocurrió y el hallazgo ya se notificó. Al arreglarlo aparece un efecto de segundo orden que
  obliga a `_alerted`: si no se marca `_idx`, el mismo ejecutable vuelve a entrar en `new_exec`
  en **cada** barrido (uno cada 5 min por la red de seguridad de inotify), así que
  `_alerted` (solo RAM, clave `ruta` → firma `mtime|tamaño`) da **un aviso por fichero y sesión**,
  y vuelve a avisar si el fichero cambia. En el camino sano `_alerted` no hace nada: allí `_idx`
  ya salta el fichero. **Lo ya sellado en falso NO se reevalúa solo**: tras instalar las firmas hay que borrar
  **los dos** ficheros de caché, `~/.cache/gigios/download-index` **y** `download-hashes` (se
  reconstruyen). Borrar solo `download-hashes` **no sirve** y es un error fácil: la primera guarda
  del barrido es `_idx` (`download-index`, memo `mtime|tamaño`) y hace `continue` **antes** de
  llegar a hashear, así que el fichero se saltaría igual. La alternativa sin borrar nada es el
  escaneo forzado de Ajustes (`scan-downloads.sh`), que ignora el memo — pero tampoco lo
  actualiza, así que el escáner automático los seguirá dando por analizados. Verificado con A/B sobre un `clamscan` simulado (rc 0/1/2) y con 3 barridos
  seguidos para el spam.

  **Interruptible scan**: `clamscan` reloads its ~200 MB signature DB on *every* invocation (~13 s
  here), so the batch is **not** chunked — one `clamscan --file-list` over the whole batch runs in the
  background while a `_dl_paused` poll (every 2 s) `kill`s it if a gate activates mid-scan (latency
  ~2 s). Completing marks `_idx`+hashes for all; a kill marks nothing, so the batch re-scans on
  resume (FOUND lines already printed before the kill still alert). **In-progress downloads**
  are skipped: browser/manager temp markers (`.part`/`.crdownload`/`.aria2`/`.!qB`/… *and their base
  name*) plus anything modified in the last 15s (still being written); a file moved out of Downloads
  mid-scan is skipped by a per-file existence recheck. Files over the cap raise a "🔍 Escanear"
  notification (wired to `scan-file.sh`). `scan-downloads.sh` is the **forced** full scan (Settings
  button) that ignores the master toggle, the pauses and the cap — it resolves the dir and delegates
  to `scan-file.sh` (now also `nice`/`ionice`-wrapped).

**Config**: every scanned category is gated by a boolean in `~/.config/gigios/security.json`
(written by `ags/modulos/ajustes/seguridad/SeccionSeguridad.tsx`, absent key = enabled). The bash reads it
**once at process start** — toggling a switch in the AGS Seguridad tab only takes effect after
a reboot or manually restarting this script (the UI says so). Journal reads use `-n 0` to skip
backlog, so a fresh login doesn't re-fire notifications for old events.

**`hypr/scripts/run-untrusted.sh`** — launches a single file through scan-then-contain: ClamAV
first (`clamdscan` preferred, falls back to `clamscan` if the daemon isn't running; a positive
hit blocks the launch entirely, an inconclusive scan warns but still proceeds), then Firejail
(`--whitelist`-only home, `--noroot --nodbus --net=none`). It does **not** disinfect the file —
it contains blast radius if the file turns out to be malicious. Wired into `monitor_downloads`:
new-executable notifications carry a `notify-send -A` action button that invokes it. Requires
`firejail` (and `wine` for `.exe`/`.msi`) to actually be installed — otherwise it notifies and
refuses to launch rather than running unsandboxed.

**`hypr/scripts/scan-file.sh`** — on-demand ClamAV scan of a single path (no size cap; `clamscan -r`
so it descends into archives), notifying clean / infected / couldn't-scan. Invoked by the "🔍 Escanear"
button on the oversized-file notification and by the "Analizar un archivo con ClamAV" path field in
`ags/modulos/ajustes/seguridad/SeccionSeguridad.tsx`. Both `run-untrusted.sh` and `scan-file.sh` prefer `clamscan` and fall back
across engines, and both surface a clear "run `sudo freshclam`" hint when the signature DB is missing.

### Comprobación de arranque (`boot-healthcheck.sh`)

Es el `exec-once` más caro del arranque —de ahí que vaya al final del calendario escalonado, a
`t=30` (ver la sección de `gigios/autostart.lua` más arriba)— y por eso está pensado para ser **silencioso
en una máquina sana**: solo notifica por categoría cuando encuentra un problema, y todo (incluida la
pasada limpia) queda en `hypr/logs/boot-healthcheck.log` (ignorado por git, ver `.gitignore`).
Ejecutado a mano responde al instante — el retraso lo pone quien lo lanza, no el script.

**Fase 1 autodescubre el hardware presente** (batería, GPU NVIDIA, NVMe, SATA, soporte SMART,
sensores de ventilador, swap, Bluetooth, audio, red, USB) y la Fase 2 solo comprueba las categorías
cuyo hardware existe — un sobremesa sin batería no recibe ningún chequeo de batería, ni un aviso de
que no la tiene. La GPU NVIDIA se detecta por **PCI** (`lspci`/`vendor` sysfs), no por si el módulo
`nvidia` está cargado: mirar el módulo primero se comería precisamente el caso que este chequeo
existe para pillar (GPU presente, driver no cargado).

**Varios comandos caros se ejecutan una sola vez y se reutilizan entre chequeos** (`sensors`,
`rfkill list bluetooth`, `aplay -l`, `ip link show`, `journalctl -b -1`): cada uno alimenta dos
comprobaciones distintas (existencia + estado) con la misma lectura, en vez de invocar el comando
dos veces por una diferencia de grep. El de ventilador parado además se beneficia de que sea **la
misma muestra**: correlaciona la temperatura de CPU y las RPM del ventilador de una única lectura de
`sensors`, no de dos llamadas casi simultáneas que podrían no coincidir.

**Los errores de kernel/journal se deduplican por proceso/unidad**, no por línea — N repeticiones
de la misma fuente cuentan como un solo problema, y se filtra ruido conocido de antemano (ACPI,
init de Bluetooth, nouveau, WMI, variables EFI, pstore, firmware). El chequeo de suspensión/hibernación
mira el **arranque anterior** (`journalctl -b -1`), no el actual: busca errores de suspend/hibernate,
servicios `systemd-*sleep*` en estado failed, y señales de reinicio forzado (watchdog, "rebooted
forcefully", modo de emergencia) — con `sddm-helper` excluido a propósito porque incrusta el log de
Xorg, que contiene literalmente la cadena "nowatchdog" en su `cmdline` y daría un falso positivo.

**La salud de batería compara `energy_full` contra `energy_full_design`** (o su par `charge_*` en
equipos que no exponen energía), no un simple porcentaje de carga — es la métrica de degradación
real de la celda, y avisa por debajo del 80 % de la capacidad de diseño original.

### Grabar pantalla (`grabar-pantalla.sh`)

Toggle de dos invocaciones: la primera arranca `wf-recorder` en segundo plano y bloquea esperándolo;
la segunda (mismo atajo) detecta que ya hay una grabación y le manda `SIGINT` para que cierre el
contenedor MP4 correctamente en vez de dejarlo truncado. Todo el estado va protegido por un
`flock` sobre un fichero de bloqueo — necesario porque pulsar el atajo dos veces seguidas rápido es
exactamente el caso de uso.

**Validar "hay una grabación activa" no se conforma con que el PID exista.** Comprueba además que
`/proc/$pid/comm` sea literalmente `wf-recorder` **y** que `/proc/$pid/cmdline` contenga la ruta de
salida exacta que se guardó — un PID reciclado por otro proceso cualquiera tras un cierre forzado no
basta para que el toggle lo confunda con "sigue grabando". Solo si esa doble comprobación falla se
borra el fichero de estado (nunca antes, para no perder la referencia a una grabación real que sigue
viva).

**El modo `ventana` restringe `slurp` a las ventanas realmente seleccionables**: geometrías sacadas
de `hyprctl clients -j`, filtradas a las que están en un workspace **visible ahora mismo** (según
`hyprctl monitors -j`), mapeadas, no ocultas y con tamaño > 0 — en vez de dejar a `slurp` seleccionar
una región libre de la pantalla. Cancelar con Esc sale con código 0 en silencio, no es un error.

Graba **siempre** con el audio interno del sistema: resuelve el sink por defecto con
`pactl get-default-sink` y usa su fuente `.monitor`, verificando primero que esa fuente exista de
verdad en `pactl list short sources` antes de arrancar. Tras lanzar `wf-recorder` espera 0.25 s y
comprueba que el proceso siga vivo — así un fallo inmediato de salida, audio o códec no se anuncia
como "grabación iniciada" cuando en realidad murió al instante.

### Portapapeles (`clipboard-history.sh`, `limpiar-portapapeles.sh`, `miniatura-portapapeles.sh`)

`clipboard-history.sh start` arranca el watcher (`wl-paste --watch cliphist store`) con
**`setsid --fork`**, no con `exec` ni en primer plano: así queda reparentado a init y sobrevive a
quien lo lanzó — tanto Hyprland (`gigios/autostart.lua`) como AGS (`execAsync`) llaman a `start`, y antes
el watcher moría junto con AGS por usar `exec`. Dos patrones de proceso distintos cumplen roles
distintos: uno general (cualquier límite de `-max-items`) sirve para detectar y **sustituir** un
watcher que quedó con un límite antiguo sin perder el historial ya guardado (`stop` no vale para
eso: también hace `cliphist wipe`), y uno exacto (límite actual) sirve para el caso normal de "ya
está corriendo bien, no hacer nada".

`picker` (SUPER+V) es un toggle de Rofi: si ya está abierto, la segunda pulsación lo cierra. Con el
historial desactivado por preferencia no abre nada (`stop` ya lo vació, no hay qué mostrar). El AWK
que arma la lista distingue tres tipos de entrada de `cliphist`: imágenes binarias (miniatura vía
`miniatura-portapapeles.sh`), rutas de imagen en texto (decodificando `file://` con sus `%XX`), y
texto normal — conservando el ID de `cliphist` en una columna oculta para poder decodificar la
selección exacta. Cancelar (Esc) sale con 0 sin tocar el portapapeles, para no pisar con un
`wl-copy` vacío lo que el usuario tenía copiado.

`miniatura-portapapeles.sh` no crea ficheros intermedios ni caché propia: canaliza
`cliphist decode` directo a ImageMagick, con límites de memoria/mapa/disco (128 MiB/0/0) para acotar
el coste de generar una miniatura bajo demanda, escribiendo ya en la ruta que espera Rofi.

`limpiar-portapapeles.sh` tiene dos entradas: `limpiar` (llamada directa, p. ej. desde AGS) y
`al-iniciar` (la usa `gigios/autostart.lua`, respeta la preferencia `limpiezaPortapapelesAlIniciar`).
Borra primero la selección activa de Wayland (`wl-copy --clear`) y solo después el historial
persistente (`cliphist wipe`) — en ese orden: si el watcher llegara a capturar el clear como una
entrada nueva, el wipe posterior se la lleva también.

### Utilidades cortas de un solo uso

- **`GiGiOS.daltonismo(modo)`** (`gigios/daltonismo.lua`) — aplica o quita un shader de pantalla
  (`decoration.screen_shader`) para protanopia/deuteranopia/tritanopia. Sin sondeo: lo invoca AGS al
  cambiar el ajuste (`hyprctl eval`) y el propio `hyprland.lua` en cada arranque/recarga para
  restaurar `modoDaltonismo` de `preferences.json`; sin argumento lee esa preferencia en el momento,
  sin caché (`util.leer_json`, no `util.prefs()`).
- **`GiGiOS.compactar()`** (`gigios/compactar.lua`) — renumera los escritorios ocupados a IDs
  consecutivos desde 1, moviendo ventanas en silencio y siguiendo al escritorio activo hasta su
  nuevo número. Sale sin hacer nada si no hay ninguna ventana en ningún escritorio. Es el motor que
  usa `gigios/escaner-apps.lua` cuando detecta dos o más escritorios destino (ver esa sección) — y
  por lo que esa sección advierte que los IDs deben releerse **después** de compactar. Al ser una
  llamada Lua síncrona el resultado está disponible al volver (medido: 0,2 ms), sin la carrera que
  había con el script.
- **`toggle-orion.sh`** — antes de tocar nada comprueba el ajuste maestro `orion` en
  `preferences.json`: si está desactivado no manda el toggle a AGS, porque deliberadamente no hay
  ninguna ventana registrada que responda. Intenta primero `ags request toggle-orion` y solo si falla
  o no devuelve `"ok"` cae a `ags toggle orion` — cubre la breve ventana de una recarga en la que el
  script enlazado en disco ya se actualizó pero la instancia de AGS en marcha todavía no, sin la cual
  el atajo quedaría inservible justo en ese momento.
- **`GiGiOS.toggle_gaps()`** (definida en `gigios/keybinds.lua`, junto a su bind) — alterna
  gaps/rounding a 0 (modo compacto) y de vuelta a valores fijos (`gaps_in 2.5`, `gaps_out 8`,
  `rounding 6`). Esos valores de "vuelta a la normalidad" están escritos ahí, no leídos de
  `gigios/ventanas.lua` — si algún día cambias los gaps por defecto, hay que replicarlo o el toggle
  "restaurará" un valor obsoleto. El estado vive en una `local` de Lua, no en un fichero de
  `$XDG_RUNTIME_DIR`: igual de efímero, y con la ventaja de que un `hyprctl reload` resetea a la vez
  el flag y los gaps — el esquema viejo restauraba los gaps pero el fichero sobrevivía, así que el
  siguiente toggle "restauraba" un estado en el que ya estabas.
- **`wallpaper.sh`** — tres modos: sin argumento (arranque, respeta `randomOnStart`), `--random`
  (botón de Orion) y `<ruta>` (clic en una miniatura de Orion). El campo `current` de
  `~/.config/gigios/wallpaper.json` lo escribe **siempre este script** tras aplicar un fondo, y
  `randomOnStart` lo escribe **siempre AGS** desde su toggle — cada lado hace read-modify-write
  conservando el campo del otro, así que ninguno pisa el ajuste del otro por accidente. Léelo con el
  mismo cuidado que el resto del repo: `.randomOnStart // true` sería incorrecto (el `//` de `jq`
  trataría un `false` real como ausente), de ahí el `if .randomOnStart == false then … end`
  explícito. En modo arranque, si `randomOnStart` es falso pero no hay `current` guardado o el
  fichero ya no existe, cae a uno aleatorio en vez de fallar.

### Monitores de recursos restantes (`battery-monitor.sh`, `temp-monitor.sh`, `ram-monitor.sh`, `disk-monitor.sh`, `bt-monitor.sh`)

Los tres primeros comparten un mismo molde: bucle de sondeo con **solo builtins de bash** en el
camino caliente (sin forks salvo `notify-send`/`jq` cuando de verdad hay algo que decir), histéresis
para no oscilar en el umbral, e **intervalo de sondeo adaptativo** (más corto cerca del umbral, más
largo con margen de sobra) para reducir despertares. Los tres leen su interruptor de
`preferences.json` **una sola vez al arrancar** con el mismo cuidado repetido por todo el repo: NO
`.claveMonitor // true`, porque el operador `//` de `jq` trata un `false` literal como ausente y ese
"apagado" nunca surtiría efecto — se lee con `if has(...)`.

- **`battery-monitor.sh`** — sondeo adaptativo (30/60/90 s) de `/sys/class/power_supply/BAT0`. Nunca
  avisa de modo ahorro ni de batería baja mientras carga (se resetean los flags al pasar a
  `Charging`). Espeja el umbral de ahorro de energía de AGS leyendo
  `~/.config/power-save/config.json` cada 10 min como mucho. El primer estado tras arrancar
  (`prev_status=""`) se trata como válido en vez de como un caso aparte, para no disparar un falso
  "cargador desconectado" en el login. La detección de "carga completa" cubre tanto `status=Full`
  como `Charging` al 100 % — hay baterías que nunca reportan `Full`.
- **`temp-monitor.sh`** — resuelve la ruta sysfs de `coretemp` ("Package id 0") **una sola vez** al
  arrancar, no en cada vuelta; la GPU usa `nvidia-smi` (este driver no expone temperatura por hwmon
  en esta máquina) solo si está presente. Histéresis 85 °C/80 °C, sondeo 15 s cerca del umbral, 60 s
  en reposo.
- **`ram-monitor.sh`** — usa `MemAvailable` de `/proc/meminfo`, no un porcentaje de uso: es la
  estimación del propio kernel de lo reutilizable sin llegar a swap (descuenta caché reclamable), así
  que no confunde el cacheo agresivo normal de Linux con memoria realmente agotada. Umbral absoluto en
  MB (no %) porque el mismo porcentaje significa márgenes reales muy distintos en un portátil de 4 GB
  que en un sobremesa de 32 GB. El parseo aprovecha que `MemAvailable` sale entre las primeras líneas
  del fichero para cortar el bucle en cuanto aparece.
- **`disk-monitor.sh`** — **no es un daemon**: corre una vez al login y sale. El espacio libre no
  tiene fuente de eventos y quedarse sin él es raro, así que una sola comprobación al arrancar es el
  compromiso correcto — coste cero el resto de la sesión. Deduplica por dispositivo (los subvolúmenes
  btrfs reportan el mismo dispositivo bajo varios puntos de montaje) e ignora particiones por debajo
  de 6 GB (EFI, boot) por no valer la pena vigilarlas.
- **`bt-monitor.sh`** — distingue una pérdida de Bluetooth **inesperada** de una intencionada.
  Suscripción única y siempre activa a D-Bus del sistema (barata mientras bloquea) a los eventos
  `PropertiesChanged` de `Connected` y a las llamadas al método `Disconnect()` de BlueZ: una
  desconexión manual (`bluetoothctl`, ajustes de GNOME/KDE, blueman — cualquier cosa que pase por la
  API estándar) se reconoce por esa llamada a `Disconnect()` y se calla si el `Connected: false`
  correspondiente llega dentro de una ventana de 5 s; y si el adaptador está apagado tampoco avisa
  (apagar el Bluetooth no es "perder" un dispositivo). Una pérdida genuina espera 10 s de gracia
  (cubre desconexiones breves con auto-reconexión) antes de confirmar y notificar, comprobando de
  nuevo el estado en un subproceso en segundo plano mientras el bucle principal sigue leyendo eventos.
  El nombre del dispositivo se captura en el momento de la caída, mientras todavía está en la caché de
  `bluetoothd` — puede dejar de resolverse una vez desconectado de verdad.

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
login. Ver la sección de brillo, abajo.

El volumen espera antes (`wait_for_sink`, techo 10 s): init.sh sale de un `exec-once` de Hyprland
y puede ganarle la carrera al arranque de PipeWire/WirePlumber en la sesión de usuario. Hasta que
WirePlumber no publica un sink por defecto, `@DEFAULT_AUDIO_SINK@` no resuelve y los `wpctl`
fallan **en silencio** — el volumen/mute guardado simplemente no se aplicaba en los arranques que
perdían la carrera.
