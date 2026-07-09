# Desarrollo

Notas para quien (tú, en otra máquina) toque el repo, no configuración de ningún
subsistema en concreto — eso vive en `GiGiOS/README.md` y `GiGiOS/hypr/SETUP.md`.

## Verificación de archivos antes de cada `git push`

El repo trae un hook de `pre-push` que corre automáticamente en cada push y aborta
si encuentra algo que no debería estar versionado.

- **`bin/verify-files.sh`** — revisa el tipo *real* de cada archivo trackeado por
  sus magic bytes (`file -b`), no por la extensión. Esto es a propósito: el
  `.gitignore` (sección "Seguridad" al principio) filtra por nombre/extensión, que
  es trivial de esquivar con solo renombrar un ejecutable a `.txt` o `.pdf`. El
  script atrapa eso comprobando el contenido real: ELF, PE32 (`.exe`), Mach-O,
  Java archive, Microsoft Cabinet, Composite Document File (OLE, el formato de los
  `.doc`/`.xls` viejos con macros).
- Si tienes **ClamAV** instalado (`clamscan` en el PATH), el script también pasa
  todos los archivos por un escaneo de firmas de verdad. Si no lo tienes, solo
  avisa y sigue — no bloquea el push por su ausencia.
- **`.githooks/pre-push`** es el hook en sí; solo invoca `bin/verify-files.sh` sin
  argumentos (revisa todo `git ls-files`, no solo el diff del push).

### Cómo se activa (y por qué no hace falta instalarlo a mano)

Los hooks en `.git/hooks/` no viajan con el repo — por eso están versionados en
`.githooks/` y se activan apuntando `core.hooksPath` ahí. Ese `git config` es local
de cada clon, así que `GiGiOS/bin/link.sh` lo reaplica cada vez que lo corres
(ya es el paso estándar para preparar cualquier máquina nueva, ver
`GiGiOS/hypr/SETUP.md` §11) — no es un paso manual aparte.

Si alguna vez hace falta a mano:

```sh
git config core.hooksPath .githooks
```

### Instalar ClamAV (opcional, para el escaneo de firmas)

```sh
sudo pacman -S clamav
sudo freshclam   # descarga las firmas la primera vez; actualízalas de vez en cuando
```

### Uso manual

```sh
bin/verify-files.sh              # revisa todos los archivos trackeados
bin/verify-files.sh archivo.ext  # revisa solo esos archivos
```

### Si el hook bloquea algo que sí quieres versionar

Confirma primero que el archivo es legítimo (no basta con "yo lo puse", si venía de
una descarga o de otra persona, revísalo de verdad). Si es legítimo:

```sh
git add -f archivo.ext
```

`verify-files.sh` seguirá marcándolo en el próximo push porque solo mira el
contenido, no si ya está en el índice — es un aviso repetido a propósito, no un
bug.

En una emergencia real (el hook falla por algo que no es el archivo, p.ej. no hay
`file` instalado) se puede saltar con `git push --no-verify`, pero eso también
salta la verificación de archivos, así que úsalo solo sabiendo qué estás
saltando.
