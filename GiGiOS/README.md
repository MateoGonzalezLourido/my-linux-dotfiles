# GiGiOS

Carpeta única con todo mi sistema personal para Hyprland: el shell de AGS, la
config de Hyprland (incl. hyprlock y scripts de escáner), la foto de perfil, los
wallpapers y los directorios de config auxiliares. Como árbol de dotfiles, los
archivos reales viven aquí y se "instalan" en sus rutas XDG mediante symlinks.

## Contenido

- `ags/`            — shell de AGS  (symlink: `~/.config/ags`)
- `hypr/`           — config de Hyprland + hyprlock + scripts  (symlink: `~/.config/hypr`)
- `inicializador/`  — init.sh de arranque  (symlink: `~/.config/inicializador`)
- `cache/power-save/` — flag de ahorro de energía, runtime git-ignored  (symlink: `~/.config/power-save`)
- `Wallpapers/`     — fondos  (usados directo por `wallpaper.sh`, sin symlink)
- `state/orion/`    — datos del launcher  (symlink: `~/.local/share/orion`)
- `assets/face.png` — foto personal opcional e ignorada por Git (copia de runtime: `~/.cache/gigios/face.png`)
- `_legacy/`        — copias archivadas sin uso
- `bin/link.sh`     — crea/repara/valida los symlinks

## Instalación nueva (Arch/CachyOS)

El instalador instala paquetes oficiales, usa `paru` o `yay` para AGS/Astal,
descarga el checkout bare, crea los enlaces, compila el CSS y ejecuta la
validación final:

```sh
curl -fsSL https://raw.githubusercontent.com/MateoGonzalezLourido/my-linux-dotfiles/laptop/GiGiOS/install.sh | bash
```

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
bin/preflight.sh --installed # archivos, scripts, comandos y enlaces
```

`link.sh` no mueve ni borra datos: si una ruta canónica todavía es un directorio
real (sin migrar), avisa y no la toca.

## Datos privados

`~/.config/gigios/spotify-creds.json` nunca se versiona. Restáuralo desde una
copia segura o ejecuta `~/.config/ags/scripts/spotify-auth.sh`. La foto
`assets/face.png` también es opcional: sin ella AGS muestra las iniciales.
