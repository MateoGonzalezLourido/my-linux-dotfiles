#!/usr/bin/env bash
# scan-file.sh <ruta> — analiza un archivo (o carpeta) con ClamAV a demanda y
# notifica el resultado. Complementa al escáner de descargas: los archivos que
# superan el tope de auto-análisis (o cualquier cosa que quieras comprobar a
# mano) se escanean aquí, sin el tope de auto-análisis (clamscan sí tiene un
# máximo físico de ~2 GiB por fichero). clamscan entra además dentro de archivos
# comprimidos (.rar/.zip/…), así que sirve para revisar un instalador antes de
# extraerlo.
#
# Uso: scan-file.sh /ruta/al/archivo
#   - lo invoca el botón "🔍 Escanear" del aviso de archivo grande, y
#   - el campo de ruta de Ajustes › Seguridad.

set -u

APP="Análisis ClamAV"
notify() { notify-send -a "$APP" "$@"; }

f="${1:-}"
f="$(realpath -- "$f" 2>/dev/null || echo "$f")"
name="$(basename -- "$f")"
[[ -n "$f" && -e "$f" ]] || { notify -u critical "🔍 $APP" "No existe: $f" -t 8000; exit 1; }

# Motor: preferimos clamscan (standalone, funciona con solo tener las firmas).
# clamdscan necesita el daemon clamd; si el binario está pero el daemon no corre,
# devolvería error, así que va como último recurso.
# --max-filesize/--max-scansize al máximo que clamscan admite (2 GiB-1): sin esto
# saltaría (asumiéndolos limpios) los ficheros > 100 MB (MaxFileSize por defecto).
clam=()
if command -v clamscan >/dev/null 2>&1; then
    clam=(clamscan --no-summary -r --max-filesize=2147483647 --max-scansize=2147483647)
elif command -v clamdscan >/dev/null 2>&1; then
    clam=(clamdscan --fdpass --no-summary --multiscan)
else
    notify -u critical "🔍 $APP" \
        "ClamAV no instalado (sudo pacman -S clamav && sudo freshclam)." -t 0
    exit 3
fi

# Prioridad baja: el análisis cede CPU/IO ante el resto del sistema.
lowprio=()
command -v nice   >/dev/null 2>&1 && lowprio+=(nice -n 19)
command -v ionice >/dev/null 2>&1 && lowprio+=(ionice -c 3)

notify -u low "🔍 Analizando…" "$name — puede tardar en archivos grandes." -t 6000

out=$("${lowprio[@]}" "${clam[@]}" "$f" 2>/dev/null); rc=$?

if grep -q "FOUND" <<< "$out"; then
    hits=$(grep -c "FOUND" <<< "$out")
    first=$(grep "FOUND" <<< "$out" | head -1)
    notify -u critical "🦠 Malware detectado ($hits)" \
        "$name → ${first##*: } — NO lo ejecutes." -t 0
elif (( rc >= 2 )); then
    # rc=0 limpio · rc=1 virus (ya cazado) · rc≥2 no se pudo analizar
    notify -u warning "🔍 $APP" \
        "No se pudo analizar $name (¿sin base de firmas? Ejecuta 'sudo freshclam')." -t 10000
else
    notify -u normal "✓ Limpio" "$name: ClamAV no detectó amenazas." -t 8000
fi
