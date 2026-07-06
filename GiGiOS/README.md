# GiGiOS

Carpeta única con todo mi sistema personal para Hyprland: el shell de AGS, la
config de Hyprland (incl. hyprlock y scripts de escáner), la foto de perfil, los
wallpapers y los directorios de config auxiliares. Estilo dotfiles/HyDE: los
archivos reales viven aquí y se "instalan" en sus rutas XDG mediante symlinks.

## Contenido

- `ags/`            — shell de AGS  (symlink: `~/.config/ags`)
- `hypr/`           — config de Hyprland + hyprlock + scripts  (symlink: `~/.config/hypr`)
- `inicializador/`  — init.sh de arranque  (symlink: `~/.config/inicializador`)
- `power-save/`     — flag de ahorro de energía  (symlink: `~/.config/power-save`)
- `wallpapers/`     — fondos  (symlink: `~/Wallpapers`)
- `state/orion/`    — datos del launcher  (symlink: `~/.local/share/orion`)
- `assets/face.png` — foto de perfil  (symlink: `~/.face`)
- `_legacy/`        — copias archivadas sin uso
- `bin/link.sh`     — crea/repara/valida los symlinks

## Instalar / reparar symlinks

```sh
bin/link.sh          # crea o repara los symlinks
bin/link.sh --check  # solo reporta estado
```

`link.sh` no mueve ni borra datos: si una ruta canónica todavía es un directorio
real (sin migrar), avisa y no la toca.

## Restore en una máquina nueva

1. Clonar este repo en `~/GiGiOS`.
2. Restaurar `ags/config/spotify-creds.json` (secreto, fuera de git; chmod 600).
3. Correr `bin/link.sh`.
