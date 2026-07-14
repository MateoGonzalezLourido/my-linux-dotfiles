# GiGiOS

Carpeta única con todo mi sistema personal para Hyprland: el shell de AGS, la
config de Hyprland (incl. hyprlock y scripts de escáner), la foto de perfil, los
wallpapers y los directorios de config auxiliares. Como árbol de dotfiles, los
archivos reales viven aquí y se "instalan" en sus rutas XDG mediante symlinks.

## Contenido

- `ags/`            — shell de AGS  (symlink: `~/.config/ags`)
- `hypr/`           — config de Hyprland + hyprlock + scripts  (symlink: `~/.config/hypr`)
- `inicializador/`  — init.sh de arranque  (symlink: `~/.config/inicializador`)
- `mimeapps.list`   — aplicaciones predeterminadas por tipo MIME  (symlink: `~/.config/mimeapps.list`)
- `menus/applications.menu` — catálogo de aplicaciones de KDE/Dolphin  (symlink: `~/.config/menus/applications.menu`)
- `kdeglobals`      — preferencias KDE compartidas: Breeze Dark, Kitty e iconos Tela  (symlink: `~/.config/kdeglobals`)
- `qt6ct/qt6ct.conf` — integración Qt en Hyprland: Breeze oscuro con densidad compacta  (symlink: `~/.config/qt6ct/qt6ct.conf`)
- `mime/packages/`  — tipos MIME propios para clasificar correctamente dotfiles especiales
- `cache/power-save/` — flag de ahorro de energía, runtime git-ignored  (symlink: `~/.config/power-save`)
- `Wallpapers/`     — fondos  (usados directo por `wallpaper.sh`, sin symlink)
- `state/orion/`    — datos del launcher  (symlink: `~/.local/share/orion`)
- `assets/face.png` — foto personal opcional e ignorada por Git (copia de runtime: `~/.cache/gigios/face.png`)
- `_legacy/`        — copias archivadas sin uso
- `bin/link.sh`     — crea/repara/valida los symlinks
- `bin/kitty-profile.sh` — selecciona el perfil de Kitty de esta máquina
- `bin/firefox-profile.sh` — compone y aplica el perfil de Firefox en su perfil real
- `bin/configurar-dolphin.sh` — aplica miniaturas selectivas y restaura las pestañas de Dolphin

## Instalación nueva (Arch/CachyOS)

El instalador instala paquetes oficiales, usa `paru` o `yay` para AGS/Astal,
descarga el checkout bare, crea los enlaces, compila el CSS y ejecuta la
validación final:

```sh
curl -fsSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/laptop/GiGiOS/install.sh | bash
```

Kitty elige automáticamente el perfil de bajo consumo en equipos con batería y
el perfil responsivo en sobremesas. Se puede forzar durante la instalación con
`KITTY_PROFILE=laptop` o `KITTY_PROFILE=desktop`. La estructura, los valores y
el cambio posterior están documentados en [docs/kitty-profiles.md](docs/kitty-profiles.md).

Firefox usa la misma detección con `FIREFOX_PROFILE`. Su selector resuelve el
nombre aleatorio del perfil predeterminado y enlaza allí el `user.js` generado;
así la configuración sí se aplica en cada arranque. Consulta
[docs/firefox-profiles.md](docs/firefox-profiles.md) para ver las diferencias y
las preferencias de seguridad corregidas.

Para añadir otra aplicación con variantes por equipo, sigue la guía
[docs/anadir-perfiles-por-equipo.md](docs/anadir-perfiles-por-equipo.md). Incluye
la estructura, el contrato del selector, integración con el instalador,
preflight y las pruebas de una instalación limpia.

Antes de iniciar Hyprland, revisa la GPU en `hypr/hyprland.conf`. Por seguridad
no se activa ningún perfil específico en una instalación nueva. Los únicos
pasos deliberadamente manuales son los que necesitan datos o privilegios del
usuario: Spotify, `sudo freshclam`, `sudo sensors-detect` y fuentes propietarias.
La guía completa y la resolución de problemas están en [hypr/SETUP.md](hypr/SETUP.md).

Para instalar solo los archivos y gestionar paquetes por tu cuenta:

```sh
curl -fsSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/laptop/GiGiOS/install.sh | INSTALL_PACKAGES=0 bash
```

Este modo omite únicamente la instalación de paquetes: las dependencias siguen siendo
necesarias para completar la validación. En Arch/CachyOS, `dart-sass` proporciona el
comando `sass` que compila `ags/style.scss`.

## Reparar o validar

```sh
bin/link.sh          # crea o repara los symlinks
bin/link.sh --check  # solo reporta estado
bin/kitty-profile.sh status # muestra el perfil de Kitty activo
bin/firefox-profile.sh status # comprueba el user.js del perfil real
bin/preflight.sh --installed # archivos, scripts, comandos y enlaces
```

`link.sh` no mueve ni borra datos: si una ruta canónica todavía es un directorio
real (sin migrar), avisa y no la toca.

## Datos privados

`~/.config/gigios/spotify-creds.json` nunca se versiona. Restáuralo desde una
copia segura o ejecuta `~/.config/ags/scripts/spotify-auth.sh`. La foto
`assets/face.png` también es opcional: sin ella AGS muestra las iniciales.
