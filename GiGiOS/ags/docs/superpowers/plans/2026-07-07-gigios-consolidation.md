# GiGiOS Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reunir el shell de AGS, la config de Hyprland, la foto de perfil, los wallpapers y los directorios de config auxiliares en una sola carpeta `~/GiGiOS`, dejando symlinks en las rutas XDG para no cambiar comportamiento.

**Architecture:** Symlink-farm a nivel de directorio. Los archivos reales se mueven a `~/GiGiOS/…`; las rutas canónicas (`~/.config/ags`, `~/.config/hypr`, `~/.face`, etc.) quedan como symlinks que apuntan dentro de GiGiOS. AGS y Hyprland siguen los symlinks de forma transparente. Cero ediciones de código o de `.conf`.

**Tech Stack:** bash, coreutils (`mv`, `ln`, `cp`, `readlink`), git.

---

## Reglas de ejecución (leer antes de empezar)

- **Correr TODO desde `$HOME` con rutas absolutas.** Al mover `~/.config/ags` el cwd del shell queda inválido. Nunca hacer `cd` a un directorio que se va a mover.
- El sistema está **vivo** (AGS y Hyprland corriendo). Cada migración hace `mv` y `ln` encadenados con `&&` para minimizar la ventana sin la ruta. AGS/Hyprland ya tienen su config en memoria, así que la ventana es inofensiva.
- Ninguna operación borra datos de usuario. `~/ags` muerto se **archiva**, no se borra.
- Tras cada migración se verifica con `readlink -f` que el symlink resuelve dentro de GiGiOS y que un archivo canónico es legible a través de él.

---

## Estructura de archivos

Se crean/mueven (no se edita ningún archivo existente de código/config):

- Crea: `~/GiGiOS/` (raíz) y subdirs `assets/ state/ _legacy/ bin/`
- Mueve: `~/.config/ags`, `~/.config/hypr`, `~/.config/inicializador`, `~/.config/power-save`, `~/.config/jarvis`, `~/Wallpapers`, `~/.local/share/orion`, `~/ags`
- Crea: `~/GiGiOS/assets/face.png`, `~/GiGiOS/bin/link.sh`, `~/GiGiOS/.gitignore`, `~/GiGiOS/README.md`
- Repunta: `~/.face` (symlink)

---

## Task 0: Pre-flight — snapshot de seguridad

**Files:** ninguno (solo lectura + log).

- [ ] **Step 1: Registrar el estado actual en un log de rollback**

Run:
```bash
mkdir -p "$HOME/GiGiOS"
{
  echo "=== GiGiOS pre-flight $(date -Is) ==="
  for p in "$HOME/.config/ags" "$HOME/.config/hypr" "$HOME/.config/inicializador" \
           "$HOME/.config/power-save" "$HOME/.config/jarvis" "$HOME/Wallpapers" \
           "$HOME/.local/share/orion" "$HOME/ags" "$HOME/.face"; do
    printf '%s -> ' "$p"; ls -ld "$p" 2>&1
  done
  echo "readlink .face: $(readlink "$HOME/.face" 2>&1)"
} | tee "$HOME/GiGiOS/preflight-snapshot.txt"
```
Expected: imprime cada ruta. `~/.config/*` y `~/Wallpapers` y `~/.local/share/orion` y `~/ags` son directorios reales; `~/.face` es un symlink a `~/Imágenes/...png`.

- [ ] **Step 2: Confirmar el secreto de Spotify (perms) si existe**

Run:
```bash
ls -l "$HOME/.config/ags/config/spotify-creds.json" 2>&1 || echo "no existe (ok, se ignora igual)"
```
Expected: o bien `-rw------- ... spotify-creds.json` (chmod 600), o "no existe". Cualquiera de los dos es válido; el `.gitignore` lo cubrirá.

- [ ] **Step 3: Confirmar que AGS está corriendo (para validar reload al final)**

Run:
```bash
pgrep -af "ags" | grep -v grep | head
```
Expected: al menos un proceso `ags` / `gjs` del shell. Anotar que está vivo.

---

## Task 1: Crear el esqueleto de GiGiOS

**Files:** Crea `~/GiGiOS/{assets,state,_legacy,bin}`.

- [ ] **Step 1: Crear subdirectorios**

Run:
```bash
mkdir -p "$HOME/GiGiOS"/{assets,state,_legacy,bin}
ls -la "$HOME/GiGiOS"
```
Expected: listado con `assets bin state _legacy` (y `preflight-snapshot.txt` del Task 0).

---

## Task 2: Migrar `ags` (el shell vivo)

**Files:** Mueve `~/.config/ags` → `~/GiGiOS/ags`; crea symlink `~/.config/ags`.

- [ ] **Step 1: Mover + enlazar (encadenado)**

Run:
```bash
mv "$HOME/.config/ags" "$HOME/GiGiOS/ags" && ln -s "$HOME/GiGiOS/ags" "$HOME/.config/ags"
```
Expected: sin salida (éxito).

- [ ] **Step 2: Verificar el symlink y la lectura a través de él**

Run:
```bash
readlink "$HOME/.config/ags"
test -f "$HOME/.config/ags/app.ts" && echo "app.ts legible via symlink OK"
readlink -f "$HOME/.config/ags/config" | grep -q "GiGiOS/ags/config" && echo "config resuelve dentro de GiGiOS OK"
```
Expected:
```
/home/paraguayo33/GiGiOS/ags
app.ts legible via symlink OK
config resuelve dentro de GiGiOS OK
```

- [ ] **Step 3: Eliminar el `.git` vacío/roto heredado**

Run:
```bash
rm -rf "$HOME/GiGiOS/ags/.git"
git -C "$HOME/GiGiOS/ags" rev-parse 2>&1 | grep -q "not a git repository\|no es un repositorio" && echo "sin repo anidado OK"
```
Expected: `sin repo anidado OK`.

---

## Task 3: Migrar `hypr` (incluye hyprlock, scripts, envs, logs)

**Files:** Mueve `~/.config/hypr` → `~/GiGiOS/hypr`; crea symlink `~/.config/hypr`.

- [ ] **Step 1: Mover + enlazar**

Run:
```bash
mv "$HOME/.config/hypr" "$HOME/GiGiOS/hypr" && ln -s "$HOME/GiGiOS/hypr" "$HOME/.config/hypr"
```
Expected: sin salida.

- [ ] **Step 2: Verificar**

Run:
```bash
readlink "$HOME/.config/hypr"
test -f "$HOME/.config/hypr/hyprland.conf" && echo "hyprland.conf OK"
test -f "$HOME/.config/hypr/hyprlock.conf" && echo "hyprlock.conf OK"
test -x "$HOME/.config/hypr/scripts/battery-monitor.sh" && echo "scripts OK"
```
Expected:
```
/home/paraguayo33/GiGiOS/hypr
hyprland.conf OK
hyprlock.conf OK
scripts OK
```

---

## Task 4: Migrar `inicializador`, `power-save`, `jarvis`

**Files:** Mueve los tres dirs bajo `~/.config/` → `~/GiGiOS/`; crea sus symlinks.

- [ ] **Step 1: Mover + enlazar los tres**

Run:
```bash
mv "$HOME/.config/inicializador" "$HOME/GiGiOS/inicializador" && ln -s "$HOME/GiGiOS/inicializador" "$HOME/.config/inicializador"
mv "$HOME/.config/power-save"   "$HOME/GiGiOS/power-save"   && ln -s "$HOME/GiGiOS/power-save"   "$HOME/.config/power-save"
mv "$HOME/.config/jarvis"       "$HOME/GiGiOS/jarvis"       && ln -s "$HOME/GiGiOS/jarvis"       "$HOME/.config/jarvis"
```
Expected: sin salida.

- [ ] **Step 2: Verificar**

Run:
```bash
for d in inicializador power-save jarvis; do
  printf '%s -> %s\n' "$d" "$(readlink "$HOME/.config/$d")"
done
test -x "$HOME/.config/inicializador/init.sh" && echo "init.sh OK"
test -f "$HOME/.config/jarvis/git-repos.json" && echo "git-repos.json OK"
test -f "$HOME/.config/power-save/config.json" && echo "power-save config OK"
```
Expected: cada uno apunta a `/home/paraguayo33/GiGiOS/<d>` y las tres líneas `OK`.

---

## Task 5: Migrar `Wallpapers` → `wallpapers`

**Files:** Mueve `~/Wallpapers` → `~/GiGiOS/wallpapers`; crea symlink `~/Wallpapers`.

- [ ] **Step 1: Mover + enlazar**

Run:
```bash
mv "$HOME/Wallpapers" "$HOME/GiGiOS/wallpapers" && ln -s "$HOME/GiGiOS/wallpapers" "$HOME/Wallpapers"
```
Expected: sin salida.

- [ ] **Step 2: Verificar (wallpaper.sh lee $HOME/Wallpapers)**

Run:
```bash
readlink "$HOME/Wallpapers"
n=$(ls "$HOME/Wallpapers"/*.{jpg,png} 2>/dev/null | wc -l); echo "wallpapers visibles: $n"
```
Expected: `/home/paraguayo33/GiGiOS/wallpapers` y `wallpapers visibles: N` con N ≥ 1.

---

## Task 6: Migrar el estado de orion

**Files:** Mueve `~/.local/share/orion` → `~/GiGiOS/state/orion`; crea symlink `~/.local/share/orion`.

- [ ] **Step 1: Mover + enlazar**

Run:
```bash
mv "$HOME/.local/share/orion" "$HOME/GiGiOS/state/orion" && ln -s "$HOME/GiGiOS/state/orion" "$HOME/.local/share/orion"
```
Expected: sin salida.

- [ ] **Step 2: Verificar**

Run:
```bash
readlink "$HOME/.local/share/orion"
test -f "$HOME/.local/share/orion/favorites.json" && echo "orion favorites OK"
```
Expected: `/home/paraguayo33/GiGiOS/state/orion` y `orion favorites OK`.

---

## Task 7: Foto de perfil → `assets/face.png` y repuntar `~/.face`

**Files:** Crea `~/GiGiOS/assets/face.png` (copia real); reemplaza el symlink `~/.face`.

- [ ] **Step 1: Copiar la imagen real (resolviendo el symlink actual) a assets**

Run:
```bash
cp -L "$HOME/.face" "$HOME/GiGiOS/assets/face.png"
ls -l "$HOME/GiGiOS/assets/face.png"
```
Expected: un `-rw-r--r-- ... face.png` de ~198 KB (archivo real, no symlink).

- [ ] **Step 2: Repuntar `~/.face` al asset de GiGiOS**

Run:
```bash
ln -sfn "$HOME/GiGiOS/assets/face.png" "$HOME/.face"
readlink "$HOME/.face"
test -f "$HOME/.face" && echo ".face legible OK"
```
Expected:
```
/home/paraguayo33/GiGiOS/assets/face.png
.face legible OK
```

---

## Task 8: Archivar la copia muerta `~/ags`

**Files:** Mueve `~/ags` → `~/GiGiOS/_legacy/ags-old`.

- [ ] **Step 1: Archivar (no borrar)**

Run:
```bash
mv "$HOME/ags" "$HOME/GiGiOS/_legacy/ags-old"
test -f "$HOME/GiGiOS/_legacy/ags-old/app.ts" && echo "legacy archivado OK"
test ! -e "$HOME/ags" && echo "~/ags ya no existe en su sitio OK"
```
Expected: `legacy archivado OK` y `~/ags ya no existe en su sitio OK`.

---

## Task 9: Escribir `link.sh`, `.gitignore` y `README.md`

**Files:** Crea `~/GiGiOS/bin/link.sh`, `~/GiGiOS/.gitignore`, `~/GiGiOS/README.md`.

- [ ] **Step 1: Escribir `bin/link.sh`**

Crear `~/GiGiOS/bin/link.sh` con este contenido exacto:
```bash
#!/usr/bin/env bash
# GiGiOS — instalador/mantenedor de symlinks.
# Enlaza las rutas canónicas XDG a los archivos reales dentro de ~/GiGiOS.
# Idempotente. No mueve ni borra datos de usuario: solo gestiona symlinks.
# Uso: bin/link.sh          (crea/repara symlinks)
#      bin/link.sh --check   (solo reporta estado, no modifica)
set -euo pipefail

GIGIOS="${GIGIOS:-$HOME/GiGiOS}"

# "ruta_relativa_en_GiGiOS::ruta_canonica_absoluta"
LINKS=(
  "ags::$HOME/.config/ags"
  "hypr::$HOME/.config/hypr"
  "inicializador::$HOME/.config/inicializador"
  "power-save::$HOME/.config/power-save"
  "jarvis::$HOME/.config/jarvis"
  "state/orion::$HOME/.local/share/orion"
  "wallpapers::$HOME/Wallpapers"
  "assets/face.png::$HOME/.face"
)

check_only=false
[[ "${1:-}" == "--check" ]] && check_only=true

status=0
for entry in "${LINKS[@]}"; do
  src="$GIGIOS/${entry%%::*}"
  dst="${entry##*::}"

  if [[ ! -e "$src" ]]; then
    echo "FALTA origen: $src (esperado para $dst)"; status=1; continue
  fi

  if [[ -L "$dst" && "$(readlink -f "$dst")" == "$(readlink -f "$src")" ]]; then
    echo "OK    $dst -> $src"; continue
  fi

  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "AVISO $dst es dir/archivo real (no symlink). Migralo a $src primero; no lo toco."
    status=1; continue
  fi

  if $check_only; then
    echo "FALTA symlink: $dst -> $src"; status=1; continue
  fi

  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
  echo "LINK  $dst -> $src"
done

exit $status
```

Run (crear ejecutable y comprobar sintaxis):
```bash
chmod +x "$HOME/GiGiOS/bin/link.sh"
bash -n "$HOME/GiGiOS/bin/link.sh" && echo "sintaxis link.sh OK"
```
Expected: `sintaxis link.sh OK`.

- [ ] **Step 2: Verificar link.sh contra el estado ya migrado**

Run:
```bash
"$HOME/GiGiOS/bin/link.sh" --check
```
Expected: ocho líneas `OK    <dst> -> <src>`, una por cada entrada, y exit 0.

- [ ] **Step 3: Escribir `.gitignore`**

Crear `~/GiGiOS/.gitignore` con este contenido exacto:
```gitignore
# Secretos — jamás commitear
ags/config/spotify-creds.json

# Logs de runtime
hypr/logs/

# Sesiones volátiles de orion
state/orion/profiles/

# Snapshots de migración
preflight-snapshot.txt

# Metadatos de escritorio
**/.directory
```

- [ ] **Step 4: Escribir `README.md`**

Crear `~/GiGiOS/README.md` con este contenido exacto:
```markdown
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
- `jarvis/`         — repos del launcher  (symlink: `~/.config/jarvis`)
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
```

Run (verificar que existen):
```bash
ls -l "$HOME/GiGiOS/.gitignore" "$HOME/GiGiOS/README.md" && echo "docs OK"
```
Expected: ambos archivos listados y `docs OK`.

---

## Task 10: Inicializar el repo git de GiGiOS

**Files:** Crea `~/GiGiOS/.git` (repo nuevo) + primer commit.

- [ ] **Step 1: git init + primer commit**

Run:
```bash
git -C "$HOME/GiGiOS" init -q
git -C "$HOME/GiGiOS" add -A
git -C "$HOME/GiGiOS" commit -q -m "chore: consolidar sistema en GiGiOS (ags, hypr, assets, wallpapers) vía symlinks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
echo "commit OK"
```
Expected: `commit OK`.

- [ ] **Step 2: Verificar que el secreto NO quedó trackeado**

Run:
```bash
git -C "$HOME/GiGiOS" ls-files | grep -q "spotify-creds.json" && echo "PELIGRO: secreto trackeado" || echo "secreto fuera de git OK"
git -C "$HOME/GiGiOS" ls-files | grep -q "hypr/logs/" && echo "PELIGRO: logs trackeados" || echo "logs fuera de git OK"
```
Expected:
```
secreto fuera de git OK
logs fuera de git OK
```

---

## Task 11: Validación en vivo

**Files:** ninguno (solo validación de runtime).

- [ ] **Step 1: Barrido de symlinks (todos apuntan dentro de GiGiOS)**

Run:
```bash
"$HOME/GiGiOS/bin/link.sh" --check
```
Expected: ocho `OK` y exit 0.

- [ ] **Step 2: Recargar AGS y confirmar que sigue vivo**

Run:
```bash
ags quit 2>/dev/null; sleep 0.5; (ags run "$HOME/.config/ags/" >/dev/null 2>&1 &) ; sleep 3
pgrep -af "ags" | grep -v grep | head && echo "AGS recargado OK"
```
Expected: proceso AGS presente y `AGS recargado OK`. La barra y paneles deben verse igual que antes.

- [ ] **Step 3: Recargar Hyprland**

Run:
```bash
hyprctl reload && echo "hyprctl reload OK"
```
Expected: `ok` de hyprctl y `hyprctl reload OK`. Sin errores de `source` en el log.

- [ ] **Step 4: Verificar hyprlock apunta a la foto (sin lanzar el lock)**

Run:
```bash
test -f "$HOME/.face" && echo ".face resuelve OK ($(readlink "$HOME/.face"))"
```
Expected: `.face resuelve OK (/home/paraguayo33/GiGiOS/assets/face.png)`.
Nota: probar el lockscreen real (`hyprlock`) es opcional y manual; el fondo/foreground de hyprlock ya estaban rotos antes (referencias inexistentes) y se preservan igual.

- [ ] **Step 5: Confirmación final**

Run:
```bash
echo "=== GiGiOS final ==="; ls -la "$HOME/GiGiOS"
echo "=== symlinks canónicos ==="
for p in "$HOME/.config/ags" "$HOME/.config/hypr" "$HOME/.config/inicializador" \
         "$HOME/.config/power-save" "$HOME/.config/jarvis" "$HOME/Wallpapers" \
         "$HOME/.local/share/orion" "$HOME/.face"; do
  printf '%s -> %s\n' "$p" "$(readlink "$p")"
done
```
Expected: `~/GiGiOS` con todas las carpetas y cada ruta canónica apuntando dentro de `~/GiGiOS`.

---

## Rollback

Si algo falla, revertir es mover cada carpeta de vuelta y borrar el symlink. Ejemplo para `ags`:
```bash
rm "$HOME/.config/ags" && mv "$HOME/GiGiOS/ags" "$HOME/.config/ags"
```
Repetir para cada entrada del mapa. `~/GiGiOS/preflight-snapshot.txt` tiene el estado original. `~/ags` se recupera desde `~/GiGiOS/_legacy/ags-old`.

## Self-Review (cobertura del spec)

- Symlink-farm a nivel de directorio → Tasks 2–6, 9.
- Foto de perfil como copia en assets + `.face` repuntado → Task 7.
- Wallpapers dentro → Task 5.
- `~/.local/share/jarvis` fuera de alcance → no aparece en ningún task (correcto).
- `~/ags` archivado, no borrado → Task 8.
- Git nuevo, secreto y logs fuera → Task 10.
- Problemas previos (hyprlock pngs, watchdog.sh) preservados, no arreglados → nota en Task 11 Step 4.
- Validación en vivo (AGS reload, hyprctl reload) → Task 11.
