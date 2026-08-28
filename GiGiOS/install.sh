#!/usr/bin/env bash
# Instalador de dotfiles (repo bare) + GiGiOS para Arch Linux/CachyOS.
# Clona el repo, hace checkout en $HOME (respaldando lo que choque) y crea los
# symlinks de GiGiOS. Pensado para una máquina nueva o recuperación.
#
# Uso:
#   curl -sSL https://raw.githubusercontent.com/mglourido/my-linux-dotfiles/main/GiGiOS/install.sh | bash
#   bash install.sh --help                            # todas las opciones
#   curl -sSL <url> | DOTFILES_BRANCH=<rama> bash      # otra rama del repo (no per-equipo: eso va por *_PROFILE)
#   curl -sSL <url> | INSTALL_PACKAGES=0 bash         # sin instalar paquetes
#   curl -sSL <url> | KITTY_PROFILE=desktop bash      # forzar perfil de Kitty
#   curl -sSL <url> | FIREFOX_PROFILE=desktop bash    # forzar perfil de Firefox
#
# Opciones equivalentes cuando se ejecuta el fichero (no por pipe):
#   --branch <rama>      --repo <url>       --no-packages
#   --kitty <perfil>     --firefox <perfil> --cursor <tema>
#   --yes                sin preguntas (pacman --noconfirm); para reinstalar sin vigilarlo
#
# ELEGIR QUÉ PASOS SE EJECUTAN (se pueden combinar todos los que quieras):
#   --sin  a,b,c   ejecuta todo MENOS esos pasos
#   --solo a,b,c   ejecuta SOLO esos pasos
#   --pasos        lista los nombres disponibles y sale
#
# Ambas admiten lista separada por comas y se pueden repetir:
#   bash install.sh --solo paquetes                  # solo dependencias, no toca nada más
#   bash install.sh --sin clamav-db                  # todo, pero sin bajar las firmas
#   bash install.sh --sin dolphin,kitty,firefox      # varios de una vez
#   bash install.sh --sin cursor --sin shell         # repetible, equivale a la lista
#
# Alias que se conservan por compatibilidad con lo que ya escribías:
#   --no-packages = --sin paquetes      --solo-paquetes  = --solo paquetes
#   --skip-clamav-db = --sin clamav-db
#
# Variables:
#   DOTFILES_REPO    URL del repo   (por defecto HTTPS público)
#   DOTFILES_BRANCH  rama a instalar (por defecto: main)
#   INSTALL_PACKAGES 1 instala las dependencias (por defecto); 0 las omite
#   KITTY_PROFILE    auto, laptop o desktop (por defecto: auto)
#   FIREFOX_PROFILE  auto, laptop o desktop (por defecto: auto)
#   CURSOR_THEME     tema de puntero al que añadir la mitad hyprcursor
#   ASSUME_YES       1 equivale a --yes
#   SKIP_CLAMAV_DB   1 equivale a --skip-clamav-db
#   ONLY_PACKAGES    1 equivale a --solo-paquetes
#   INSTALL_STEPS    lista para --solo   (ej. INSTALL_STEPS=paquetes,css)
#   SKIP_STEPS       lista para --sin    (ej. SKIP_STEPS=clamav-db,cursor)
#
# VELOCIDAD: todas las dependencias van en UNA sola transacción (repos + AUR juntos si hay
# paru o yay), y las dos descargas largas que no bloquean a nadie —el índice de pkgfile y los
# ~200 MB de firmas de ClamAV— se lanzan en segundo plano y se recogen al final. Para una
# reinstalación desatendida, --yes: quita la confirmación de pacman y las preguntas de
# revisión de PKGBUILD del ayudante de AUR.
#
# REEJECUTARLO ES SEGURO Y ES EL MODO NORMAL DE ACTUALIZAR. Todos los pasos son
# idempotentes: lo ya instalado se detecta y se omite, y lo que no se puede completar
# degrada con aviso en vez de abortar. Solo son fatales los fallos que dejarían el
# escritorio sin arrancar (checkout, symlinks, CSS de AGS); el resto se acumula y se
# resume al final, para que una dependencia caída no te deje media instalación sin saber
# qué falta.
set -euo pipefail

REPO_URL="${DOTFILES_REPO:-https://github.com/mglourido/my-linux-dotfiles.git}"
BRANCH="${DOTFILES_BRANCH:-main}"
DOTGIT="$HOME/.dotfiles"
BACKUP="$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)"
INSTALL_PACKAGES="${INSTALL_PACKAGES:-1}"
KITTY_PROFILE="${KITTY_PROFILE:-auto}"
FIREFOX_PROFILE="${FIREFOX_PROFILE:-auto}"
CURSOR_THEME="${CURSOR_THEME:-Bibata-Modern-Ice}"
ASSUME_YES="${ASSUME_YES:-0}"
SKIP_CLAMAV_DB="${SKIP_CLAMAV_DB:-0}"
ONLY_PACKAGES="${ONLY_PACKAGES:-0}"

# Catálogo de pasos seleccionables. El orden es el de ejecución, que es también el orden
# en que los lista `--pasos`. Añadir un paso nuevo es añadirlo aquí y envolver su bloque
# en `if paso_activo <nombre>`; no hay que tocar el parseo de opciones.
declare -A DESC_PASO=(
  [paquetes]="TODAS las dependencias (repos + AUR) en una sola tanda + servicios de red, BT y energía"
  [repo]="clonar/actualizar ~/.dotfiles y hacer el checkout en \$HOME"
  [symlinks]="enlazar las rutas XDG a ~/GiGiOS (bin/link.sh)"
  [dolphin]="perfil ligero de Dolphin (miniaturas y comportamiento)"
  [kitty]="perfil de rendimiento de Kitty"
  [firefox]="perfil de rendimiento de Firefox"
  [css]="compilar ags/estilos/out.css con sass"
  [mime]="bases MIME y caché de aplicaciones de KDE"
  [sistema]="ficheros de /etc: udev USB, i2c-dev, botón de encendido, helpers TLP/ClamAV/limpieza"
  [gpu]="elegir el perfil de GPU de esta máquina (~/.config/gigios/gpu-perfil)"
  [clamav-db]="descarga de la base de firmas de ClamAV (~200 MB)"
  [cursor]="generar la mitad hyprcursor del tema de puntero"
  [shell]="poner Zsh como shell predeterminado"
  [preflight]="validación final de la instalación"
)
ORDEN_PASOS=(paquetes repo symlinks sistema clamav-db dolphin kitty firefox css mime gpu cursor shell preflight)

SOLO_PASOS=()
SIN_PASOS=()

listar_pasos() {
  printf 'Pasos que admiten --sin y --solo:\n\n'
  local paso
  for paso in "${ORDEN_PASOS[@]}"; do
    printf '  %-11s %s\n' "$paso" "${DESC_PASO[$paso]}"
  done
  printf '\nEjemplo: bash install.sh --sin clamav-db,cursor\n'
}

# Acepta "a,b,c" y también "a b c", y es acumulativa: --sin a --sin b == --sin a,b.
# Un nombre mal escrito es un error inmediato y no un paso que se salta en silencio: que
# `--sin walpapers` (con una ele) se ejecutara igual descargando los fondos sería
# exactamente el tipo de fallo mudo que no se quiere.
anadir_pasos() {
  local -n destino="$1"; shift
  local bruto="$1" paso
  for paso in ${bruto//,/ }; do
    [[ -n "${DESC_PASO[$paso]:-}" ]] \
      || die "Paso desconocido: '$paso'. Usá --pasos para ver la lista."
    destino+=("$paso")
  done
}

en_lista() {
  local aguja="$1"; shift
  local elemento
  for elemento in "$@"; do [[ "$elemento" == "$aguja" ]] && return 0; done
  return 1
}

# La regla: si hay --solo, manda --solo (y --sin puede recortarlo todavía más). Si no,
# se ejecuta todo salvo lo que diga --sin.
paso_activo() {
  local paso="$1"
  ((${#SIN_PASOS[@]})) && en_lista "$paso" "${SIN_PASOS[@]}" && return 1
  ((${#SOLO_PASOS[@]})) || return 0
  en_lista "$paso" "${SOLO_PASOS[@]}"
}

dotfiles() { git --git-dir="$DOTGIT" --work-tree="$HOME" "$@"; }
info() { printf '\033[1;36m::\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Todo aviso queda anotado, no solo impreso. En una instalación larga los avisos se
# pierden entre cientos de líneas de pacman, y el resultado es la peor variante posible:
# una instalación incompleta que parece correcta porque terminó con "completa". El
# resumen final los repite juntos y decide el código de salida.
DEGRADED=()
warn() {
  printf '\033[1;33m!!\033[0m %s\n' "$*"
  DEGRADED+=("$*")
}

# La ayuda es la cabecera del propio fichero, para que no pueda quedar desincronizada con
# lo que el script hace. Se corta en la primera línea que no sea comentario en vez de en
# un número de línea fijo: así añadir un párrafo arriba no parte la ayuda por la mitad.
usage() {
  local fuente="${BASH_SOURCE[0]:-}"
  if [[ -r "$fuente" ]]; then
    awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$fuente"
  else
    # Ejecutado por `curl | bash` no hay fichero que leer.
    printf 'install.sh — instalador de GiGiOS.\n'
    printf 'Opciones: --branch --repo --kitty --firefox --cursor --no-packages --yes --skip-clamav-db\n'
    printf 'Descargá el fichero y ejecutá "bash install.sh --help" para la ayuda completa.\n'
  fi
}

while (($#)); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --branch)  BRANCH="${2:?--branch necesita una rama}"; shift 2 ;;
    --repo)    REPO_URL="${2:?--repo necesita una URL}"; shift 2 ;;
    --kitty)   KITTY_PROFILE="${2:?--kitty necesita un perfil}"; shift 2 ;;
    --firefox) FIREFOX_PROFILE="${2:?--firefox necesita un perfil}"; shift 2 ;;
    --cursor)  CURSOR_THEME="${2:?--cursor necesita un tema}"; shift 2 ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    --pasos|--steps) listar_pasos; exit 0 ;;
    --sin|--skip)  anadir_pasos SIN_PASOS "${2:?--sin necesita al menos un paso}"; shift 2 ;;
    --solo|--only) anadir_pasos SOLO_PASOS "${2:?--solo necesita al menos un paso}"; shift 2 ;;
    # Alias heredados. Se traducen al mecanismo nuevo en vez de mantener su propia
    # variable: así no hay dos fuentes de verdad sobre si un paso corre o no.
    --no-packages)    anadir_pasos SIN_PASOS paquetes; shift ;;
    --skip-clamav-db) anadir_pasos SIN_PASOS clamav-db; shift ;;
    --solo-paquetes|--only-packages) anadir_pasos SOLO_PASOS paquetes; shift ;;
    *) die "Opción desconocida: '$1'. Usa --help para ver las disponibles." ;;
  esac
done

# `curl | bash` no tiene stdin utilizable, así que cualquier orden interactiva (pacman
# preguntando por un proveedor, chsh pidiendo la contraseña) lee del pipe y se come el
# resto del script. Con --yes no hace falta terminal: nada pregunta.
INTERACTIVE=0
[[ -r /dev/tty ]] && INTERACTIVE=1

run_interactive() {
  if ((INTERACTIVE)); then
    "$@" </dev/tty
  else
    ((ASSUME_YES)) \
      || die "Esta operación necesita una terminal interactiva. Descarga install.sh y ejecútalo con bash, o pásale --yes."
    "$@" </dev/null
  fi
}

case "$INSTALL_PACKAGES" in
  0|1) ;;
  *) die "INSTALL_PACKAGES debe valer 0 (omitir paquetes) o 1 (instalarlos); recibido: '$INSTALL_PACKAGES'." ;;
esac
case "$ASSUME_YES" in 0|1) ;; *) die "ASSUME_YES debe valer 0 o 1; recibido: '$ASSUME_YES'." ;; esac
case "$SKIP_CLAMAV_DB" in 0|1) ;; *) die "SKIP_CLAMAV_DB debe valer 0 o 1; recibido: '$SKIP_CLAMAV_DB'." ;; esac
case "$ONLY_PACKAGES" in 0|1) ;; *) die "ONLY_PACKAGES debe valer 0 o 1; recibido: '$ONLY_PACKAGES'." ;; esac

# Las variables de entorno se traducen al selector, igual que los alias de línea de
# órdenes, para que exista una sola fuente de verdad sobre qué pasos corren.
((ONLY_PACKAGES)) && anadir_pasos SOLO_PASOS paquetes
((INSTALL_PACKAGES)) || anadir_pasos SIN_PASOS paquetes
((SKIP_CLAMAV_DB)) && anadir_pasos SIN_PASOS clamav-db
[[ -n "${INSTALL_STEPS:-}" ]] && anadir_pasos SOLO_PASOS "$INSTALL_STEPS"
[[ -n "${SKIP_STEPS:-}" ]] && anadir_pasos SIN_PASOS "$SKIP_STEPS"

# Un --solo cuyos pasos estén todos también en --sin no ejecutaría NADA y terminaría
# diciendo "instalación completa". Mejor decirlo antes de empezar.
if ((${#SOLO_PASOS[@]})); then
  hay_activo=0
  for paso_probe in "${ORDEN_PASOS[@]}"; do
    paso_activo "$paso_probe" && { hay_activo=1; break; }
  done
  ((hay_activo)) || die "La combinación de --solo y --sin no deja ningún paso por ejecutar."
fi
case "$KITTY_PROFILE" in
  auto|laptop|desktop) ;;
  *) die "KITTY_PROFILE debe ser auto, laptop o desktop; recibido: '$KITTY_PROFILE'." ;;
esac
case "$FIREFOX_PROFILE" in
  auto|laptop|desktop) ;;
  *) die "FIREFOX_PROFILE debe ser auto, laptop o desktop; recibido: '$FIREFOX_PROFILE'." ;;
esac
(( EUID != 0 )) || die "No ejecutes este instalador como root; usa tu usuario normal (sudo se pedirá cuando haga falta)."

# Una batería del sistema es lo que distingue un portátil, igual que en
# bin/kitty-profile.sh: los periféricos (ratones, mandos) también publican type=Battery,
# pero con scope=Device. Aquí decide si se instala TLP.
tiene_bateria() {
  local type_file type supply scope
  for type_file in /sys/class/power_supply/*/type; do
    [[ -r "$type_file" ]] || continue
    IFS= read -r type < "$type_file" || continue
    [[ "$type" == Battery ]] || continue
    supply="${type_file%/type}"
    if [[ -r "$supply/scope" ]]; then
      IFS= read -r scope < "$supply/scope" || continue
      [[ "$scope" == Device ]] && continue
    fi
    return 0
  done
  return 1
}

# Un sudo que caduca a mitad de una instalación de veinte minutos abre un prompt de
# contraseña en medio del scroll de pacman, y con `curl | bash` ni siquiera puede leerse.
# Se pide una vez al principio y se renueva en segundo plano mientras dura el instalador.
SUDO_KEEPALIVE_PID=""
sudo_prime() {
  command -v sudo >/dev/null || return 0
  sudo -n true 2>/dev/null && return 0
  info "Se necesitan permisos de administrador para instalar paquetes y ficheros de /etc."
  run_interactive sudo -v || die "No pude obtener permisos de sudo."
  while true; do sudo -n true 2>/dev/null || break; sleep 50; done &
  SUDO_KEEPALIVE_PID=$!
}
limpiar_keepalive() {
  [[ -n "$SUDO_KEEPALIVE_PID" ]] && kill "$SUDO_KEEPALIVE_PID" 2>/dev/null
  return 0
}
trap limpiar_keepalive EXIT

# Descargas largas que NO bloquean a nadie: se lanzan en segundo plano en cuanto es
# posible y se recogen al final, justo antes de validar.
#
# Las dos son puro tráfico de red y ningún paso intermedio depende de ellas:
#   - pkgfile      lista de ficheros de los repos; sólo la usa `command-not-found`.
#   - firmas ClamAV ~200 MB; sólo las usa el escáner de descargas, ya en sesión.
# Antes se hacían en serie en mitad del instalador y su tiempo se SUMABA al de todo lo
# demás. Ahora se solapan con la instalación de paquetes, el checkout, los symlinks, los
# perfiles, el CSS y las bases MIME.
PKGFILE_PID=""
CLAMAV_PID=""
esperar_descargas_de_fondo() {
  if [[ -n "$PKGFILE_PID" ]]; then
    wait "$PKGFILE_PID" \
      || warn "No pude actualizar pkgfile; command-not-found funcionará tras ejecutar 'sudo pkgfile --update'."
    PKGFILE_PID=""
  fi
  if [[ -n "$CLAMAV_PID" ]]; then
    info "Esperando a que terminen de bajar las firmas de ClamAV ..."
    wait "$CLAMAV_PID" \
      || warn "No pude descargar las firmas de ClamAV; se reintentará solo al iniciar sesión."
    CLAMAV_PID=""
  fi
}

# Resumen de todo lo que quedó a medias. Sin esto, los avisos se pierden entre el scroll
# de pacman y una instalación degradada es indistinguible de una correcta: termina igual,
# con "Instalación base completa". Aquí se repiten juntos y al final del todo, que es lo
# único que se lee de verdad. Lo llaman los dos finales posibles: el completo y el de
# --solo-paquetes.
resumen_degradado() {
  if ((${#PAQUETES_FALLIDOS[@]})); then
    echo
    printf '\033[1;33mPaquetes que no se pudieron instalar (%d):\033[0m\n' "${#PAQUETES_FALLIDOS[@]}"
    printf '  - %s\n' "${PAQUETES_FALLIDOS[@]}"
    printf '  Reintento: sudo pacman -S --needed %s\n' "${PAQUETES_FALLIDOS[*]}"
  fi
  if ((${#DEGRADED[@]})); then
    echo
    printf '\033[1;33mAvisos (%d) — la instalación terminó, pero esto quedó sin hacer:\033[0m\n' "${#DEGRADED[@]}"
    printf '  !! %s\n' "${DEGRADED[@]}"
  fi
}

# Instala una regla sudoers a partir de su plantilla versionada.
#
# VIVE AQUÍ, EN EL NIVEL SUPERIOR, y no dentro del bloque del paso `mime` como estaba:
# quien la llama es el paso `sistema` (TLP, ClamAV, limpieza), así que con `--sin mime`
# —o con cualquier `--solo` que no incluyera `mime`— la función NO llegaba a definirse y
# la primera llamada salía con 127 «orden no encontrada», que con `set -e` ABORTA el
# instalador entero. Una función no es un paso; no puede colgar de que un paso corra. Tres bloques hacían
# esto mismo copiado y pegado (TLP, ClamAV, limpieza), cada uno con su `mktemp` sin
# comprobar: si /tmp estaba lleno o era de solo lectura, `mktemp` fallaba, `sed` escribía
# en una ruta vacía y `visudo -cf ""` validaba cualquier cosa. Aquí se comprueba una vez.
#
# El orden importa y es el mismo de antes: se materializa el usuario real en un temporal,
# se VALIDA con visudo y solo entonces se instala. Una regla sudoers malformada en
# /etc/sudoers.d rompe sudo en toda la máquina, así que nunca se escribe sin validar.
instalar_sudoers() {
  local plantilla="$1" destino="$2" aviso="$3" tmp
  [[ -r "$plantilla" ]] || { warn "Falta la plantilla sudoers $plantilla; $aviso"; return 1; }
  tmp="$(mktemp)" || { warn "No pude crear un fichero temporal para $destino; $aviso"; return 1; }
  if ! sed "s/__GIGIOS_USER__/$(id -un)/" "$plantilla" > "$tmp"; then
    rm -f "$tmp"
    warn "No pude preparar la regla sudoers $destino; $aviso"
    return 1
  fi
  if sudo visudo -cf "$tmp" >/dev/null; then
    sudo install -Dm440 "$tmp" "$destino" \
      || warn "No pude instalar $destino; $aviso"
  else
    warn "La regla sudoers de $destino no validó; no la instalo. $aviso"
  fi
  rm -f "$tmp"
}

# Instala paquetes SIN que uno malo se lleve por delante al resto.
#
# Antes era un único `pacman -S --needed "${official[@]}"` con `set -e` detrás: si un
# solo nombre de la lista había desaparecido de los repos, cambiado de nombre o tenía un
# conflicto, pacman salía != 0, el instalador moría ahí mismo y no llegaba a hacer NI LOS
# SYMLINKS. Un paquete renombrado río arriba dejaba el escritorio sin instalar.
#
# Ahora: (1) se descartan los nombres que los repos configurados no ofrecen — eso solo es
# un aviso, no un fallo; (2) se intenta la instalación en lote, que es lo rápido y lo que
# resuelve bien las dependencias; (3) si el lote falla, se reintenta paquete a paquete
# para aislar al culpable, y se sigue con todos los demás. Lo que no entre se anota y sale
# en el resumen final.
# El ayudante de AUR, detectado UNA vez. Si existe, es también quien instala los
# paquetes de repo: `paru`/`yay` resuelven repos y AUR en la MISMA transacción, así que
# no hay que decidir por adelantado de dónde sale cada nombre ni encadenar dos
# instalaciones con dos confirmaciones.
AYUDANTE_AUR=""
if command -v paru >/dev/null 2>&1; then AYUDANTE_AUR=paru
elif command -v yay >/dev/null 2>&1; then AYUDANTE_AUR=yay
fi

PAQUETES_FALLIDOS=()

# UNA transacción para todo: repos oficiales + AUR.
#
# Antes eran dos pasadas: `sudo pacman -S` con la lista oficial y, después,
# `paru/yay -S aylurs-gtk-shell-git libastal-meta` aparte. Eso costaba dos
# confirmaciones, dos resoluciones de dependencias y —lo caro de verdad— una
# COMPILACIÓN desde AUR de `libastal-meta` (una quincena de bibliotecas Vala/C) que en
# muchas máquinas NO HACÍA FALTA: con `chaotic-aur` configurado, `aylurs-gtk-shell-git`
# y `libastal-meta` existen ya como BINARIO. Al mezclarlo todo en una lista, el ayudante
# coge la versión de repo cuando la hay y sólo compila lo que de verdad es AUR-only.
#
# Sin ayudante instalado se cae a `sudo pacman` con lo que haya en los repos y se avisa
# de lo que quede fuera: es exactamente el comportamiento anterior, no una regresión.
paquetes_instalar() {
  local -a deseados=("$@") disponibles=() ausentes=() fallidos=()
  local paquete
  local -a gestor flags=(-S --needed)
  if [[ -n "$AYUDANTE_AUR" ]]; then
    gestor=("$AYUDANTE_AUR")
    # Sin esto, un paquete AUR abre tres preguntas por PKGBUILD (ver diff, editar,
    # limpiar) que en `curl | bash` no puede contestar nadie. Solo con --yes: por
    # defecto se respeta que el usuario quiera revisar lo que se compila.
    if ((ASSUME_YES)); then
      flags+=(--noconfirm)
      case "$AYUDANTE_AUR" in
        paru) flags+=(--skipreview) ;;
        yay)  flags+=(--answerdiff=None --answeredit=None --answerclean=None --removemake) ;;
      esac
    fi
  else
    gestor=(sudo pacman)
    ((ASSUME_YES)) && flags+=(--noconfirm)
  fi

  # DOS llamadas a pacman, no dos por paquete. Con ~150 paquetes el bucle de
  # `pacman -Si` + `pacman -Qq` uno a uno tardaba más de medio minuto SIN IMPRIMIR NADA
  # entre el "Comprobando la disponibilidad ..." y la primera línea de pacman: parecía
  # colgado y invitaba a un Ctrl+C en mitad del instalador. En lote son décimas.
  #
  # LC_ALL=C es obligatorio: el campo se llama "Name" en inglés y "Nombre" en español, y
  # el parseo depende de él. Sin fijar el locale, en una máquina en español TODOS los
  # paquetes salían como ausentes.
  #
  # `pacman -Si` con un nombre inexistente en la lista NO aborta: informa de los que
  # encuentra y manda el resto a stderr (que se descarta), así que un nombre renombrado
  # río arriba sigue detectándose como ausente en vez de tumbar la comprobación entera.
  info "Comprobando la disponibilidad de ${#deseados[@]} paquetes ..."
  local -A conocidos=()
  while IFS= read -r paquete; do
    [[ -n "$paquete" ]] && conocidos["$paquete"]=1
  done < <(
    { LC_ALL=C pacman -Si "${deseados[@]}" 2>/dev/null | awk -F': +' '/^Name +:/ { print $2 }'
      LC_ALL=C pacman -Qq "${deseados[@]}" 2>/dev/null; } | sort -u
  )
  for paquete in "${deseados[@]}"; do
    if [[ -n "${conocidos[$paquete]:-}" ]]; then
      disponibles+=("$paquete")
    else
      ausentes+=("$paquete")
    fi
  done
  # Lo que no está en ningún repo NO es necesariamente un error: puede ser AUR-only. Con
  # ayudante se le pasa igual y que lo resuelva él; sin ayudante sí es lo que falta.
  if ((${#ausentes[@]})); then
    if [[ -n "$AYUDANTE_AUR" ]]; then
      info "Fuera de los repos (los busca $AYUDANTE_AUR en AUR): ${ausentes[*]}"
      disponibles+=("${ausentes[@]}")
    else
      warn "Los repos configurados no ofrecen: ${ausentes[*]} (¿renombrados? ¿falta un repo? ¿hace falta 'pacman -Sy'?)"
      warn "Sin paru ni yay no puedo buscarlos en AUR. Instalá uno y repetí el instalador."
    fi
  fi
  ((${#disponibles[@]})) || { warn "No hay ningún paquete instalable; omito este lote."; return 0; }

  if run_interactive "${gestor[@]}" "${flags[@]}" "${disponibles[@]}"; then
    return 0
  fi

  warn "La instalación en lote falló; reintento paquete a paquete para aislar el problema (esto tarda más)."
  for paquete in "${disponibles[@]}"; do
    pacman -Qq "$paquete" >/dev/null 2>&1 && continue
    run_interactive "${gestor[@]}" "${flags[@]}" "$paquete" >/dev/null 2>&1 \
      || fallidos+=("$paquete")
  done
  if ((${#fallidos[@]})); then
    PAQUETES_FALLIDOS+=("${fallidos[@]}")
    warn "No se pudieron instalar: ${fallidos[*]}"
    warn "Reintentá luego con: ${gestor[*]} -S --needed ${fallidos[*]}"
  fi
  return 0
}

# La base de pacman puede estar bloqueada por una actualización en otra terminal o por el
# monitor de actualizaciones del propio escritorio. Sin esto el fallo salía como un error
# de pacman a media instalación; comprobarlo antes permite decir qué pasa y no empezar.
comprobar_pacman_libre() {
  [[ -e /var/lib/pacman/db.lck ]] || return 0
  # Se mira /proc a pelo, sin fuser (psmisc) ni pgrep (procps-ng): esta comprobación corre
  # ANTES de instalar nada, así que no puede depender de un paquete que quizá falte —
  # sería un fallo de la comprobación disfrazado de "no hay pacman corriendo".
  local comm_file pid comando
  for comm_file in /proc/[0-9]*/comm; do
    [[ -r "$comm_file" ]] || continue
    IFS= read -r comando < "$comm_file" 2>/dev/null || continue
    case "$comando" in
      pacman|pacman-key|paru|yay|checkupdates|pamac*)
        pid="${comm_file#/proc/}"; pid="${pid%/comm}"
        die "Hay otro gestor de paquetes en marcha ($comando, PID $pid). Esperá a que termine y repetí el instalador."
        ;;
    esac
  done
  warn "Existe /var/lib/pacman/db.lck pero ningún gestor de paquetes lo usa (¿una actualización interrumpida?)."
  die "Borralo con 'sudo rm /var/lib/pacman/db.lck' y repetí el instalador."
}

install_packages() {
  local official=(
    git curl python xdg-utils shared-mime-info base-devel util-linux polkit
    less man-db wget tar hwinfo openbsd-netcat neovim
    # Estas cuatro llegaban SIEMPRE como dependencia transitiva de otra cosa, así que
    # nunca se notó que no estaban declaradas. Se declaran porque su ausencia no da
    # error, da un escritorio a medias:
    #   procps-ng  pgrep/pkill — los usan 21 ficheros; sin ellos ningún *-monitor.sh se
    #              relanza ni se detiene, y `hyprctl reload full-reset` deja duplicados.
    #   glib2      gsettings (el tema oscuro y los iconos de las apps GTK, autostart.lua)
    #              y `gio trash`, que es como manda a la papelera Ajustes > Almacenamiento.
    #   fontconfig fc-match, que es con lo que preflight.sh comprueba las fuentes.
    #   gawk       awk con extensiones GNU en los scripts de análisis.
    procps-ng glib2 fontconfig gawk
    # expac: el inventario de paquetes de Ajustes > Almacenamiento (nombre, tamaño en bytes,
    # razón de instalación, fecha y descripción de una pasada). `pacman -Qi` hace lo mismo en
    # ~285 ms contra los ~18 ms de expac; el analizador cae a `pacman -Qi` si falta, así que su
    # ausencia solo se nota en el reloj.
    expac
    # pacman-contrib: da `checkupdates` a updates-monitor.sh (sincroniza su propia BD
    # temporal en vez de leer la del sistema). Sin él el monitor sigue funcionando
    # cayendo a `pacman -Qu`, pero eso exige una BD ya sincronizada por el usuario.
    # Da además `paccache`, que es quien limpia la caché de paquetes desde Ajustes >
    # Liberar espacio y quien simula (`-d`) cuánto liberaría antes de tocar nada.
    pacman-contrib
    # Mantén esta pila en paquetes estables. qt6ct + Breeze proporcionan el
    # tema Qt; hyprqt6engine-git no es necesario y fuerza bibliotecas -git.
    hyprland hyprlock hypridle hyprpolkitagent hyprsunset uwsm
    # hyprcursor: Hyprland ya depende de la librería, pero el paso 10 usa el
    # BINARIO hyprcursor-util (mismo paquete) para generar la mitad hyprcursor
    # del tema de puntero. Se pide explícito para que sea una dependencia
    # declarada del instalador y no un efecto colateral de otro paquete.
    hyprcursor
    # xorg-xwayland: hypr/gigios/reglas.lua tiene reglas específicas para ventanas
    # XWayland (el arreglo de arrastres) y monitores.lua configura su escalado. Hyprland
    # solo lo recomienda, no lo requiere: sin él las apps X11 (Steam, juegos, instaladores)
    # no abren y el fallo aparece como "la app no arranca", no como una dependencia ausente.
    xorg-xwayland
    xdg-desktop-portal-hyprland xdg-desktop-portal-gtk qt6-wayland qt6ct
    gjs gtk4-layer-shell gobject-introspection npm dart-sass
    # noto-fonts (además del -emoji): qt6ct/qt6ct.conf fija "Noto Sans" y "Noto Sans Mono"
    # como fuentes general y monoespaciada de TODAS las apps Qt, y preflight.sh lo exige.
    # Solo estaba noto-fonts-emoji, que no trae ninguna de las dos: sin esto Qt cae a la
    # fuente sustituta que le toque y las ventanas salen con otra tipografía y otra métrica.
    ttf-meslo-nerd ttf-cascadia-code-nerd noto-fonts noto-fonts-emoji
    rofi rofimoji wtype cliphist wl-clipboard imagemagick brightnessctl ddcutil playerctl
    qalculate-gtk wf-recorder grim slurp jq bc hyprshot btop
    # libcanberra: reproduce el `sound-name` de las notificaciones (alarmas y temporizador del
    # panel de reloj). Sin él la alerta se ve pero no suena, sin error visible.
    libcanberra
    # cava: la FFT de la onda de Spotify de la barra. Sin él la onda no falla, cae a su
    # animación procedimental — así que es una mejora, no un requisito.
    cava
    nm-connection-editor blueman fish
    # kconfig: da kreadconfig6/kwriteconfig6, que usa bin/configurar-dolphin.sh (paso 4
    # de este instalador) y bin/preflight.sh ya exige explícitamente.
    kitty firefox dolphin kservice kconfig breeze ffmpegthumbs kdegraphics-thumbnailers
    ark 7zip unrar elisa filelight gwenview haruna kate kfind kolourpaint
    libreoffice-fresh libreoffice-fresh-es okular partitionmanager simple-scan
    tela-circle-icon-theme-grey
    zsh oh-my-zsh-git zsh-completions zsh-autosuggestions
    zsh-syntax-highlighting zsh-history-substring-search zsh-theme-powerlevel10k
    fzf eza bat duf pkgfile fastfetch
    libpulse pipewire pipewire-audio pipewire-pulse pipewire-alsa wireplumber
    gst-plugin-pipewire libnotify awww upower libgudev
    smartmontools lm_sensors pciutils usbutils udisks2 lsof ntfsprogs dosfstools exfatprogs
    alsa-utils inotify-tools dbus kmod
    networkmanager bluez bluez-utils xdg-user-dirs
    clamav firejail bubblewrap xxhash file cups geoclue gamemode
    mesa-utils lshw github-cli
  )

  command -v pacman >/dev/null || die "La instalación automática solo admite Arch/CachyOS (falta pacman). Usá INSTALL_PACKAGES=0 y seguí docs/SETUP.md."
  command -v sudo >/dev/null || die "Falta sudo. Instálalo y concede permisos al usuario antes de continuar."
  comprobar_pacman_libre
  sudo_prime

  # Pacman acepta paquetes -git como proveedores de hyprutils/hyprlang. Si ya
  # están presentes, instalar Hyprland estable puede abrir un diálogo de
  # conflictos o, peor, conservar una mezcla con ABI incompatible. No se
  # desinstalan solos porque una máquina puede usar hyprland-git a propósito.
  local paquete
  local -a pila_hyprland_incompatible=()
  for paquete in hyprland-git hyprqt6engine-git hyprutils-git hyprlang-git; do
    pacman -Qq "$paquete" >/dev/null 2>&1 && pila_hyprland_incompatible+=("$paquete")
  done
  if (( ${#pila_hyprland_incompatible[@]} )); then
    warn "Hay paquetes incompatibles con la pila estable que instala GiGiOS:"
    printf '  - %s\n' "${pila_hyprland_incompatible[@]}" >&2
    die "No modifico esa pila automáticamente. Sigue la recuperación de docs/SETUP.md y repite el instalador."
  fi

  # CachyOS ofrece su perfil Pure de Fish y el actualizador de mirrors. En Arch
  # puro esos paquetes no existen, así que sólo se agregan cuando el repositorio
  # configurado los proporciona. VS Code se instala sólo si ningún paquete ya
  # aporta el comando `code` (por ejemplo visual-studio-code-bin).
  # bibata-cursor-theme vive en chaotic-aur, no en los repos oficiales: va aquí y
  # no en la lista dura porque en un Arch puro haría fallar el `pacman -S` ENTERO
  # y con él el resto de dependencias. Sin él, el paso 10 avisa y el escritorio
  # arranca igual con el puntero de XCursor.
  local optional_official
  for optional_official in cachyos-fish-config cachyos-rate-mirrors bibata-cursor-theme; do
    pacman -Si "$optional_official" >/dev/null 2>&1 && official+=("$optional_official")
  done
  command -v code >/dev/null 2>&1 || official+=(code)

  # TLP solo en portátiles. El paso 9 instala sus perfiles conmutables ÚNICAMENTE si
  # `tlp` ya existe, y nadie lo instalaba nunca: Ajustes > Energía se quedaba sin el
  # selector Normal/Ahorro en una máquina recién instalada, sin decir por qué. En un
  # sobremesa no se instala a propósito — TLP ahí no aporta y compite con
  # power-profiles-daemon si el usuario lo tiene.
  if tiene_bateria; then
    official+=(tlp tlp-rdw)
  else
    info "Sin batería del sistema: omito TLP (los perfiles de energía son cosa de portátil)."
  fi

  # AGS y las bibliotecas Astal entran EN LA MISMA LISTA, no en una pasada aparte.
  # Son dependencias del escritorio como cualquier otra; que su origen habitual sea AUR
  # es un detalle del proveedor, no una fase distinta de la instalación. Metidas aquí:
  #   - una sola confirmación y una sola resolución de dependencias,
  #   - si un repo configurado las ofrece como binario (chaotic-aur las tiene), se
  #     instalan como binario y NO se compila `libastal-meta`, que era lo que convertía
  #     una instalación nueva en una espera de varios minutos.
  # El `--needed` hace que en una reejecución no se toquen: ya no hace falta el sondeo de
  # `command -v ags` + los ocho typelibs que había aquí para decidir si valía la pena.
  official+=(aylurs-gtk-shell-git libastal-meta)

  # pkgfile en SEGUNDO PLANO: descarga la lista de ficheros de los 7 repos (decenas de
  # MB) y no la necesita ningún paso posterior — sólo el `command-not-found` del shell,
  # que se usa después de instalar. Se espera al final (`esperar_descargas_de_fondo`),
  # justo antes de validar. Es tiempo que antes se sumaba y ahora se solapa.
  if command -v pkgfile >/dev/null 2>&1; then
    info "Actualizando el índice de pkgfile en segundo plano ..."
    sudo -n pkgfile --update >/dev/null 2>&1 &
    PKGFILE_PID=$!
  fi

  info "Instalando dependencias (${#official[@]} paquetes, una sola tanda${AYUDANTE_AUR:+ vía $AYUDANTE_AUR}) ..."
  paquetes_instalar "${official[@]}"

  if [[ -z "$AYUDANTE_AUR" ]] && ! command -v ags >/dev/null 2>&1; then
    warn "AGS/Astal no están y no encontré paru ni yay para buscarlos en AUR. Instalá uno y repetí el instalador; el resto de la instalación continúa."
  fi

  # Uno por uno y no en una sola orden: `systemctl enable --now a b` falla ENTERO si una
  # de las dos unidades no existe (bluez no instalado, por ejemplo), y entonces la red
  # tampoco quedaba activada aunque NetworkManager sí estuviera.
  local -a unidades=(NetworkManager.service bluetooth.service)
  # TLP solo donde se instaló (portátil, ver más arriba). Sin habilitar su unidad, el
  # perfil de /etc/tlp.conf NO se aplica al arrancar ni al cambiar de AC a batería: el
  # selector de Ajustes > Energía seguía funcionando —el helper hace `tlp start`, que
  # actúa en caliente— pero cada reinicio empezaba sin TLP hasta que alguien lo movía
  # a mano o entraba en modo ahorro. `tlp-rdw` no tiene unidad propia que activar (va
  # por dispatcher de NetworkManager).
  if tiene_bateria; then
    unidades+=(tlp.service)
    # TLP y power-profiles-daemon se pelean por los mismos ajustes del kernel (governor,
    # EPP, ASPM) y el resultado depende de quién escriba el último: el portátil acaba con
    # una mezcla que no es ninguno de los dos perfiles. Es un requisito de TLP, no una
    # preferencia nuestra, y no da error — sólo consumo. CachyOS trae ppd activo en varias
    # de sus ediciones, así que en una máquina recién instalada esto pasa por defecto.
    # Se DESACTIVA, no se enmascara: revertirlo es un `systemctl enable --now`.
    if systemctl is-enabled --quiet power-profiles-daemon.service 2>/dev/null ||
       systemctl is-active --quiet power-profiles-daemon.service 2>/dev/null; then
      info "Desactivando power-profiles-daemon: entra en conflicto con TLP (lo usa Ajustes > Energía)."
      sudo systemctl disable --now power-profiles-daemon.service \
        || warn "No pude desactivar power-profiles-daemon; competirá con TLP. Hacelo con: sudo systemctl disable --now power-profiles-daemon.service"
    fi
  fi
  info "Activando los servicios que usa el panel de red, Bluetooth y la energía ..."
  local unidad
  for unidad in "${unidades[@]}"; do
    systemctl list-unit-files "$unidad" >/dev/null 2>&1 || {
      warn "La unidad $unidad no existe (¿falló su paquete?); no la activo."
      continue
    }
    systemctl is-enabled --quiet "$unidad" 2>/dev/null && systemctl is-active --quiet "$unidad" 2>/dev/null \
      && continue
    sudo systemctl enable --now "$unidad" \
      || warn "No pude activar $unidad; actívala antes de iniciar Hyprland."
  done
}

# Cambiar el shell es el ÚLTIMO paso y no puede ser fatal: llegados aquí todo lo demás
# ya está instalado, y morir por el shell dejaba un escritorio completo reportado como
# instalación fallida. Además `chsh` pide contraseña, así que sin terminal (curl | bash)
# no hay forma de hacerlo: se avisa con la orden exacta y se sigue.
configure_default_shell() {
  local zsh_path current_shell current_user
  zsh_path="$(command -v zsh 2>/dev/null || true)"
  [[ -n "$zsh_path" ]] || {
    warn "Zsh no está instalado; el shell predeterminado se queda como estaba."
    return
  }
  grep -Fxq "$zsh_path" /etc/shells || {
    warn "$zsh_path no figura en /etc/shells; no puedo activarlo como shell predeterminado."
    return
  }

  current_user="$(id -un)"
  current_shell="$(getent passwd "$current_user" | cut -d: -f7)"
  # readlink -f a los dos lados: /bin/zsh y /usr/bin/zsh son el mismo binario en Arch,
  # y compararlos como cadenas hacía que cada reejecución intentase el chsh otra vez.
  if [[ "$(readlink -f "$current_shell" 2>/dev/null)" == "$(readlink -f "$zsh_path")" ]]; then
    info "Zsh ya es el shell predeterminado de $current_user."
    return
  fi

  if ((INTERACTIVE)); then
    info "Estableciendo Zsh como shell predeterminado de $current_user ..."
    run_interactive chsh -s "$zsh_path" \
      && return
  fi
  warn "No pude cambiar el shell a Zsh. Ejecutalo vos: chsh -s '$zsh_path'"
}

# Resumen de lo que se va a hacer, antes de hacerlo. Con opciones combinadas es fácil
# equivocarse de lista; verlo escrito evita descubrir a posteriori que faltaba un paso.
pasos_previstos=()
pasos_omitidos=()
for paso_probe in "${ORDEN_PASOS[@]}"; do
  if paso_activo "$paso_probe"; then pasos_previstos+=("$paso_probe")
  else pasos_omitidos+=("$paso_probe"); fi
done
info "Pasos a ejecutar: ${pasos_previstos[*]:-ninguno}"
((${#pasos_omitidos[@]})) && info "Pasos omitidos:    ${pasos_omitidos[*]}"
echo

if paso_activo paquetes; then
  install_packages
else
  info "Omito las dependencias (no se instala ni se comprueba ningún paquete)."
fi

# Si no hay que tocar el repo no hace falta git, y exigirlo impediría un
# `--solo paquetes` en una máquina donde git todavía no está.
if paso_activo repo; then
  command -v git >/dev/null || die "git no está instalado."
fi

if paso_activo repo; then
  # --- 1. Clonar el repo bare (o reutilizar) ---
  if [ -d "$DOTGIT" ]; then
    # Existir no basta: un clon interrumpido (Ctrl+C, red caída) deja el directorio creado
    # pero sin repo dentro, y a partir de ahí TODAS las reejecuciones fallaban en el fetch
    # con "not a git repository" sin decir que la causa es un clon a medias.
    if git --git-dir="$DOTGIT" rev-parse --git-dir >/dev/null 2>&1; then
      info "Ya existe $DOTGIT; hago fetch en vez de clonar."
    else
      warn "$DOTGIT existe pero no es un repositorio git válido (clon interrumpido); lo aparto en $BACKUP."
      mkdir -p "$BACKUP"
      mv "$DOTGIT" "$BACKUP/dotfiles-roto"
    fi
  fi
  if [ ! -d "$DOTGIT" ]; then
    info "Clonando $REPO_URL (bare) en $DOTGIT ..."
    # Sin esto, un clon fallido deja el directorio a medias y la siguiente ejecución
    # tropieza con él en vez de reintentar limpio.
    git clone --bare "$REPO_URL" "$DOTGIT" || {
      rm -rf "$DOTGIT"
      die "No pude clonar $REPO_URL. Revisá la red y la URL, y repetí el instalador."
    }
  fi

  # refspec estándar para tener refs/remotes/origin/* y upstreams correctos
  dotfiles config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
  dotfiles config status.showUntrackedFiles no
  info "Fetch de origin ..."
  dotfiles fetch --prune origin || die "Falló el fetch de origin. Revisá la red y repetí el instalador."

  dotfiles rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null \
    || die "La rama '$BRANCH' no existe en origin. Probá DOTFILES_BRANCH=<rama>."

  # --- 2. Checkout/actualización con backup de conflictos ---
  # -B es importante al reutilizar ~/.dotfiles: un checkout normal de una rama
  # local existente no la avanza después del fetch y dejaría instalada una versión
  # antigua. La copia desplegada debe seguir exactamente origin/$BRANCH.
  #
  # PERO `-B` MUEVE EL PUNTERO DE LA RAMA. En una máquina ya instalada —que es el caso
  # normal al reejecutar el instalador— cualquier commit local que todavía no esté en
  # origin desaparece del historial: solo queda en el reflog, donde nadie lo va a buscar
  # porque nada avisa de que se perdió. Antes de tocar nada se comprueba y se deja una
  # etiqueta de rescate con un nombre que se puede volver a encontrar.
  if dotfiles rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
    commits_locales="$(dotfiles rev-list --count "origin/$BRANCH..$BRANCH" 2>/dev/null || echo 0)"
    if [[ "$commits_locales" != 0 ]]; then
      rescate="gigios-preinstall-$(date +%Y%m%d-%H%M%S)"
      dotfiles tag "$rescate" "$BRANCH" >/dev/null 2>&1 || true
      warn "La rama local '$BRANCH' tiene $commits_locales commit(s) que no están en origin."
      dotfiles log --oneline "origin/$BRANCH..$BRANCH" 2>/dev/null | sed 's/^/    /' >&2 || true
      warn "Los guardé en la etiqueta '$rescate'; recuperalos con: dotfiles log $rescate"
    fi
  fi

  # Los ficheros rastreados que hayas modificado a mano se van al backup unos párrafos más
  # abajo. Enumerarlos ANTES es la diferencia entre "el instalador se llevó mis cambios" y
  # saber exactamente cuáles y dónde están.
  modificados="$(dotfiles diff --name-only "origin/$BRANCH" -- 2>/dev/null || true)"
  if [[ -n "$modificados" ]]; then
    warn "Estos ficheros rastreados difieren de origin/$BRANCH y se respaldarán en $BACKUP:"
    printf '%s\n' "$modificados" | sed 's/^/    /' >&2
  fi

  info "Actualizando el checkout a origin/$BRANCH ..."
  # LC_ALL=C: el bloque de abajo identifica los ficheros en conflicto por la sangría de la
  # lista que imprime git. Con la máquina en español git traduce el mensaje, y aunque hoy la
  # sangría coincida, depender del idioma del sistema para decidir QUÉ FICHEROS SE MUEVEN es
  # exactamente el fallo mudo que no se quiere: fijar el locale lo hace determinista.
  if ! LC_ALL=C dotfiles checkout -B "$BRANCH" "origin/$BRANCH" 2>/dev/null; then
    warn "Hay archivos existentes que chocan; los respaldo en $BACKUP"
    checkout_error="$(LC_ALL=C dotfiles checkout -B "$BRANCH" "origin/$BRANCH" 2>&1 || true)"
    respaldados=0
    while IFS= read -r f; do
      [ -e "$HOME/$f" ] || continue
      mkdir -p "$BACKUP/$(dirname "$f")"
      mv "$HOME/$f" "$BACKUP/$f"
      echo "  backup: $f"
      respaldados=$((respaldados + 1))
    done < <(
      printf '%s\n' "$checkout_error" \
        | grep -E '^[[:space:]]+[^[:space:]]' \
        | sed 's/^[[:space:]]*//'
    )
    # Si el parseo no encontró NINGÚN fichero que mover, reintentar es inútil: se volvería a
    # fallar igual y el mensaje ("revisá $BACKUP") apuntaría a un directorio vacío. Mejor
    # enseñar lo que dijo git, que es lo único que explica el fallo real.
    if ((respaldados == 0)); then
      printf '%s\n' "$checkout_error" >&2
      die "El checkout falló y no pude identificar qué ficheros lo impiden (mensaje de git arriba)."
    fi
    LC_ALL=C dotfiles checkout -B "$BRANCH" "origin/$BRANCH" \
      || die "El checkout siguió fallando; revisá $BACKUP."
  fi
  dotfiles branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null 2>&1 || true
  info "Dotfiles en su lugar (rama $BRANCH)."
else
  info "Omito el repo: no toco ~/.dotfiles ni el checkout de \$HOME."
fi

if paso_activo symlinks; then
  # --- 3. Symlinks de GiGiOS (respaldando lo que estorbe) ---
  LINK="$HOME/GiGiOS/bin/link.sh"
  if [ -x "$LINK" ]; then
    info "Creando symlinks de GiGiOS ..."
    LINK_BACKUP="$BACKUP" bash "$LINK" --force || die "No se pudieron crear todos los enlaces. Revisa los mensajes anteriores."
  else
    die "No encontré $LINK. El checkout no contiene GiGiOS/bin/link.sh."
  fi
else
  info "Omito los symlinks: las rutas XDG se quedan como estén."
fi

if paso_activo sistema; then
  # --- 4. Ficheros de sistema (/etc) ---
  # ADELANTADO a propósito, justo detrás de los symlinks: es aquí donde arranca la
  # descarga de firmas de ClamAV (~200 MB, en segundo plano), y cuanto antes empiece
  # más se solapa con lo que queda (perfiles, CSS, bases MIME, puntero, validación).
  # Sólo depende del checkout ($HOME/GiGiOS/system) y de sudo, de nada posterior.
  # NO se symlinkean, se copian: udev y systemd leen /etc antes de que $HOME esté montado, y
  # apuntar /etc a un directorio escribible por el usuario sería una escalada silenciosa.
  # Sin este paso la instalación arranca igual, pero con dos fallos mudos:
  #   • sin la regla udev, una copia a un USB "termina" con cientos de MB aún en RAM y retirar
  #     el pendrive pierde los datos de verdad (ver CLAUDE.md, sección USB);
  #   • sin i2c-dev no existen los nodos /dev/i2c-*, así que ddcutil no ve el monitor y el
  #     slider de brillo desaparece en un sobremesa (en un portátil da igual: usa sysfs).
  SYSTEM_DIR="$HOME/GiGiOS/system"
  if [ -d "$SYSTEM_DIR" ] && command -v sudo >/dev/null; then
    info "Instalando los ficheros de sistema en /etc (pide sudo) ..."
    # Con INSTALL_PACKAGES=0 no se pasó por install_packages, así que sudo no está
    # precalentado y el primer `sudo install` abriría un prompt de contraseña en mitad del
    # paso. Es idempotente: si ya hay credencial válida, no hace nada.
    sudo_prime
    if sudo install -Dm644 "$SYSTEM_DIR/udev/99-gigios-usb-writeback.rules" \
         /etc/udev/rules.d/99-gigios-usb-writeback.rules; then
      sudo udevadm control --reload-rules \
        || warn "No pude recargar udev; la regla de USB se aplicará al reiniciar."
    else
      warn "No pude instalar la regla udev de USB. Instálala a mano (ver CLAUDE.md, sección USB)."
    fi
    if sudo install -Dm644 "$SYSTEM_DIR/modules-load.d/i2c-dev.conf" \
         /etc/modules-load.d/i2c-dev.conf; then
      # modules-load.d solo actúa en el arranque: cargarlo ahora evita tener que reiniciar
      # para que el brillo por DDC/CI funcione ya en esta sesión.
      sudo modprobe i2c-dev || warn "No pude cargar i2c-dev ahora; se cargará al reiniciar."
    else
      warn "No pude instalar i2c-dev.conf; el brillo por DDC/CI no funcionará hasta hacerlo."
    fi
    # Botón de encendido: se lo cedemos a Hyprland. Sin esto logind lo maneja él
    # (HandlePowerKey=poweroff de fábrica), a nivel de asiento y sin pasar por el
    # compositor, así que el bind se ejecuta pero el apagado de logind lo tapa y la
    # acción elegida en Ajustes > Energía no se nota nunca (fallo mudo).
    if sudo install -Dm644 "$SYSTEM_DIR/logind.conf.d/99-gigios-powerkey.conf" \
         /etc/systemd/logind.conf.d/99-gigios-powerkey.conf; then
      # `reload` y no `restart`: reiniciar logind puede llevarse la sesión por delante.
      sudo systemctl reload systemd-logind \
        || warn "No pude recargar systemd-logind; el botón de encendido usará la acción de logind hasta reiniciar."
    else
      warn "No pude ceder el botón de encendido a Hyprland; seguirá apagando el equipo (ver CLAUDE.md, sección del botón de encendido)."
    fi
    # TLP: perfiles conmutables Normal/Ahorro. Solo si TLP está instalado (en un
    # equipo sin TLP la función queda oculta en Ajustes > Energía). Todo lo que toca
    # root es root-owned: helper en /usr/local/bin, perfiles en /etc/gigios/tlp, y la
    # regla sudoers acotada al comando exacto. NO se toca /etc/tlp.conf aquí: eso lo
    # hace el helper cuando el usuario elige un perfil.
    if command -v tlp >/dev/null 2>&1; then
      sudo install -Dm755 "$SYSTEM_DIR/tlp/gigios-tlp-apply.sh" /usr/local/bin/gigios-tlp-apply \
        && sudo install -Dm644 "$SYSTEM_DIR/tlp/normal.conf" /etc/gigios/tlp/normal.conf \
        && sudo install -Dm644 "$SYSTEM_DIR/tlp/ahorro.conf" /etc/gigios/tlp/ahorro.conf \
        || warn "No pude instalar los perfiles TLP de GiGiOS."
      instalar_sudoers "$SYSTEM_DIR/tlp/sudoers-gigios-tlp" /etc/sudoers.d/gigios-tlp \
        "el cambio de perfil de energía pedirá contraseña."
    else
      info "TLP no está instalado; omito los perfiles conmutables de energía (se activarán al instalar 'tlp')."
    fi
    # ClamAV: botón "Actualizar firmas" de Ajustes > Seguridad > Antivirus. Mismo esquema que TLP
    # (helper root-owned + regla sudoers acotada al comando exacto) porque /var/lib/clamav es de
    # `clamav` y habilitar el servicio de actualización es de root. Sin esto el botón no se pinta;
    # la actualización sigue pudiendo hacerse a mano con `sudo freshclam`.
    if command -v freshclam >/dev/null 2>&1; then
      sudo install -Dm755 "$SYSTEM_DIR/clamav/gigios-clamav-update.sh" /usr/local/bin/gigios-clamav-update \
        || warn "No pude instalar el helper de ClamAV; el botón de firmas no aparecerá en Ajustes."
      instalar_sudoers "$SYSTEM_DIR/clamav/sudoers-gigios-clamav" /etc/sudoers.d/gigios-clamav \
        "actualizar las firmas pedirá contraseña."
      # Sin firmas el escáner de descargas no puede analizar NADA, así que se descargan aquí, una
      # vez, de forma síncrona (tarda unos minutos y baja ~200 MB).
      #
      # Y NO se habilita `clamav-freshclam.service`, que es lo que hacía antes: mantenerlas al día
      # es hoy un booleano de GiGiOS (`clamavAutoUpdate` en security.json, activado por defecto) que
      # dispara `hypr/scripts/actualizar-firmas.sh --auto` UNA vez al iniciar sesión, y solo si la
      # base falta o pasa de un día. Durante la sesión no queda ningún temporizador de ClamAV. Dejar
      # el servicio encendido reintroduciría justo eso, y encima sin interruptor a la vista (el shell
      # lo apaga solo si se lo encuentra vivo; ver servicios/seguridad/clamav.ts).
      #
      # Y NO se vuelven a descargar en cada reejecución del instalador. Antes se bajaban
      # siempre: reinstalar o actualizar los dotfiles costaba varios minutos y ~200 MB de
      # descarga para acabar con la misma base que ya estaba en disco. Se mira si la base
      # existe y tiene menos de un día — exactamente el mismo criterio que usa
      # actualizar-firmas.sh --auto al iniciar sesión — y si es así se omite.
      if ! paso_activo clamav-db; then
        info "Omito la descarga de firmas de ClamAV; se hará sola al iniciar sesión."
      elif compgen -G '/var/lib/clamav/daily.c?d' >/dev/null &&
        [[ -n "$(find /var/lib/clamav -maxdepth 1 -name 'daily.c?d' -mtime -1 -print -quit 2>/dev/null)" ]]; then
        info "Las firmas de ClamAV ya están al día; no las descargo."
      else
        # En SEGUNDO PLANO: son ~200 MB y nada de lo que viene después los necesita.
        # Se recogen en `esperar_descargas_de_fondo`, antes de la validación final.
        # `sudo -n` y no `sudo`: un proceso de fondo que se pare a pedir contraseña se
        # queda colgado sin que se vea el prompt. La credencial ya está caliente
        # (sudo_prime + keepalive); si no lo estuviera, falla rápido y se avisa.
        info "Descargando la base de firmas de ClamAV en segundo plano (~200 MB) ..."
        sudo -n /usr/local/bin/gigios-clamav-update update >/dev/null 2>&1 &
        CLAMAV_PID=$!
      fi
    else
      info "ClamAV no está instalado; omito el helper de firmas (se activará al instalar 'clamav')."
    fi
    # Limpieza de disco: Ajustes > Almacenamiento > Liberar espacio. Tercer helper con el mismo
    # esquema (root-owned + sudoers acotado), y aquí el NOPASSWD es lo que hace posible la
    # AUTOLIMPIEZA desatendida: un diálogo de contraseña que aparece solo, de madrugada, no lo lee
    # nadie. Por eso el helper solo expone verbos cuyo efecto se regenera (caché de pacman, journal,
    # /var/tmp, huérfanos); vaciar la caché entera y borrar instantáneas siguen pidiendo contraseña
    # por pkexec desde su botón. Sin esto, esas limpiezas salen como "falta el ayudante" en la UI y
    # el resto (todo lo que vive bajo $HOME) sigue funcionando.
    sudo install -Dm755 "$SYSTEM_DIR/limpieza/gigios-limpieza.sh" /usr/local/bin/gigios-limpieza \
      || warn "No pude instalar el helper de limpieza; las limpiezas de sistema pedirán instalarlo."
    instalar_sudoers "$SYSTEM_DIR/limpieza/sudoers-gigios-limpieza" /etc/sudoers.d/gigios-limpieza \
      "la autolimpieza quedará limitada a tu carpeta personal (sin caché de pacman ni journal)."
  else
    warn "Omito los ficheros de /etc (falta sudo o $SYSTEM_DIR). Brillo DDC/CI y escrituras a USB quedan sin configurar."
  fi
else
  info "Omito los ficheros de /etc (udev USB, i2c-dev, botón de encendido, helpers)."
fi

if paso_activo dolphin; then
  # --- 4. Aplicar el perfil ligero de Dolphin ---
  DOLPHIN_CONFIGURATOR="$HOME/GiGiOS/bin/configurar-dolphin.sh"
  # No es fatal: el perfil de Dolphin son miniaturas y comportamiento del gestor de
  # archivos. Necesita kwriteconfig6, así que con INSTALL_PACKAGES=0 o con kconfig sin
  # instalar fallaba y se llevaba por delante la instalación entera por un ajuste estético.
  if [ -x "$DOLPHIN_CONFIGURATOR" ]; then
    info "Configurando miniaturas y comportamiento de Dolphin ..."
    "$DOLPHIN_CONFIGURATOR" aplicar \
      || warn "No se pudo aplicar el perfil de Dolphin (¿falta kconfig?). Reintentá: $DOLPHIN_CONFIGURATOR aplicar"
  else
    warn "No encontré $DOLPHIN_CONFIGURATOR; Dolphin se queda con sus ajustes de fábrica."
  fi
else
  info "Omito el perfil de Dolphin."
fi

if paso_activo kitty; then
  # --- 5. Seleccionar el perfil de rendimiento de Kitty ---
  KITTY_SELECTOR="$HOME/GiGiOS/bin/kitty-profile.sh"
  if [ -x "$KITTY_SELECTOR" ]; then
    info "Seleccionando el perfil de Kitty ($KITTY_PROFILE) ..."
    "$KITTY_SELECTOR" "$KITTY_PROFILE" \
      || warn "No se pudo activar el perfil de Kitty '$KITTY_PROFILE'. Reintentá: $KITTY_SELECTOR $KITTY_PROFILE"
  else
    warn "No encontré $KITTY_SELECTOR; Kitty arrancará sin perfil de rendimiento."
  fi
else
  info "Omito el perfil de Kitty."
fi

if paso_activo firefox; then
  # --- 6. Seleccionar y aplicar el perfil de rendimiento de Firefox ---
  FIREFOX_SELECTOR="$HOME/GiGiOS/bin/firefox-profile.sh"
  if [ -x "$FIREFOX_SELECTOR" ]; then
    info "Seleccionando el perfil de Firefox ($FIREFOX_PROFILE) ..."
    "$FIREFOX_SELECTOR" "$FIREFOX_PROFILE" \
      || warn "No se pudo activar el perfil de Firefox '$FIREFOX_PROFILE'. Reintentá: $FIREFOX_SELECTOR $FIREFOX_PROFILE"
  else
    warn "No encontré $FIREFOX_SELECTOR; Firefox arrancará sin perfil de rendimiento."
  fi
else
  info "Omito el perfil de Firefox."
fi

if paso_activo css; then
  # --- 7. Generar el CSS que importa app.ts ---
  SCSS="$HOME/GiGiOS/ags/estilos/style.scss"
  CSS="$HOME/GiGiOS/ags/estilos/out.css"
  APP_ICONS="$HOME/GiGiOS/ags/config/app_icons.json"

  [[ -f "$SCSS" ]] || die "Falta $SCSS. El checkout de GiGiOS está incompleto; vuelve a ejecutar el instalador o comprueba la rama '$BRANCH'."
  if [[ ! -s "$APP_ICONS" ]]; then
    warn "Falta $APP_ICONS o está vacío; los workspaces usarán iconos gráficos."
  elif command -v jq >/dev/null 2>&1; then
    jq -e 'type == "object" and length > 0 and all(to_entries[]; (.key | type == "string") and (.value | type == "string"))' \
      "$APP_ICONS" >/dev/null \
      || warn "$APP_ICONS no contiene un mapa válido; los workspaces usarán iconos gráficos."
  fi
  # Sin CSS el shell arranca sin estilos, así que falta de `sass` es fatal... salvo que ya
  # haya un out.css compilado de una pasada anterior. Ese matiz es lo que hacía que
  # reejecutar el instalador en una máquina donde dart-sass no llegó a instalarse abortase
  # sin motivo: el escritorio ya tenía sus estilos y aun así no se completaba nada más.
  if ! command -v sass >/dev/null 2>&1; then
    if [[ -s "$CSS" ]]; then
      warn "Falta 'sass'; conservo el out.css ya compilado. Instalalo para regenerarlo: sudo pacman -S --needed dart-sass"
    else
      die "Falta el comando 'sass'. En Arch/CachyOS instálalo con: sudo pacman -S --needed dart-sass"
    fi
  else
    info "Compilando el CSS de AGS ..."
    # Se compila a un temporal y solo se publica si salió bien. Antes se escribía
    # directamente sobre out.css: un error de Sass a media escritura dejaba el fichero
    # truncado, y como el instalador moría ahí, la siguiente sesión de AGS arrancaba con
    # medio CSS y sin nada que dijera por qué.
    css_tmp="$(mktemp "${TMPDIR:-/tmp}/gigios-css.XXXXXX.css")" \
      || die "No pude crear un fichero temporal para compilar el CSS."
    if sass_error="$(sass --no-source-map "$SCSS" "$css_tmp" 2>&1)"; then
      install -Dm644 "$css_tmp" "$CSS" || die "No pude escribir $CSS."
      rm -f "$css_tmp"
    else
      rm -f "$css_tmp"
      printf '\033[1;31m-- Error de Sass --\033[0m\n%s\n' "$sass_error" >&2
      die "Sass no pudo compilar $SCSS. Reprodúcelo con: sass --no-source-map '$SCSS' '$CSS'"
    fi
  fi
else
  info "Omito la compilación del CSS (se conserva el out.css que haya)."
fi

if paso_activo mime; then
  # --- 8. Reconstruir las bases MIME y de aplicaciones de KDE/Dolphin ---
  if command -v update-mime-database >/dev/null; then
    info "Reconstruyendo la base MIME del usuario ..."
    # Sin `|| warn` esto abortaba el instalador con `set -e` cuando la base MIME del
    # usuario tenía un XML inválido: un tipo MIME roto tumbaba una instalación entera.
    update-mime-database "$HOME/.local/share/mime" \
      || warn "Falló update-mime-database; los tipos MIME propios pueden no reconocerse."
  else
    warn "No encontré update-mime-database; los tipos MIME propios no estarán disponibles."
  fi

  if command -v kbuildsycoca6 >/dev/null; then
    info "Reconstruyendo la caché de aplicaciones de KDE 6 ..."
    kbuildsycoca6 --noincremental \
      || warn "Falló kbuildsycoca6; el menú 'Abrir con...' puede quedar incompleto."
  elif command -v kbuildsycoca5 >/dev/null; then
    info "Reconstruyendo la caché de aplicaciones de KDE 5 ..."
    kbuildsycoca5 --noincremental \
      || warn "Falló kbuildsycoca5; el menú 'Abrir con...' puede quedar incompleto."
  else
    warn "No encontré kbuildsycoca6 ni kbuildsycoca5; el menú 'Abrir con...' podría quedar vacío."
  fi

else
  info "Omito la reconstrucción de las bases MIME y de KDE."
fi


if paso_activo gpu; then
  # --- 10. Perfil de GPU de esta máquina ---
  # Sin este fichero, gigios/gpu.lua avisa EN PANTALLA EN CADA INICIO DE SESIÓN («sin
  # perfil de GPU: escribe uno en ~/.config/gigios/gpu-perfil»). Era el único paso de
  # docs/SETUP.md que quedaba pendiente después del instalador, y como el escritorio
  # arranca igual, lo normal era no hacerlo nunca y convivir con el aviso.
  #
  # La elección NO se versiona (es estado local por máquina, igual que el perfil de
  # Kitty o el de Firefox; ver docs/anadir-perfiles-por-equipo.md), por eso se escribe
  # aquí y no en el repo.
  #
  # Se lee /sys y no `lspci`: este paso puede correr con --sin paquetes, donde pciutils
  # no está garantizado, y un `command -v lspci` fallido dejaría el perfil sin elegir
  # sin que se note. Clases PCI 0x03xxxx = VGA / 3D controller / Display controller.
  GPU_PERFIL="$HOME/.config/gigios/gpu-perfil"
  detectar_perfil_gpu() {
    local dispositivo clase vendor nvidia=0 integrada=0 encontrada=0
    for dispositivo in /sys/bus/pci/devices/*; do
      [[ -r "$dispositivo/class" && -r "$dispositivo/vendor" ]] || continue
      IFS= read -r clase < "$dispositivo/class" || continue
      [[ "$clase" == 0x03* ]] || continue
      IFS= read -r vendor < "$dispositivo/vendor" || continue
      encontrada=1
      case "$vendor" in
        0x10de) nvidia=1 ;;
        0x8086|0x1002|0x1022) integrada=1 ;;
      esac
    done
    ((encontrada)) || return 1
    if ((nvidia)); then
      # Híbrida sólo en portátil: en un sobremesa con iGPU y NVIDIA la pantalla cuelga
      # casi siempre de la NVIDIA, que es lo que asume sobremesa-nvidia.
      if ((integrada)) && tiene_bateria; then printf 'laptop-hibrida'
      else printf 'sobremesa-nvidia'; fi
    elif ((integrada)); then
      printf 'integrada'
    else
      return 1
    fi
  }
  if [[ -s "$GPU_PERFIL" ]]; then
    info "Perfil de GPU ya elegido ($(tr -d '[:space:]' < "$GPU_PERFIL")); no lo toco."
  elif perfil_gpu="$(detectar_perfil_gpu)"; then
    # `nvidia-vieja-hyde` no se elige nunca automáticamente: es un apaño para tarjetas
    # antiguas concretas y sólo lo sabe quien tiene una.
    if mkdir -p "$(dirname "$GPU_PERFIL")" && printf '%s\n' "$perfil_gpu" > "$GPU_PERFIL"; then
      info "Perfil de GPU detectado y escrito en $GPU_PERFIL: $perfil_gpu"
    else
      warn "No pude escribir $GPU_PERFIL; Hyprland avisará al iniciar sesión. Escribilo a mano: echo $perfil_gpu > $GPU_PERFIL"
    fi
  else
    warn "No pude identificar la GPU de esta máquina; elegí el perfil a mano (ver docs/SETUP.md §9): echo <perfil> > $GPU_PERFIL"
  fi
else
  info "Omito la elección del perfil de GPU."
fi

if paso_activo cursor; then
  # --- 10. Mitad hyprcursor del tema de puntero ---
  # El compositor dibuja su cursor con hyprcursor; XWayland y los toolkits siguen
  # con XCursor. Un tema de paquete solo trae la mitad XCursor, y libhyprcursor
  # ante un nombre que no encuentra no falla: coge el primer tema con manifest.hl
  # que haya, por orden de lectura del directorio. Sin esto, el tema que elija el
  # usuario en Ajustes no tendría mitad hyprcursor y el compositor acabaría
  # dibujando OTRO tema. Esto le añade esa mitad a $CURSOR_THEME, dejando un único
  # nombre válido para las dos variables.
  #
  # NO se elige el tema aquí: eso es `temaCursor` en ~/.config/gigios/devices.json,
  # que escribe el usuario desde Ajustes > Dispositivos > Puntero. Generar el tema
  # es preparar el terreno; cambiarle el puntero a alguien que no lo ha pedido, no.
  CURSOR_GEN="$HOME/GiGiOS/bin/generar-hyprcursor.sh"
  CURSOR_THEME="${CURSOR_THEME:-Bibata-Modern-Ice}"
  if [ -x "$CURSOR_GEN" ]; then
    info "Preparando el tema de puntero '$CURSOR_THEME' para hyprcursor ..."
    # No es fatal: sin esto el escritorio arranca igual, solo que con el puntero
    # de XCursor. Un tema que no esté instalado (otra distro, otro nombre) no debe
    # tumbar una instalación por lo demás correcta.
    "$CURSOR_GEN" "$CURSOR_THEME" \
      || warn "No pude generar el tema hyprcursor '$CURSOR_THEME'. Elegí otro con '$CURSOR_GEN --list' y volvé a correrlo."
  fi
else
  info "Omito la generación del tema hyprcursor."
fi

# --- 11. Verificación y notas finales ---
if paso_activo shell; then
  configure_default_shell
else
  info "Omito el cambio de shell predeterminado."
fi

# La validación ya no aborta con `die`. Morir aquí imprimía "la instalación no está
# completa" y CORTABA antes de las notas finales, que es justo donde se explica qué hacer
# a continuación; y con `set -e` ni siquiera se veía el resumen de lo que sí se hizo. Se
# anota el resultado, se imprime todo, y el código de salida lo decide el resumen final.
# Recoger aquí lo que se lanzó en segundo plano, y no antes: es el último punto donde
# todavía se puede avisar de que algo no bajó, y para entonces ya se han solapado con
# todo lo demás. Va delante de la validación porque el preflight comprueba `pkgfile`.
esperar_descargas_de_fondo

preflight_fallo=0
if ! paso_activo preflight; then
  info "Omito la validación final."
elif [ -x "$HOME/GiGiOS/bin/preflight.sh" ]; then
  info "Validando la instalación ..."
  HOME="$HOME" GIGIOS="$HOME/GiGiOS" "$HOME/GiGiOS/bin/preflight.sh" --installed \
    || preflight_fallo=1
else
  warn "No encontré bin/preflight.sh; no puedo validar la instalación."
fi
echo
if ((preflight_fallo)); then
  warn "La validación final encontró errores (detalle arriba). La instalación NO está completa."
fi
# Las notas dicen lo que REALMENTE se hizo. Antes era un heredoc fijo que afirmaba
# "Zsh quedó como predeterminado" y "las firmas ya se descargaron" aunque esos pasos se
# hubieran omitido con --sin/--solo: el instalador terminaba mintiendo sobre su propio
# resultado, que es peor que no decir nada.
if ((${#pasos_omitidos[@]})); then
  info "Instalación parcial completa (pasos ejecutados: ${pasos_previstos[*]})."
else
  info "Instalación base completa."
fi
echo "  • Rama:     $BRANCH"
[ -d "$BACKUP" ] && echo "  • Backups:  $BACKUP"
cat <<'EOF'
  • Secretos: ~/.config/gigios/spotify-creds.json y ~/.config/gigios/google-calendar-creds.json
              NO vienen en el repo (git-ignored). Restaurá tus copias o corré
              ~/GiGiOS/ags/scripts/spotify-auth.sh y ~/GiGiOS/ags/scripts/google-calendar-auth.sh
EOF
paso_activo shell && cat <<'EOF'
  • Shell:    Zsh quedó como predeterminado; abrí una terminal nueva para cargarlo.
EOF
paso_activo kitty && cat <<'EOF'
  • Kitty:    el perfil se eligió según KITTY_PROFILE; cambiá con ~/GiGiOS/bin/kitty-profile.sh.
EOF
paso_activo firefox && cat <<'EOF'
  • Firefox:  el perfil se eligió según FIREFOX_PROFILE; reiniciá Firefox tras cambiarlo.
EOF
paso_activo repo && cat <<'EOF'
  • Push:     el remoto quedó en HTTPS; para pushear, cambialo a SSH:
              dotfiles remote set-url origin git@github.com:mglourido/my-linux-dotfiles.git
EOF
if paso_activo gpu; then
  if [[ -s "${GPU_PERFIL:-}" ]]; then
    printf '  • GPU:      perfil «%s» en %s (cambialo escribiendo otro nombre; ver docs/SETUP.md §9).\n' \
      "$(tr -d '[:space:]' < "$GPU_PERFIL")" "$GPU_PERFIL"
  else
    cat <<'EOF'
  • GPU:      no se pudo elegir perfil. Escribí uno en ~/.config/gigios/gpu-perfil o
              Hyprland avisará en cada inicio de sesión; ver docs/SETUP.md §9.
EOF
  fi
else
  cat <<'EOF'
  • Hardware: antes de iniciar Hyprland elegí el perfil GPU; ver docs/SETUP.md.
EOF
fi
paso_activo cursor && cat <<'EOF'
  • Puntero:  elegí el tema en Ajustes > Dispositivos > Puntero. Sin elegirlo, el
              compositor usa el puntero de XCursor; para añadir soporte hyprcursor
              a otro tema, ~/GiGiOS/bin/generar-hyprcursor.sh --list.
EOF
if paso_activo clamav-db; then
  cat <<'EOF'
  • Antivirus: las firmas de ClamAV ya se descargaron. A partir de ahora se comprueban al
              INICIAR SESIÓN y se actualizan solas y en silencio si tienen más de un día; no
              queda ningún servicio ni temporizador actualizando durante la sesión. Ajustes >
              Seguridad > Antivirus enseña la fecha, permite actualizarlas al momento y apagar
              ese automatismo.
EOF
else
  cat <<'EOF'
  • Antivirus: NO se descargaron las firmas de ClamAV en esta pasada. Se comprueban y se
              actualizan solas al INICIAR SESIÓN si faltan o tienen más de un día; hasta
              entonces el escáner de descargas no puede analizar nada.
EOF
fi
cat <<'EOF'
  • Disco:    Ajustes > Almacenamiento analiza qué ocupa el equipo y cataloga las apps por
              tamaño; "Liberar espacio" limpia y, si lo activás, lo hace solo. La autolimpieza
              nace APAGADA y con todas las casillas sin marcar: nada se borra sin pedirlo.
  • Sistema:  si necesitás sensores, ejecutá 'sudo sensors-detect'.
  • Sesión:   cerrá y abrí sesión; después comprobá con 'ags run ~/.config/ags/app.ts'.
EOF

resumen_degradado

# Código de salida: 1 solo si la validación falló. Los avisos por sí solos no son un
# fallo (falta un paquete opcional, no hay terminal para chsh), y devolver error por
# ellos haría que un `install.sh && algo` encadenado dejara de funcionar sin motivo.
if ((preflight_fallo)); then
  echo
  printf '\033[1;31mxx\033[0m %s\n' "Revisá los errores de la validación y repetí el instalador cuando los hayas resuelto." >&2
  exit 1
fi
exit 0
