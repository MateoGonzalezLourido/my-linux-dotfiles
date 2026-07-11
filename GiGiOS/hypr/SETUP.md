# Setup para migrar este dotfiles (Hyprland + AGS) a otro PC

Este documento existe para poder llevar `~/.config/hypr/` y `~/.config/ags/` a otra
máquina y que todo funcione igual: bar/paneles de AGS, atajos de Hyprland, scripts de
monitorización ("escáneres" en `hypr/scripts/`) y utilidades varias (capturas, grabación,
portapapeles, Spotify...).

Generado inspeccionando el sistema actual (Arch/CachyOS). Los nombres de paquete son los
de `pacman`/AUR; si el PC destino usa otra distro, hay que traducirlos.

## 1. Base: Hyprland + utilidades de sesión

```sh
sudo pacman -S hyprland hyprlock hypridle hyprpolkitagent hyprsunset
```

- `hypridle` gestiona apagar pantalla / bloquear / suspender (`hypridle.conf`).
- `hyprlock` es la pantalla de bloqueo (`hyprlock.conf`, usa `~/.cache/gigios/face.png`
  y el label `$USER` — no hace falta nada extra).
- `hyprpolkitagent` se lanza en `autostart.conf` desde la ruta fija
  `/usr/lib/hyprpolkitagent/hyprpolkitagent`; si el paquete instala el binario en otro
  sitio en la otra distro, ajusta esa línea.
- `hyprsunset` es la luz nocturna (la activa `~/.config/inicializador/init.sh` leyendo
  `~/.config/gigios/display.json`). **Nota de `hyprland.conf`**: `render { cm_enabled = false }`
  está así a propósito porque el CTM de color management de Hyprland pisa el de
  `hyprsunset` y se ve lavado — no lo actives sin desactivar uno de los dos.
- Fuente del compositor de la sesión watchdog: `hyprland-watchdog.sh` asume que Hyprland
  corre como **servicio systemd de usuario** llamado `wayland-wm@hyprland.desktop.service`
  (típico de sesiones gestionadas por `uwsm`/greetd con systemd). Si el otro PC lanza
  Hyprland de otra forma (TTY directo, otro display manager), ese watchdog no tiene nada
  que reiniciar y hay que adaptar `HYPRLAND_UNIT` o desactivar el script.

## 2. AGS (el shell en sí)

AGS v2 (Aylur's GTK Shell) **no está en los repos oficiales de Arch**, viene de AUR:

```sh
paru -S aylurs-gtk-shell-git libastal-meta
```

`libastal-meta` trae todas las libs de Astal que usa el shell (`AstalWp`, `AstalHyprland`,
`AstalNetwork`, `AstalBluetooth`, `AstalMpris`, `AstalNotifd`, `AstalBattery`, `AstalTray`).
Dependencias que arrastra `aylurs-gtk-shell-git` (para que compile/corra el bundler):
`gjs`, `gtk4-layer-shell`, `gobject-introspection`, `npm`, y opcionalmente `dart-sass`
(compilar `style.scss`) y `blueprint-compiler` (no se usa aquí, pero es dependencia
opcional del paquete).

```sh
sudo pacman -S gjs gtk4-layer-shell gobject-introspection npm dart-sass
```

Comprueba versión con `ags --version` (aquí: `3.1.0`). No hay `package.json` — AGS resuelve
todo en runtime, no hace falta `npm install`.

**Compilar el CSS** — `out.css`/`out.css.map` son artefactos generados de `style.scss`, no
se editan a mano y **no basta con copiarlos**: en el PC nuevo, tras copiar el repo, corre:

```sh
cd ~/.config/ags && sass style.scss out.css
```

(o deja que corra automáticamente si tienes algún watcher; aquí no hay ninguno configurado,
así que es un paso manual tras cada `git pull`/copia).

**Tests de Node** (opcionales, solo para desarrollo, no para que el shell funcione):

```sh
node --test widget/notifications/rules/*.test.ts widget/notifications/history/*.test.ts \
  widget/notifications/cleanup/*.test.ts widget/notifications/settings/*.test.ts \
  widget/services/spotify/*.test.ts
```

Necesita `nodejs` (probado con v26).

## 3. Fuentes

**Ojo:** pese a lo que dice `CLAUDE.md` de ags, el bar/paneles usan **"MesloLGS Nerd Font"**
como fuente principal (glifos de icono incluidos), no JetBrainsMono:

```sh
sudo pacman -S ttf-meslo-nerd
```

`hyprlock.conf` usa además dos fuentes que **no están empaquetadas** — hay que copiar los
`.otf` a mano al nuevo PC (están en `~/.local/share/fonts/` en esta máquina):

- `SF Pro Display` (Bold y Regular) — `~/.local/share/fonts/SF Pro Display/`
- `Steelfish Outline Regular` — `~/.local/share/fonts/steelfish outline regular/`

Cópialas y corre `fc-cache -f` en el PC destino.

## 4. Bar / atajos / herramientas de escritorio

```sh
sudo pacman -S rofi wofi cliphist wl-clipboard brightnessctl playerctl qalculate-gtk \
  wf-recorder grim slurp jq bc hyprshot nm-connection-editor blueman fish git curl
```

Qué usa cada cosa:

- **`hyprshot`** (capturas, `Print` / `Ctrl+Print` en `keybinds.conf`) ya trae como
  dependencias `grim`, `slurp`, `jq`, `libnotify`, `wl-clipboard` — pero como AGS también
  llama a `grim` directamente (preview de workspace al clic-derecho sobre el número, ver
  `widget/bar/Workspaces.tsx`), instálalo igual explícitamente. Opcional: `hyprpicker`
  (congela pantalla durante la captura).
- **`rofi`** — lanzador de apps (`SUPER+SPACE` → `hypr/scripts/rofi-launch.py`, requiere
  además `python3`, ya lo trae el sistema base).
- **`wofi`** — selector del portapapeles (`SUPER+V`, con `cliphist` + `wl-clipboard`).
- **`playerctl`** / **`brightnessctl`** — teclas multimedia y brillo.
- **`wpctl`** (paquete `wireplumber`) — volumen/mute por teclado y en `inicializador/init.sh`.
  El panel de audio de AGS (`QuickSettings.tsx`) además llama a **`pactl`** (paquete
  `libpulse`) y **`pw-metadata`** (paquete `pipewire`) para listar/cambiar sink-inputs y el
  dispositivo por defecto:
  ```sh
  sudo pacman -S libpulse pipewire
  ```
- **`wf-recorder`** — grabación de pantalla (`SUPER+P` toggle vía `record.sh`,
  `SUPER+SHIFT+P` con región vía `slurp`).
- **`qalculate-gtk`** — calculadora (`XF86Calculator`).
- **`nm-connection-editor`** / **`blueman-manager`** — los abre AGS desde QuickSettings
  para "más opciones" de red/bluetooth.
- **`bc`** — usado por `~/.config/inicializador/init.sh` para redondear brillo/volumen
  leídos de `display.json`/`system_state.json`. **En esta misma máquina falta instalado**
  ahora mismo (`bc` no está en el sistema) — instálalo en ambos PCs si no lo has hecho ya,
  si no `init.sh` fallará silenciosamente al aplicar brillo/volumen guardados.
- **`git`** / **`curl`** — usados por el Git section de Orion (`GitService.ts`) y otros.
- **`fd`** (opcional) — el escaneo de repos de Orion (`GitService.ts`) lo usa si está, si no
  cae a `find` automáticamente. No es obligatorio pero es más rápido.

Cosas referenciadas en `variables.conf` que son elección de terminal/gestor de archivos, no
dependencias estrictas — cambia estas líneas si usas otra cosa en el PC nuevo:

```
$terminal = kitty
$fileManager = dolphin
```

```sh
sudo pacman -S --needed kitty dolphin kde-cli-tools
```

`kde-cli-tools` permite que Dolphin descubra las aplicaciones instaladas para el menú
**Abrir con…**. La configuración incluye `~/.config/menus/applications.menu`; después de
instalarla, se puede reconstruir manualmente la caché con:

```sh
kbuildsycoca6 --noincremental
```

**Menú de apagado** — `keybinds.conf` intenta `hyprshutdown` y si no existe cae a
`hyprctl dispatch exit`. `hyprshutdown` **no está instalado en esta máquina tampoco**
(es opcional, de AUR si lo quieres: `paru -S hyprshutdown` o equivalente).

## 5. Wallpaper

```sh
paru -S awww
```

`awww` (fork/paquete específico, **no confundir con `swww`**) se lanza como
`awww-daemon` en `autostart.conf`, y `scripts/wallpaper.sh` hace `awww img "$WALLPAPER"`
sobre un fichero elegido al azar de `~/Wallpapers/*.{jpg,png}` — crea esa carpeta y pon ahí
tus fondos en el PC nuevo (la carpeta no viaja sola con el dotfiles porque no vive dentro de
`~/.config`).

## 6. Portapapeles y utilidades base

```sh
sudo pacman -S wl-clipboard cliphist
```

`autostart.conf` lanza `wl-paste --watch cliphist store` para poblar el historial que usa
`SUPER+V`.

## 7. Secretos (Spotify, credenciales)

El servicio Spotify de AGS (`widget/services/spotify/SpotifyService.ts`) y el script
`~/.config/ags/scripts/spotify-auth.sh` guardan/leen las credenciales en **texto plano**
en `~/.config/gigios/spotify-creds.json` (chmod 600, git-ignored). No hay KWallet ni
Secret Service: se retiró a propósito porque bajo Hyprland pedía la contraseña del monedero
en cada arranque. No hace falta instalar `kwallet`/`libsecret` ni lanzar ningún `ksecretd`.

**Las credenciales de Spotify NO viajan copiando el repo** — el archivo está fuera de git.
En el PC nuevo ejecuta una vez:

```sh
~/.config/ags/scripts/spotify-auth.sh
```

Te pedirá client id/secret de una app tuya en el dashboard de Spotify, hará el flujo OAuth
completo (usa `python3` y `xdg-open`, ya cubiertos) y escribirá el JSON plano con las tres
claves (`client_id`, `client_secret`, `refresh_token`).

## 8. Scripts de monitorización ("escáneres") — `hypr/scripts/`

Todos se lanzan en `autostart.conf` y notifican por `notify-send` (paquete `libnotify`,
ya cubierto por `hyprshot`/`grim` arriba, pero decláralo explícito):

```sh
sudo pacman -S libnotify smartmontools lm_sensors pciutils usbutils alsa-utils \
  util-linux inotify-tools dbus networkmanager bluez bluez-utils
```

Detalle por script:

| Script | Qué vigila | Depende de |
|---|---|---|
| `battery-monitor.sh` | niveles críticos de batería / carga completa | lee `/sys/class/power_supply/BAT0` directo, sin paquete extra — **hardcodea `BAT0`**; en un PC de escritorio sin batería simplemente no encontrará nada y se queda inactivo (no falla) |
| `temp-monitor.sh` | temp. CPU/GPU altas | CPU: lee directo de sysfs (`/sys/class/hwmon/*/temp1_input` del chip `coretemp`, resuelto una vez al arrancar) — sin forkear `sensors` ni `python3`. GPU: `nvidia-smi` (`nvidia-utils`, solo si hay NVIDIA; se detecta una vez al arrancar, no en cada ciclo). **Requiere haber corrido `sudo sensors-detect` una vez en el PC nuevo** para que el driver `coretemp` esté cargado (específico de CPUs Intel; en AMD el chip se llama distinto y el script simplemente no reportará temp de CPU, sin fallar) |
| `ram-monitor.sh` | uso de RAM alto | solo `/proc/meminfo`, sin dependencias |
| `disk-monitor.sh` | espacio en disco bajo | `df`, sin dependencias extra |
| `oom-monitor.sh` | OOM killer, kernel panic, fallos SSH/sudo, segfaults, ficheros críticos modificados | `journalctl` (systemd) + `inotifywait` (`inotify-tools`) sobre `/etc/passwd /etc/sudoers /etc/hosts` |
| `wifi-monitor.sh` | desconexión/reconexión WiFi + portal cautivo | `nmcli` (NetworkManager) — event-driven vía `nmcli monitor`, sin polling; detecta interfaz, SSID y estado de conectividad todo por D-Bus, sin `iw`/`iwgetid` |
| `bt-monitor.sh` | pérdida de conexión Bluetooth | `dbus-monitor` (`dbus`) + `bluetoothctl` (`bluez-utils`) |
| `usb-monitor.sh` | conectar/desconectar USB | `udevadm` (systemd, ya en el sistema base) |
| `boot-healthcheck.sh` | chequeo general al arrancar (servicios fallidos, errores de journal, disco, NVIDIA, SMART, batería, fans, audio, bluetooth, USB) | autodescubre hardware, así que no falla si falta algo; pero para chequeos completos quiere `smartctl` (`smartmontools`), `sensors` (`lm_sensors`), `lspci`/`lsusb` (`pciutils`/`usbutils`), `rfkill` (`util-linux`), `aplay` (`alsa-utils`), `nvidia-smi` (`nvidia-utils`) |
| `hyprland-watchdog.sh` | reinicia Hyprland si se cuelga | ver nota de la sección 1 sobre `wayland-wm@hyprland.desktop.service` |

## 9. NVIDIA (solo si el PC nuevo tiene GPU NVIDIA)

`nvidia.conf` y `envs/firefox.conf` asumen NVIDIA (`LIBVA_DRIVER_NAME=nvidia`,
`__GLX_VENDOR_LIBRARY_NAME=nvidia`, `GBM_BACKEND=nvidia-drm`, etc.). **Si el PC destino
tiene AMD/Intel, quita el `source = ~/.config/hypr/nvidia.conf` de `hyprland.conf`** y edita
`envs/firefox.conf` (borra `LIBVA_DRIVER_NAME=nvidia`, deja el resto — VA-API con Mesa no
necesita esas variables). Sin este ajuste, Firefox/apps con aceleración de vídeo pueden
fallar en un PC no-NVIDIA.

```sh
# solo si hay NVIDIA
sudo pacman -S nvidia-utils
```

## 10. Cosas específicas de ESTA máquina que hay que revisar al migrar

Estas no son paquetes, son configuración/datos ligados al hardware o cuenta actuales:

- **`monitors.conf`** tiene hardcodeado el panel exacto de este portátil
  (`desc:BOE 0x0CDD 0x0000FFA1, 1920x1200@60, 0x0, 1.33`). En el PC nuevo esa línea no
  coincidirá con ningún monitor y Hyprland caerá al fallback genérico
  (`monitor = , preferred, auto, 1`), lo cual funciona pero sin el escalado 1.33 pensado
  para esta pantalla. Ajusta o borra esa línea según el monitor real del PC destino
  (`hyprctl monitors` te da el descriptor correcto una vez arrancado).
- **Foto de perfil**: el master versionado es `assets/face.png`; `bin/link.sh` la copia a
  `~/.cache/gigios/face.png`, la única copia de runtime que leen tanto `hyprlock` como el
  avatar de AGS. Para cambiarla, reemplaza `assets/face.png` y vuelve a correr `bin/link.sh`
  (viaja versionada con el repo, así que en el PC nuevo no hace falta copiar nada aparte).
- **`~/.config/jarvis/git-repos.json`** (Orion → sección Git) tiene rutas de repos locales
  de esta máquina (ej. `~/Documentos/Github/Ravage`); si esas rutas no existen en el PC
  nuevo, la sección Git de Orion simplemente no los mostrará — no es un error, solo revisa
  que las rutas sigan siendo válidas o vuelve a dejar que el auto-scan los descubra.
- **`~/Wallpapers/`** no viaja con `~/.config` — cópiala aparte o `wallpaper.sh` no
  encontrará nada que mostrar.
- Los JSON en `~/.config/gigios/` (`display.json`, `system_state.json`,
  `preferences.json`, `notif-*.json`, etc.) sí son datos de usuario y sí conviene copiarlos
  si quieres el mismo estado (brillo, night light, reglas de notificación...) en el PC
  nuevo — son runtime data, no forman parte del código.

## 11. Orden recomendado para el PC nuevo

1. Instala Hyprland + utilidades de sesión (§1).
2. Instala AGS vía AUR + sus deps (§2), copia el repo `~/.config/ags` y corre
   `sass style.scss out.css`.
3. Instala fuentes (§3) y copia las que no están empaquetadas.
4. Instala el resto de utilidades de escritorio (§4, §6).
5. Corre `spotify-auth.sh` una vez (§7) para regenerar `~/.config/gigios/spotify-creds.json`.
6. Instala las deps de los scripts de monitorización (§8).
7. Ajusta lo específico de esta máquina (§10): `monitors.conf`, foto de perfil
   (`assets/face.png`), `nvidia.conf`/`envs/firefox.conf` si no hay NVIDIA, `~/Wallpapers/`.
8. Copia `~/.config/hypr/` y `~/.config/ags/` (y `~/.config/gigios/` si quieres el
   mismo estado de ajustes), recarga Hyprland (`hyprctl reload` o relogin) y comprueba con
   `ags run ~/.config/ags/app.ts` que el shell arranca sin errores.
9. No olvides lo que **no vive dentro de ninguno de los dos repos** (ver §14, tabla
   "fuera de ambos repos"): `~/.local/bin/*.fish`, `~/.config/inicializador/init.sh` y
   las fuentes manuales. Si solo copias `hypr/` y `ags/`, estas rutas no se copian solas.
10. Pon tus fondos de pantalla (§12) y tu foto de perfil (§13).

## 12. Cómo poner fondos de pantalla (carpeta `~/Wallpapers`)

El wallpaper lo gestiona `awww` (daemon `awww-daemon`, lanzado en `autostart.conf`) más
`hypr/scripts/wallpaper.sh`, que también se lanza una vez al arrancar la sesión.

**Para tener fondos disponibles:**

1. Crea la carpeta si no existe y copia ahí tus imágenes:
   ```sh
   mkdir -p ~/Wallpapers
   cp /ruta/a/tus/fotos/*.png /ruta/a/tus/fotos/*.jpg ~/Wallpapers/
   ```
2. **El script solo busca `*.jpg` y `*.png`** (glob exacto en `wallpaper.sh`:
   `"$WALLPAPER_DIR"/*.{jpg,png}`). Si tus imágenes son `.jpeg`, `.webp` o `.gif`,
   renómbralas a `.jpg`/`.png` o edita esa línea del script para añadir la extensión.
3. Al iniciar sesión, `wallpaper.sh` elige **una al azar** (`shuf -n 1`) de esa carpeta y
   la aplica con una transición aleatoria (`awww img ... --transition-type random`).

**Para cambiarlo sin reiniciar sesión**, tienes dos opciones:

```sh
# Elegir otra al azar de la carpeta (reejecuta el mismo script)
~/.config/hypr/scripts/wallpaper.sh

# Poner una imagen concreta a mano
awww img ~/Wallpapers/mi-foto-favorita.png --transition-type grow --transition-duration 1.5
```

No hay atajo de teclado asignado para esto en `keybinds.conf` — si quieres uno, se añadiría
algo como `bind = $mainMod, W, exec, ~/.config/hypr/scripts/wallpaper.sh` (no está puesto
actualmente, solo como referencia si lo quieres tú mismo).

**Importante para la migración**: `~/Wallpapers/` está fuera de `~/.config`, así que copiar
`hypr/` y `ags/` **no** trae tus fondos — hay que copiar esa carpeta aparte.

## 13. Cómo poner tu foto de perfil

La foto de perfil está **estandarizada en un solo archivo**. El master versionado es
`assets/face.png` (viaja con el repo); `bin/link.sh` lo copia a `~/.cache/gigios/face.png`,
que es la **única copia de runtime**. La leen los dos sitios que muestran tu foto,
así que siempre coinciden:

1. **Pantalla de bloqueo (`hyprlock`)** — `hyprlock.conf`, bloque `image` con
   `path = ~/.cache/gigios/face.png`.
2. **Footer de QuickSettings de AGS** (el avatar) — `widget/QuickSettings.tsx`, función
   `getAvatarPath`, lee `~/.cache/gigios/face.png`. Si el archivo no existe, AGS cae a
   mostrar las iniciales del usuario (no rompe nada).

Para cambiar la foto:
```sh
cp /ruta/a/tu/foto.png ~/GiGiOS/assets/face.png   # actualiza el master versionado
bin/link.sh                                        # refresca ~/.cache/gigios/face.png
```
Alternativa rápida (temporal): copiar tu imagen directamente sobre
`~/.cache/gigios/face.png` — la próxima corrida de `link.sh` la vuelve a sincronizar
desde el master.

## 14. Inventario de rutas — qué es tuyo y qué no

Rastreo completo de las rutas de fichero que tocan `~/.config/hypr` y `~/.config/ags` (y lo
que usan alrededor), separadas por qué tipo de cosa son. Útil para saber qué copiar al
migrar y qué se regenera solo.

### 14.1 Datos tuyos — cópialos si quieres el mismo estado en el PC nuevo

| Ruta | Qué guarda |
|---|---|
| `~/.config/gigios/display.json` | brillo, night light (activo/temperatura) |
| `~/.config/gigios/system_state.json` | estado guardado de wifi/bluetooth/volumen/mute |
| `~/.config/gigios/audioPresets.json` | presets de audio de QuickSettings |
| `~/.config/gigios/app_icons.json` | caché de iconos de apps resueltos |
| `~/.config/gigios/preferences.json` | preferencias de "Personalización" (p.ej. preview de workspace) |
| `~/.config/gigios/notifications.json` | config de notificaciones |
| `~/.config/gigios/notif-rules.json` | reglas del motor de notificaciones |
| `~/.config/gigios/notif-history.json` | historial de notificaciones |
| `~/.config/gigios/notif-cleanup-state.json` | estado del motor de limpieza de notifs |
| `~/.config/gigios/notif-migrated.json` | marca de migración ya aplicada (evita re-migrar) |
| `~/.config/ags/calendar-events.json` | tus eventos del panel de calendario |
| `~/.config/jarvis/git-repos.json` | repos que Orion conoce para la sección Git (rutas locales — revisa que existan en el PC nuevo) |
| `~/.local/share/orion/favorites.json` | apps favoritas fijadas en Orion (nota: `CLAUDE.md` dice que los perfiles de Orion viven en `~/.local/share/jarvis/profiles/` — **es un error**, el código real usa `~/.local/share/orion/`) |
| `~/.local/share/orion/profiles/*.json` | sesiones guardadas de Orion (`ProfileManager.ts`) |
| `~/.config/power-save/config.json` | umbral de ahorro de energía + toggles (ver `widget/power/powerState.ts`) |
| `~/GiGiOS/assets/face.png` | foto de perfil (master versionado); `link.sh` la copia a `~/.cache/gigios/face.png` (§13) |
| `~/Wallpapers/*.jpg` / `*.png` | tus fondos de pantalla (§12) |
| `~/.config/gigios/spotify-creds.json` | credenciales de Spotify en texto plano (chmod 600, git-ignored — ver §7); regenerar con `spotify-auth.sh` |

### 14.2 Config/código del dotfiles — genérico, viaja igual para cualquiera que use este setup

Todo lo demás dentro de `~/.config/hypr/*.conf`, `~/.config/hypr/scripts/`,
`~/.config/hypr/envs/`, y todo `~/.config/ags/` salvo `calendar-events.json` de la
tabla anterior: `app.ts`, `widget/**`, `style.scss`
(→ `out.css` generado, no se edita a mano).

### 14.3 Fuera de ambos repos — ¡no se copian solas al copiar `hypr/` o `ags/`!

Esto es lo más fácil de olvidar en una migración porque **no vive bajo ninguno de los dos
directorios que sueles copiar**:

| Ruta | Por qué importa |
|---|---|
| `~/.local/bin/compact-workspaces.fish` | referenciado desde `keybinds.conf` (`SUPER+SHIFT+N`), no está bajo control de versiones en ningún sitio visible |
| `~/.local/bin/toggle-gaps-borders.fish` | referenciado desde `keybinds.conf` (`SUPER+SHIFT+E`) |
| `~/.config/inicializador/init.sh` | lo lanza `autostart.conf` en cada arranque para aplicar brillo/night light/wifi/bluetooth/volumen guardados; **no es un git repo**, es una carpeta suelta |
| `~/.local/share/fonts/SF Pro Display/*.otf` | fuente del lock screen, no empaquetada (§3) |
| `~/.local/share/fonts/steelfish outline regular/*.otf` | fuente del lock screen, no empaquetada (§3) |

### 14.4 Rutas efímeras — se regeneran solas, no hace falta copiarlas ni preocuparse

| Ruta | Para qué es |
|---|---|
| `/tmp/ags-bar-toggle` | fichero señal para el toggle manual del bar (`CTRL+SUPER+SPACE`) |
| `/tmp/ags-ws-preview-*.png` | capturas de `grim` para el preview de workspace al clic-derecho |
| `/tmp/hypr-gaps-state` | marca si `toggle-gaps-borders.fish` está en modo "sin gaps" |
| `~/.cache/ags/media` | carátulas de álbum cacheadas por el reproductor multimedia |
| `~/.config/hypr/logs/boot-healthcheck.log`, `~/.config/hypr/logs/watchdog.log` | logs propios, rotan solos, no son necesarios para funcionar |

### 14.5 Referenciadas pero que ya no existen en esta máquina (vestigios)

`hyprlock.conf` referencia `~/.config/hypr/hypr.png` (fondo) y
`~/.config/hypr/foreground.png` (imagen decorativa) — **ninguna de las dos existe hoy** en
este sistema. Probablemente son restos de una plantilla de hyprlock genérica; sin el
fichero, esos bloques `background`/`image` simplemente no dibujan nada (no rompen el lock
screen). Si quieres esos elementos, pon una imagen en esas rutas; si no, puedes borrar esos
bloques de `hyprlock.conf`.
