# Diseño: consolidación del sistema en `~/GiGiOS`

Fecha: 2026-07-07
Estado: aprobado el enfoque; pendiente revisión del documento antes del plan de implementación.

## Objetivo

Reunir en una sola carpeta raíz `~/GiGiOS` todo el "sistema" personal que hoy está
disperso por `~/.config`, `~/.local/share` y `$HOME`: el shell de AGS, la config de
Hyprland (incluido hyprlock y sus scripts de escáner), la foto de perfil, los
wallpapers y los pequeños directorios de config auxiliares. El modelo es el de un
repositorio de dotfiles estilo HyDE: una carpeta propia, versionada, separada
conceptualmente de las rutas XDG, pero que sigue "instalada" en ellas mediante
symlinks.

**Restricción dura:** no se cambia comportamiento, solo rutas. Cero ediciones de
código, de archivos `.conf`, de `autostart` o de scripts. Todo debe seguir
resolviendo exactamente las mismas rutas en runtime.

## Hallazgo que condiciona el diseño

El código de AGS y las configs de Hyprland no usan rutas relativas: resuelven sus
datos con rutas XDG fijas, cableadas en el código y en los `.conf`:

- AGS: `GLib.get_user_config_dir()/ags/...` (= `~/.config/ags/...`),
  `get_home_dir()/.config/jarvis/git-repos.json`, `.config/hypr`,
  `.config/power-save/config.json`, `.local/share/orion/...`.
- Hyprland: `source = ~/.config/hypr/*.conf`, `ags run ~/.config/ags/`,
  hyprlock `~/.face` y `~/.config/hypr/*.png`, los monitores leen
  `~/.config/ags/config/preferences.json`, `init.sh` lee `~/.config/ags/config/*`,
  `hyprland-watchdog.service` ejecuta `%h/.config/hypr/scripts/...`.

`get_user_config_dir()` es siempre `~/.config` (fijo por XDG salvo que se reubique
`$XDG_CONFIG_HOME`, lo que movería *todas* las apps). Por tanto, la única forma de
relocalizar físicamente los archivos **sin tocar código ni comportamiento** es un
**symlink-farm**: los archivos reales viven en `~/GiGiOS/…` y symlinks los proyectan
a sus rutas canónicas. Reescribir todas las rutas queda descartado por más riesgoso
y parcialmente inviable.

## Enfoque elegido: symlink-farm a nivel de directorio

Los symlinks se hacen **a nivel de directorio** (no de archivo), salvo `~/.face`.
Ventajas:

- Inmune al patrón "escribir temporal + renombrar encima" que rompe symlinks de
  archivo suelto (los editores/tools que guardan así reemplazarían el link por un
  archivo normal; con directorios esto no ocurre).
- Cualquier archivo nuevo que un programa cree dentro (p.ej. AGS escribiendo un
  JSON de estado) cae automáticamente dentro de `~/GiGiOS`, así que la
  consolidación se mantiene sola sin intervención.
- Hyprland y GLib siguen el symlink de forma transparente al arrancar; el runtime
  es idéntico.

`~/.face` es el único symlink de archivo, y es seguro porque ningún proceso le
escribe encima (hyprlock solo lo lee).

### Nota sobre actualizaciones de Hyprland

Los updates de Hyprland/AGS los hace pacman sobre `/usr/...`, nunca sobre
`~/.config`. Que `~/.config/hypr` sea un directorio real o un symlink es
indiferente para las actualizaciones. La consolidación no ayuda ni estorba a los
updates; su beneficio es de mantenimiento: fuente única versionada, respaldo y
restore triviales.

## Estructura destino

```
~/GiGiOS/
├── ags/                 ← era ~/.config/ags          (shell vivo + config/ + docs)
├── hypr/                ← era ~/.config/hypr          (confs, hyprlock, scripts/, envs/, logs/)
├── inicializador/       ← era ~/.config/inicializador (init.sh)
├── power-save/          ← era ~/.config/power-save
├── jarvis/              ← era ~/.config/jarvis        (git-repos.json — VIVO)
├── wallpapers/          ← era ~/Wallpapers
├── state/
│   └── orion/           ← era ~/.local/share/orion    (favorites, profiles — datos vivos)
├── assets/
│   └── face.png         ← copia real de la foto de perfil
├── _legacy/
│   └── ags-old/         ← era ~/ags (copia muerta de mayo, sin uso)
├── bin/
│   └── link.sh          ← instalador idempotente de symlinks (crea/repara/valida)
├── .gitignore
└── README.md
```

## Mapa de symlinks (canónico → GiGiOS)

| Symlink (permanece en su sitio XDG) | Destino | Tipo |
|---|---|---|
| `~/.config/ags` | `~/GiGiOS/ags` | directorio |
| `~/.config/hypr` | `~/GiGiOS/hypr` | directorio |
| `~/.config/inicializador` | `~/GiGiOS/inicializador` | directorio |
| `~/.config/power-save` | `~/GiGiOS/power-save` | directorio |
| `~/.config/jarvis` | `~/GiGiOS/jarvis` | directorio |
| `~/.local/share/orion` | `~/GiGiOS/state/orion` | directorio |
| `~/Wallpapers` | `~/GiGiOS/wallpapers` | directorio |
| `~/.face` | `~/GiGiOS/assets/face.png` | archivo |

## Fuera de alcance (decidido)

- **`~/.local/share/jarvis`**: archivos muertos (duplicado legado de `orion`, el
  código vivo usa `orion`). No se toca ni se mueve.
- **`~/Imágenes/2026-05-11-...hyprshot.png`**: el original de la foto queda fuera
  del radio de GiGiOS. La foto de perfil entra en GiGiOS como copia en
  `assets/face.png`; el original no se toca.
- **Systemd units** (`~/.config/systemd/user/hyprland-watchdog.service` y su
  `default.target.wants`): systemd exige que vivan ahí. Ya invocan la ruta
  symlinkeada de hypr (`%h/.config/hypr/scripts/...`), así que no se tocan.

## Comportamiento preservado (garantías)

- AGS: `get_user_config_dir()/ags/...` → `~/.config/ags/...` → sigue symlink →
  `~/GiGiOS/ags/...`. Idéntico.
- Hyprland: `source`, `ags run ~/.config/ags/`, hyprlock `~/.face`, monitores
  leyendo `preferences.json`, `init.sh`, watchdog → todos pasan por symlinks.
- `wallpaper.sh` lee `$HOME/Wallpapers` → symlink → `~/GiGiOS/wallpapers`.
- No se edita ningún código, `.conf`, `autostart` ni script.

## Problemas previos que NO se arreglan (se preservan idénticos)

Estos ya están rotos hoy; el objetivo es solo mover rutas, así que se conservan tal
cual (no se corrigen ni se borran sus referencias):

- hyprlock referencia `~/.config/hypr/hypr.png` y `foreground.png`, que no existen.
- `hyprland-watchdog.service` ejecuta `~/.config/hypr/scripts/hyprland-watchdog.sh`,
  que no existe en `scripts/`.

## Git y secretos

- `~/.config/ags` no es un repo git real (solo un `.git/` vacío/roto). No hay
  historial que preservar. Se elimina ese `.git` vacío al mover.
- `~/GiGiOS` será un **repo git nuevo y limpio**.
- `.gitignore` de GiGiOS debe ignorar:
  - `ags/config/spotify-creds.json` — **SECRETO** (chmod 600, jamás commitear).
  - `hypr/logs/` — logs de runtime (boot-healthcheck, watchdog).
  - `state/orion/profiles/` — sesiones volátiles (opcional; por defecto ignoradas).

## `bin/link.sh` (instalador/mantenedor de symlinks)

Script idempotente que es a la vez la herramienta de instalación y de
mantenimiento/restore en una máquina nueva:

- Para cada entrada del mapa de symlinks:
  - Si el destino en GiGiOS existe y la ruta canónica no es aún el symlink correcto,
    lo crea/repara (`ln -sfn`).
  - Si la ruta canónica es un directorio real (no migrado), avisa y no destruye
    nada (requiere migración manual previa; el script no mueve datos, solo enlaza).
- Modo `--check`: reporta el estado de cada symlink sin modificar.
- No borra datos; solo gestiona symlinks.

## Orden de ejecución (seguro, con el shell y Hyprland corriendo)

Cada carpeta se migra con `mv` seguido inmediato de `ln -sfn` (ventana de
sub-segundo sin la ruta; AGS y Hyprland ya están en memoria, no se cuelgan). Al
final se valida en vivo.

1. `mkdir -p ~/GiGiOS/{assets,state,_legacy,bin}`.
2. Migrar cada directorio (mv + symlink): `ags`, `hypr`, `inicializador`,
   `power-save`, `jarvis`, `Wallpapers` → `wallpapers`,
   `.local/share/orion` → `state/orion`.
3. Copiar la foto real a `assets/face.png`; repuntar `~/.face` → ese asset.
4. Archivar `~/ags` → `~/GiGiOS/_legacy/ags-old`.
5. Escribir `bin/link.sh` + `.gitignore` + `README.md`.
6. `git init` en `~/GiGiOS` + primer commit (respetando el `.gitignore`).
7. Validar: recargar AGS, `hyprctl reload`, probar lockscreen, y `readlink` de cada
   symlink para confirmar que apunta a GiGiOS.

## Rollback

Reversible por diseño: `rm` del symlink + `mv` la carpeta de vuelta a su ruta XDG.
`link.sh --check` ayuda a diagnosticar. Ninguna operación borra datos de usuario.

## Criterios de éxito

- AGS sigue corriendo y recargando sin errores tras la migración.
- `hyprctl reload` y el lockscreen funcionan igual que antes.
- Cada ruta canónica del mapa es un symlink que apunta dentro de `~/GiGiOS`.
- Ningún archivo de datos de usuario perdido; el secreto de Spotify sigue chmod 600
  y fuera de git.
- `~/GiGiOS` es un repo git con un primer commit limpio.
