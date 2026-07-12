# Instalar GiGiOS en otro PC

## Instalación recomendada

En una instalación de **Arch Linux o CachyOS**, con conexión a Internet y `paru` o `yay`
disponible, ejecuta:

```sh
curl -fsSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/laptop/GiGiOS/install.sh | bash
```

El instalador se encarga de:

- instalar Hyprland, AGS/Astal y las herramientas del escritorio;
- descargar la rama `laptop` mediante el repositorio bare de dotfiles;
- respaldar los archivos locales que entren en conflicto;
- crear los enlaces de `~/.config/ags`, `~/.config/hypr` y demás rutas XDG;
- compilar `style.scss` a `out.css`;
- reconstruir la caché de aplicaciones de Dolphin;
- ejecutar la validación final.

El mismo comando sirve para actualizar un equipo que ya tenga GiGiOS instalado: hace
`fetch` en `~/.dotfiles`, avanza el checkout local hasta `origin/laptop` y vuelve a
comprobar los enlaces. Un `git pull` realizado en otro clon independiente no actualiza
por sí solo la copia desplegada por `~/.dotfiles`.

**AGS sí es obligatorio.** GiGiOS no usa una barra o centro de notificaciones externo:
`ags` ejecuta el shell completo y `AstalNotifd` proporciona el daemon y la interfaz de
notificaciones. El instalador añade `aylurs-gtk-shell-git`, `libastal-meta` y `libnotify`;
el preflight comprueba explícitamente que `ags`, `notify-send` y todos los typelibs Astal
estén disponibles.

### Después del instalador

Solo quedan estas decisiones personales:

1. **GPU:** antes de abrir Hyprland, activa como máximo un perfil en
   `~/GiGiOS/hypr/hyprland.conf`. Déjalos ambos desactivados para Intel o AMD sin NVIDIA;
   usa `gpu/laptop-hibrida.conf` para un portátil Intel+NVIDIA o
   `gpu/sobremesa-nvidia.conf` para una NVIDIA como GPU principal. Consulta la §9.
2. **Spotify:** ejecuta `~/.config/ags/scripts/spotify-auth.sh` si quieres integrar tu
   cuenta. Es opcional y las credenciales nunca se incluyen en Git.
3. **Seguridad:** ejecuta una vez `sudo freshclam` para descargar las firmas de ClamAV.
4. **Sensores:** ejecuta `sudo sensors-detect` solamente si quieres monitorización de
   temperatura y el equipo la necesita.

Finalmente, cierra y vuelve a abrir la sesión. Puedes comprobar el resultado con:

```sh
~/GiGiOS/bin/preflight.sh --installed
ags run ~/.config/ags/app.ts
```

Para iniciar Hyprland desde una TTY puedes usar:

```sh
uwsm start hyprland.desktop
```

Si utilizas un display manager, selecciona la sesión **Hyprland (uwsm)**.

La foto personal, las fuentes propietarias del lock screen y la configuración de Spotify
son opcionales; su ausencia no impide arrancar GiGiOS.

### Instalación sin gestionar paquetes

Si ya instalaste las dependencias o no usas Arch/CachyOS:

```sh
curl -fsSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/laptop/GiGiOS/install.sh | INSTALL_PACKAGES=0 bash
```

En otra distribución tendrás que traducir manualmente los paquetes descritos debajo.

---

Las siguientes secciones son la referencia detallada de componentes, dependencias,
hardware, datos personales y resolución de problemas. No es necesario ejecutar cada
bloque de `pacman` después de haber usado el instalador recomendado.

## 1. Base: Hyprland + utilidades de sesión

```sh
sudo pacman -S hyprland hyprlock hypridle hyprpolkitagent hyprsunset uwsm \
  xdg-desktop-portal-hyprland xdg-desktop-portal-gtk qt6-wayland
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
- `uwsm` gestiona la sesión de Hyprland mediante systemd de usuario.
- Los portales de Hyprland y GTK son necesarios para compartir pantalla y abrir
  selectores de archivos en aplicaciones Wayland.

## 2. AGS (el shell en sí)

AGS v2 (Aylur's GTK Shell) **no está en los repos oficiales de Arch**, viene de AUR:

```sh
paru -S aylurs-gtk-shell-git libastal-meta
```

`libastal-meta` trae todas las libs de Astal que usa el shell (`AstalWp`, `AstalHyprland`,
`AstalNetwork`, `AstalBluetooth`, `AstalMpris`, `AstalNotifd`, `AstalBattery`, `AstalTray`).
`AstalNotifd` es el servidor de notificaciones de la sesión: no instales otro daemon como
`dunst` o `mako` a la vez, porque competirían por el mismo nombre de D-Bus.
Dependencias que arrastra `aylurs-gtk-shell-git` (para que compile/corra el bundler):
`gjs`, `gtk4-layer-shell`, `gobject-introspection`, `npm`, y opcionalmente `dart-sass`
(compilar `style.scss`) y `blueprint-compiler` (no se usa aquí, pero es dependencia
opcional del paquete).

```sh
sudo pacman -S gjs gtk4-layer-shell gobject-introspection npm dart-sass
```

Comprueba versión con `ags --version` (aquí: `3.1.0`). No hay `package.json` — AGS resuelve
todo en runtime, no hace falta `npm install`.

**Compilar el CSS** — `out.css` es un artefacto generado de `style.scss` y no se edita a
mano. `install.sh` lo recompila automáticamente. Si modificas SCSS después, corre:

```sh
cd ~/.config/ags && sass style.scss out.css
```

No hace falta hacerlo manualmente durante la primera instalación.

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
sudo pacman -S rofi cliphist wl-clipboard brightnessctl playerctl qalculate-gtk \
  wf-recorder grim slurp jq bc hyprshot nm-connection-editor blueman fish git curl \
  btop upower libgudev cups geoclue mesa-utils lshw fd github-cli
```

Qué usa cada cosa:

- **`hyprshot`** (capturas, `Print` / `Ctrl+Print` en `keybinds.conf`) ya trae como
  dependencias `grim`, `slurp`, `jq`, `libnotify`, `wl-clipboard` — pero como AGS también
  llama a `grim` directamente (preview de workspace al clic-derecho sobre el número, ver
  `widget/bar/Workspaces.tsx`), instálalo igual explícitamente. Opcional: `hyprpicker`
  (congela pantalla durante la captura).
- **`rofi`** — lanzador de apps (`SUPER+SPACE` → `hypr/scripts/rofi-launch.py`, requiere
  además `python3`, ya lo trae el sistema base) y selector del portapapeles (`SUPER+V`,
  con `cliphist` + `wl-clipboard`). `hypr/scripts/clipboard-history.sh` carga directamente
  el tema versionado `GiGiOS/rofi/clipboard-solarized.rasi`, sin modificar la
  configuración global de Rofi.
- **`playerctl`** / **`brightnessctl`** — teclas multimedia y brillo.
- **`wpctl`** (paquete `wireplumber`) — volumen/mute por teclado y en `inicializador/init.sh`.
  El panel de audio de AGS (`QuickSettings.tsx`) además llama a **`pactl`** (paquete
  `libpulse`) y **`pw-metadata`** (paquete `pipewire`) para listar/cambiar sink-inputs y el
  dispositivo por defecto:
  ```sh
  sudo pacman -S libpulse pipewire pipewire-audio pipewire-pulse pipewire-alsa \
    wireplumber gst-plugin-pipewire
  ```
- **`wf-recorder`** — grabación de una región con `SUPER+SHIFT+P` vía `slurp`.
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
sudo pacman -S awww imagemagick
```

`awww` (**no confundir con `swww`**) se lanza como
`awww-daemon` en `autostart.conf`, y `scripts/wallpaper.sh` hace `awww img "$WALLPAPER"`
sobre un fichero elegido al azar de `~/GiGiOS/Wallpapers/*.{jpg,png}`. El repositorio ya
incluye fondos iniciales; puedes sustituirlos por los tuyos.

`imagemagick` (comando `magick`) lo usa la sección **Temas** de Orion para generar las
miniaturas de la rejilla de fondos, que cachea en `~/.cache/gigios/wp-thumbs/` (un JPEG de
336x192 por fondo, ~15 KB). Se genera en un proceso aparte precisamente para no bloquear el
shell: los fondos originales son enormes (aquí hay PNG de 8192x6144) y decodificar uno
entero en el hilo de AGS congelaba la UI varios segundos.

Es **opcional**: sin `magick` se cae a GdkPixbuf, que hace lo mismo pero más lento y con más
carga para el shell en la primera pasada. Instalarlo es la diferencia entre ~2 s con la UI
fluida y ~4 s con la UI a tirones — solo la primera vez, porque después las miniaturas ya
están cacheadas y la rejilla abre en ~30 ms. La caché se mantiene sola: solo genera lo que
falta, rehace lo que esté corrupto y borra las miniaturas de fondos que ya no existen.

## 6. Portapapeles y utilidades base

```sh
sudo pacman -S wl-clipboard cliphist
```

`autostart.conf` lanza `wl-paste --watch cliphist store` para poblar el historial que usa
`SUPER+V`. El selector Rofi utiliza `#fdf6e3` como fondo principal, `#eee8d5` para las
filas alternas y `#b4befe` —el `select-bg` de la plantilla `style_1` de HyDE— para la
selección activa. Como el script resuelve `GiGiOS/rofi/clipboard-solarized.rasi` desde la
ruta física del repositorio, el tema se aplica también en instalaciones nuevas sin tocar
`~/.config/rofi`.

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
  util-linux inotify-tools dbus networkmanager bluez bluez-utils xdg-user-dirs
```

El instalador habilita `NetworkManager.service` y `bluetooth.service`. CUPS se instala
pero queda bajo control del interruptor **Ajustes → Dispositivos → Impresoras**, para no
mantener el servicio activo en equipos que no imprimen.

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
| `screencast-monitor.sh` | que algo esté **capturando la pantalla**: compartir (Discord, OBS, Zoom, navegadores) o grabar en local. Enciende el icono de la barra (`ScreencastIndicator`) | **no añade ningún paquete nuevo**: `jq` y `wf-recorder` (§ herramientas), `pw-dump`/`pw-mon` (paquete `pipewire`, ya instalado para el audio) y `xdg-desktop-portal-hyprland` (§ Hyprland). Sin `jq` o sin `pw-dump` el script sale sin escribir y el icono nunca aparece. **Compartir pantalla se detecta a través del portal**, así que el portal es obligatorio para esa mitad; los grabadores locales (`wf-recorder`, `gpu-screen-recorder`, `wl-screenrec`, `obs`) se detectan por proceso y solo hacen falta si los usas |
| `boot-healthcheck.sh` | chequeo general al arrancar (servicios fallidos, errores de journal, disco, NVIDIA, SMART, batería, fans, audio, bluetooth, USB) | autodescubre hardware, así que no falla si falta algo; pero para chequeos completos quiere `smartctl` (`smartmontools`), `sensors` (`lm_sensors`), `lspci`/`lsusb` (`pciutils`/`usbutils`), `rfkill` (`util-linux`), `aplay` (`alsa-utils`), `nvidia-smi` (`nvidia-utils`) |

### 8.1 Escaneo antivirus, integridad y sandbox

El monitor `oom-monitor.sh` incorpora tres funciones de seguridad adicionales:

- vigila cambios en archivos críticos mediante `inotifywait`;
- analiza archivos nuevos o modificados dentro de la carpeta XDG de Descargas con
  ClamAV, deduplicando por hash de contenido;
- ofrece analizar archivos grandes y lanzar ejecutables no confiables dentro de un
  sandbox cuando están disponibles los scripts auxiliares.

Instala sus dependencias:

```sh
sudo pacman -S --needed clamav firejail bubblewrap xxhash xdg-user-dirs file
sudo freshclam
```

- `clamav` proporciona `clamscan`. Sin una base descargada con `freshclam`, el programa
  existe pero no puede detectar firmas.
- `firejail` es el motor principal usado para lanzar archivos o aplicaciones no
  confiables con aislamiento de procesos, red y sistema de archivos según el perfil
  aplicado por `run-untrusted.sh`.
- `bubblewrap` proporciona `bwrap`, usado para construir el sandbox. Esto reduce el
  acceso del proceso al sistema y puede servir como backend o alternativa cuando así lo
  decida `run-untrusted.sh`.
- Firejail y Bubblewrap no son antivirus: contienen el proceso, mientras que ClamAV
  analiza el archivo. **Ninguno convierte un archivo desconocido en seguro.**
- `xxhash` proporciona `xxh64sum` para evitar volver a escanear contenido idéntico. Si
  falta, el monitor cae a `sha1sum` o `md5sum` de `coreutils`, pero será más lento.
- `xdg-user-dirs` permite encontrar `~/Descargas` aunque el sistema use otro idioma.
- `file` lo usa `bin/verify-files.sh` para detectar ejecutables disfrazados por sus
  magic bytes antes de cada `git push`.

Tras instalar ClamAV, comprueba la configuración con un archivo legítimo cualquiera:

```sh
clamscan --version
firejail --version
bwrap --version
clamscan --no-summary ~/Descargas/algún-archivo
```

El estado se guarda en `~/.cache/gigios/download-index` y
`~/.cache/gigios/download-hashes`; es caché regenerable y no se copia al migrar. Las
preferencias viven en `~/.config/gigios/security.json` y se leen una sola vez al arrancar
`oom-monitor.sh`: después de cambiar un interruptor de Seguridad hay que cerrar sesión o
reiniciar manualmente ese script.

Para que la interfaz y las acciones funcionen, el repo debe contener estos archivos; los
dos scripts `.sh` deben tener permiso de ejecución:

```text
GiGiOS/ags/widget/settings/SecuritySection.tsx
GiGiOS/ags/widget/settings/securityPrefs.ts
GiGiOS/hypr/scripts/scan-file.sh
GiGiOS/hypr/scripts/run-untrusted.sh
```

Los cuatro archivos están versionados y `bin/preflight.sh` comprueba su presencia y los
permisos ejecutables de los scripts.

## 9. Elegir la configuración de GPU correcta

Antes de iniciar Hyprland en otro equipo, identifica las GPU disponibles:

```sh
lspci -k | grep -A3 -E 'VGA|3D|Display'
ls -l /dev/dri/by-path 2>/dev/null
```

Los perfiles viven en `~/.config/hypr/gpu/` y se seleccionan en el bloque **GPU** de
`hyprland.conf`. Descomenta **solo uno** que corresponda al hardware; nunca cargues dos
perfiles al mismo tiempo.

- **Portátil Intel + NVIDIA para offload:** usa `gpu/laptop-hibrida.conf`. Hyprland y la
  pantalla funcionan sobre Intel; los juegos pesados se lanzan con `prime-run`.
- **Sobremesa NVIDIA:** debería usar `gpu/sobremesa-nvidia.conf`.
- **Solo AMD o solo Intel:** no cargues ningún perfil NVIDIA. Normalmente Hyprland puede
  escoger la GPU automáticamente; crea un perfil específico únicamente si necesitas
  fijar dispositivos o solucionar una particularidad del driver.

Los perfiles de portátil híbrido y sobremesa NVIDIA están versionados. Ninguno se carga
por defecto para que el primer arranque sea portable: activa exactamente uno solo si lo
necesita tu hardware.

`envs/firefox.conf` solo activa Wayland/EGL y no fuerza un driver VA-API ni desactiva el
sandbox multimedia. Los ajustes exclusivos de NVIDIA están aislados en el perfil de
sobremesa.

```sh
# solo si hay NVIDIA
sudo pacman -S nvidia-utils nvidia-prime
# si NVIDIA es la GPU principal y quieres VA-API
sudo pacman -S libva-nvidia-driver
```

## 10. Cosas específicas de ESTA máquina que hay que revisar al migrar

Estas no son paquetes, son configuración/datos ligados al hardware o cuenta actuales:

- **`monitors.conf`** usa actualmente el fallback genérico
  (`monitor = , preferred, auto, 1`), adecuado para el monitor 2560×1440 de 27 pulgadas.
  Después puedes ajustar resolución, frecuencia, posición o escala desde AGS; usa
  `hyprctl monitors` para comprobar el descriptor y los valores aplicados.
- **Foto de perfil**: el archivo local opcional es `assets/face.png`; `bin/link.sh` lo copia a
  `~/.cache/gigios/face.png`, la única copia de runtime que leen tanto `hyprlock` como el
  avatar de AGS. Está ignorado por Git para no publicar una foto personal: cópialo por
  separado o configura el avatar desde AGS. Sin foto, AGS muestra las iniciales.
- **`~/.config/jarvis/git-repos.json`** (Orion → sección Git) tiene rutas de repos locales
  de esta máquina (ej. `~/Documentos/Github/Ravage`); si esas rutas no existen en el PC
  nuevo, la sección Git de Orion simplemente no los mostrará — no es un error, solo revisa
  que las rutas sigan siendo válidas o vuelve a dejar que el auto-scan los descubra.
- **`~/GiGiOS/Wallpapers/`** viaja con este repositorio y contiene los fondos que usa
  `wallpaper.sh`.
- Los JSON en `~/.config/gigios/` (`display.json`, `system_state.json`,
  `preferences.json`, `notif-*.json`, etc.) sí son datos de usuario y sí conviene copiarlos
  si quieres el mismo estado (brillo, night light, reglas de notificación...) en el PC
  nuevo — son runtime data, no forman parte del código.

## 11. Orden recomendado para el PC nuevo

### Antes de migrar: preflight del repositorio

El instalador remoto solo puede descargar archivos que estén **versionados, incluidos en
un commit y publicados en `origin/laptop`**. Que AGS funcione en la máquina de desarrollo
no demuestra que esos archivos estén en Git.

Ejecuta esto en la máquina origen antes del push:

```sh
cd ~/Github-Repos/my-linux-dotfiles
git status --short
GiGiOS/bin/preflight.sh
GIGIOS="$PWD/GiGiOS" GiGiOS/bin/link.sh --check
bash -n GiGiOS/install.sh GiGiOS/inicializador/init.sh GiGiOS/hypr/scripts/*.sh
bin/verify-files.sh
```

En este repositorio bare usa también:

```sh
dotfiles status --short --untracked-files=all -- GiGiOS .github
dotfiles ls-files GiGiOS/ags/widget/settings/SecuritySection.tsx \
  GiGiOS/hypr/scripts/scan-file.sh GiGiOS/bin/preflight.sh
```

La primera orden no debe mostrar cambios pendientes antes de probar la URL pública; la
segunda debe imprimir los tres archivos. El workflow debe vivir en
`.github/workflows/gigios-validate.yml` en la **raíz del repositorio**, no dentro de
`GiGiOS/.github/`. Después de hacer commit y push, verifica que la acción de GitHub pase
en la rama `laptop`.

Comprueba además que no falte ningún archivo referenciado por la configuración:

```sh
for f in \
  GiGiOS/hypr/scripts/clipboard-history.sh \
  GiGiOS/rofi/clipboard-solarized.rasi \
  GiGiOS/hypr/scripts/scan-file.sh \
  GiGiOS/hypr/scripts/run-untrusted.sh \
  GiGiOS/ags/widget/settings/AccountSection.tsx \
  GiGiOS/ags/widget/settings/AppsSection.tsx \
  GiGiOS/ags/widget/settings/DateLanguageSection.tsx \
  GiGiOS/ags/widget/settings/DevicesSection.tsx \
  GiGiOS/ags/widget/settings/DisplaySection.tsx \
  GiGiOS/ags/widget/settings/SecuritySection.tsx \
  GiGiOS/ags/widget/settings/SystemSection.tsx \
  GiGiOS/ags/widget/settings/securityPrefs.ts; do
  test -f "$f" || echo "FALTA: $f"
done
```

El preflight falla si falta código obligatorio. `assets/face.png` es deliberadamente
opcional y está ignorado para no publicar una foto personal; sin él se muestran iniciales.

### Resumen de la instalación

La instalación completa está al principio de esta guía. Como lista de comprobación final:

1. Comprueba y activa, si corresponde, un único perfil GPU (§9).
2. Copia las fuentes no empaquetadas si quieres reproducir exactamente el lock screen (§3).
3. Corre `spotify-auth.sh` una vez (§7) para regenerar las credenciales.
4. Corre
   `sudo freshclam` y `sudo sensors-detect` cuando corresponda.
5. Ajusta `monitors.conf`, el avatar opcional y los fondos si quieres personalizarlos.
6. Restaura
   `~/.config/gigios/` solo si quieres conservar el mismo estado y recarga Hyprland
   (`hyprctl reload` o vuelve a iniciar sesión). Comprueba con
   `ags run ~/.config/ags/app.ts` que el shell arranca sin errores.
7. Corre `~/GiGiOS/bin/preflight.sh --installed`.

## 12. Cómo poner fondos de pantalla (`~/GiGiOS/Wallpapers`)

El wallpaper lo gestiona `awww` (daemon `awww-daemon`, lanzado en `autostart.conf`) más
`hypr/scripts/wallpaper.sh`, que también se lanza una vez al arrancar la sesión.

**Para tener fondos disponibles:**

1. Copia imágenes al directorio versionado:
   ```sh
   cp /ruta/a/tus/fotos/*.png /ruta/a/tus/fotos/*.jpg ~/GiGiOS/Wallpapers/
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
awww img ~/GiGiOS/Wallpapers/mi-foto-favorita.png --transition-type grow --transition-duration 1.5
```

No hay atajo de teclado asignado para esto en `keybinds.conf` — si quieres uno, se añadiría
algo como `bind = $mainMod, W, exec, ~/.config/hypr/scripts/wallpaper.sh` (no está puesto
actualmente, solo como referencia si lo quieres tú mismo).

**Desde Orion** (`SUPER+ALT+Space` → sección *Temas*) tienes la rejilla de fondos: clic para
aplicar uno, botón de aleatorio, y el toggle de "fondo aleatorio al iniciar Hyprland". Copiar
o borrar un fondo en `~/GiGiOS/Wallpapers` se refleja ahí **sin reiniciar AGS** (la carpeta se
vigila con un `Gio.FileMonitor`), y su miniatura se genera y cachea sola. Ver la sección 5
para la dependencia `imagemagick` y la caché de `~/.cache/gigios/wp-thumbs/`; borrarla entera
no rompe nada, se regenera.

Los fondos están dentro de GiGiOS, por lo que viajan con un clon completo del repositorio.

## 13. Cómo poner tu foto de perfil

La foto de perfil es opcional y privada. Puedes colocarla primero en
`assets/face.png` y dejar que `bin/link.sh` la copie a `~/.cache/gigios/face.png`, o
seleccionarla desde Ajustes de AGS, que escribe directamente la copia de runtime.
`assets/face.png` está ignorado por Git y no viaja a otro PC.

1. **Pantalla de bloqueo (`hyprlock`)** — `hyprlock.conf`, bloque `image` con
   `path = ~/.cache/gigios/face.png`.
2. **Footer de QuickSettings de AGS** (el avatar) — `widget/QuickSettings.tsx`, función
   `getAvatarPath`, lee `~/.cache/gigios/face.png`. Si el archivo no existe, AGS cae a
   mostrar las iniciales del usuario (no rompe nada).

Para cambiar la foto:
```sh
cp /ruta/a/tu/foto.png ~/GiGiOS/assets/face.png   # copia privada local
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
| `~/.config/gigios/security.json` | interruptores del monitor de seguridad; se leen al iniciar `oom-monitor.sh` |
| `~/.config/ags/calendar-events.json` | tus eventos del panel de calendario |
| `~/.config/jarvis/git-repos.json` | repos que Orion conoce para la sección Git (rutas locales — revisa que existan en el PC nuevo) |
| `~/.local/share/orion/favorites.json` | apps favoritas fijadas en Orion (nota: `CLAUDE.md` dice que los perfiles de Orion viven en `~/.local/share/jarvis/profiles/` — **es un error**, el código real usa `~/.local/share/orion/`) |
| `~/.local/share/orion/profiles/*.json` | sesiones guardadas de Orion (`ProfileManager.ts`) |
| `~/.config/power-save/config.json` | umbral de ahorro de energía + toggles (ver `widget/power/powerState.ts`) |
| `~/GiGiOS/assets/face.png` | foto privada opcional, ignorada por Git; `link.sh` la copia al caché (§13) |
| `~/GiGiOS/Wallpapers/*.jpg` / `*.png` | tus fondos de pantalla (§12) |
| `~/.config/gigios/spotify-creds.json` | credenciales de Spotify en texto plano (chmod 600, git-ignored — ver §7); regenerar con `spotify-auth.sh` |

### 14.2 Config/código del dotfiles — genérico, viaja igual para cualquiera que use este setup

Todo lo demás dentro de `~/.config/hypr/*.conf`, `~/.config/hypr/scripts/`,
`~/.config/hypr/envs/`, y todo `~/.config/ags/` salvo `calendar-events.json` de la
tabla anterior: `app.ts`, `widget/**`, `style.scss`
(→ `out.css` generado, no se edita a mano).

### 14.3 Fuera de `hypr/` y `ags/`, pero incluidos en este repositorio

Esto es lo más fácil de olvidar en una migración porque **no vive bajo ninguno de los dos
directorios que sueles copiar**:

| Ruta | Por qué importa |
|---|---|
| `~/.config/hypr/scripts/compact-workspaces.sh` | compacta workspaces (`SUPER+SHIFT+N`); incluido en GiGiOS |
| `~/.config/hypr/scripts/toggle-gaps-borders.sh` | alterna gaps (`SUPER+SHIFT+E`); incluido en GiGiOS |
| `~/.config/inicializador/init.sh` | lo lanza `autostart.conf`; está versionado en `GiGiOS/inicializador/` y `GiGiOS/bin/link.sh` crea el enlace |
| `~/.local/share/fonts/SF Pro Display/*.otf` | fuente del lock screen, no empaquetada (§3) |
| `~/.local/share/fonts/steelfish outline regular/*.otf` | fuente del lock screen, no empaquetada (§3) |

Las fuentes manuales son las únicas entradas de esta tabla que hay que copiar por separado.

### 14.4 Rutas efímeras — se regeneran solas, no hace falta copiarlas ni preocuparse

| Ruta | Para qué es |
|---|---|
| `/tmp/ags-bar-toggle` | fichero señal para el toggle manual del bar (`CTRL+SUPER+SPACE`) |
| `/tmp/ags-ws-preview-*.png` | capturas de `grim` para el preview de workspace al clic-derecho |
| `$XDG_RUNTIME_DIR/gigios-gaps-disabled` | marca si el toggle está en modo "sin gaps" |
| `~/.cache/ags/media` | carátulas de álbum cacheadas por el reproductor multimedia |
| `~/.config/hypr/logs/boot-healthcheck.log` | log propio; rota solo y no es necesario para funcionar |
