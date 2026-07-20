#!/usr/bin/env python3
"""
rofi-launch.py

Lanza rofi (drun). Tras lanzar una app, si resulta ser single-instance
(no se crea ninguna ventana nueva pero la app pide atención sobre una ya
existente), trae esa ventana al workspace actual y la enfoca.

Si la app abre ventanas nuevas, las ancla al workspace donde la lancé —
aunque me haya cambiado de workspace mientras cargaba.

Detección: se escucha el socket de eventos de Hyprland (.socket2.sock).
  - openwindow de una dirección NUEVA  -> multi-instancia / primer arranque -> anclar.
  - urgent de una dirección que YA existía -> relanzamiento single-instance -> mover.

Por qué el evento `urgent` y no el foco: con misc:focus_on_activate = false
(por defecto), al relanzar una app single-instance Hyprland NO cambia el foco
ni el workspace; solo marca la ventana existente como "urgent". Ese es el único
evento fiable de que "intentaste abrir algo que ya estaba abierto".

EL ANCLAJE SE LIMITA A LA APP QUE LANZASTE, y esa restricción es el núcleo del
diseño. Antes se anclaba *cualquier* ventana nacida en la ventana de observación,
porque se asumía que la única ventana nueva tras elegir en rofi sería la de la app
elegida. Es falso: un diálogo que abre otra app al pulsar un botón, un popup de
Steam/Heroic o un splash ajeno también emiten `openwindow`, y se los llevaba al
workspace de lanzamiento — el síntoma era "ventanas que aparecen de repente y se
van solas al workspace 1". Como no hay forma de que rofi diga qué eligió
(`-run-command` es solo del modo `run`; drun ejecuta el `Exec` del `.desktop` por
su cuenta), la identidad se deduce de la PRIMERA ventana nueva: su `initialClass`
y su pid. A partir de ahí solo se ancla lo que coincida en clase o cuelgue de ese
mismo árbol de procesos.

LA OBSERVACIÓN NO TERMINA EN LA PRIMERA VENTANA, y eso es lo que arregla los
multiventana. Con el `return` de antes, una app con splash + ventana principal
solo anclaba una de las dos y la otra quedaba donde naciera: la app acababa
PARTIDA entre dos workspaces, que es peor que no anclar nada. Ahora se siguen
anclando todas las de esa identidad hasta agotar el timeout.

Por eso TIMEOUT puede subir a 30 s sin riesgo. Con el filtro por app el falso
positivo desaparece (una ventana ajena en el segundo 20 ya no roba el ancla), y
5 s dejaban fuera justo lo que más tarda —juegos, Electron pesado—, con el efecto
peor de todos: anclaje inconsistente, unas veces sí y otras no, según lo que
tardara ese arranque en concreto.

Ver diseño: docs/superpowers/specs/2026-06-13-rofi-single-instance-move-design.md
"""

import json
import os
import socket
import subprocess
import time

# --- Configuración ---
TIMEOUT = 30.0      # segundos máximos de observación tras lanzar
PID_MAX_DEPTH = 12  # niveles de ancestros a recorrer al emparentar ventanas


def hypr_j(*args):
    out = subprocess.run(["hyprctl", "-j", *args],
                         capture_output=True, text=True).stdout
    return json.loads(out)


def dispatch(*args):
    subprocess.run(["hyprctl", "dispatch", *args],
                   capture_output=True, text=True)


def event_socket_path():
    xdg = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    sig = os.environ["HYPRLAND_INSTANCE_SIGNATURE"]
    return f"{xdg}/hypr/{sig}/.socket2.sock"


def client_of(addr):
    """Datos de la ventana recién abierta, o None si aún no está publicada.

    Se pide el cliente entero (workspace + clase + pid) en UNA llamada: son los
    tres datos que hacen falta por ventana y `hyprctl clients` no es barato.
    """
    for c in hypr_j("clients"):
        if c["address"] == addr:
            return c
    return None


def ppid_of(pid):
    """Padre de un pid leyendo /proc, o None.

    Se usa el campo 4 de `stat` partiendo por el ÚLTIMO ")": el nombre del
    proceso va entre paréntesis y puede contener espacios y paréntesis, así que
    un split() a secas desalinea los campos en procesos con nombres raros.
    """
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            data = f.read().decode(errors="replace")
        return int(data[data.rindex(")") + 1:].split()[1])
    except (OSError, ValueError):
        return None


def is_descendant(pid, ancestor):
    """¿`pid` cuelga de `ancestor` (o es él mismo)?

    Cubre los splashes con clase DISTINTA a la ventana principal (lanzadores
    Java, instaladores, Electron con proceso aparte): comparten árbol de
    procesos aunque no compartan clase. El tope de profundidad evita quedarse
    dando vueltas si /proc devuelve algo incoherente a mitad del recorrido.
    """
    if not pid or not ancestor:
        return False
    for _ in range(PID_MAX_DEPTH):
        if pid == ancestor:
            return True
        pid = ppid_of(pid)
        if not pid or pid <= 1:
            return False
    return False


def main():
    # --- Toggle: si rofi ya está abierto, cerrarlo y salir ---
    if subprocess.run(["pgrep", "-x", "rofi"],
                      capture_output=True).returncode == 0:
        subprocess.run(["pkill", "-x", "rofi"])
        return

    # --- Foto previa ---
    before = {c["address"] for c in hypr_j("clients")}
    target_ws = hypr_j("activeworkspace")["id"]

    # --- Lanzar rofi (bloquea hasta selección o cancelación) ---
    # El diseño compartido vive en rofi/config.rasi; este selector solo cambia
    # el placeholder respecto al historial del portapapeles.
    tema_busqueda = 'entry { placeholder: "Buscar aplicaciones"; }'
    resultado_rofi = subprocess.run([
        "rofi", "-show", "drun",
        "-display-drun", "",
        "-no-drun-use-desktop-cache",
        "-kb-row-select", "Right",
        "-kb-move-char-forward", "Control+f",
        "-matching", "fuzzy",
        "-sort",
        "-sorting-method", "fzf",
        "-case-smart",
        "-theme-str", tema_busqueda,
    ])
    if resultado_rofi.returncode != 0:
        return

    # --- Observación vía socket de eventos ---
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(event_socket_path())
    observe(sock, before, target_ws)


def observe(sock, before, target_ws, timeout=TIMEOUT):
    """Bucle de eventos: ancla las ventanas de la app lanzada a `target_ws`.

    Está separado de main() para poder ejercitarlo contra eventos reales sin
    tener que pasar por rofi, que es interactivo y no se puede guionizar.
    """
    # Identidad de la app lanzada, fijada por la primera ventana nueva.
    app_class = None   # initialClass: no cambia aunque la app se renombre en marcha
    app_pid = None

    # Clases que ya existían al lanzar, para reconocer diálogos de apps vivas.
    before_classes = {c.get("initialClass", "") for c in hypr_j("clients")
                      if c["address"] in before}

    limite = time.monotonic() + timeout
    buf = b""
    while True:
        restante = limite - time.monotonic()
        if restante <= 0:
            return
        sock.settimeout(restante)
        try:
            data = sock.recv(4096)
        except socket.timeout:
            return
        if not data:
            break
        buf += data
        *lines, buf = buf.split(b"\n")
        for raw in lines:
            event, _, payload = raw.decode(errors="replace").partition(">>")

            if event == "openwindow":
                # openwindow>>ADDR,WORKSPACE,CLASS,TITLE  (ADDR sin "0x")
                addr = "0x" + payload.split(",", 1)[0]
                if addr in before:
                    continue

                cli = client_of(addr)
                if cli is None:
                    # El evento llegó antes de que Hyprland publicara el cliente.
                    # Sin clase ni pid no se puede decidir de quién es: se ignora
                    # en vez de anclar a ciegas, que es el fallo que se arregla.
                    continue

                cls, pid = cli.get("initialClass", ""), cli.get("pid", 0)

                if app_class is None:
                    # Primera ventana nueva: ella define qué es "la app lanzada".
                    # Salvo que sea un diálogo de algo que YA estaba corriendo:
                    # flotante y de una clase presente antes de lanzar. Eso no
                    # puede ser lo que acaba de abrir rofi (relanzar algo ya
                    # abierto va por la rama `urgent`, no por `openwindow`), y
                    # dejar que fije la identidad es el fallo peor posible: se
                    # ancla el diálogo ajeno y la app de verdad se queda suelta.
                    # Importa sobre todo con apps lentas, donde la espera deja
                    # 30 s para que se cuele algo por delante.
                    if cli.get("floating") and cls in before_classes:
                        continue
                    app_class, app_pid = cls, pid
                elif not (cls == app_class or is_descendant(pid, app_pid)):
                    # Ventana de otra app abierta por casualidad durante la
                    # observación (un diálogo, un popup): no es nuestra.
                    continue

                # Anclar al workspace donde lancé. Si me cambié mientras cargaba,
                # la traigo en silencio (silent = no me arrastra de vuelta).
                if cli["workspace"]["id"] != target_ws:
                    dispatch("movetoworkspacesilent",
                             f"{target_ws},address:{addr}")

            elif event == "urgent":
                # urgent>>ADDR  (ADDR sin "0x")
                addr = "0x" + payload.strip()
                # Solo si NO se ha abierto ya una ventana nueva: una vez que sabemos
                # que la app arrancó de verdad, un `urgent` posterior es de otra cosa
                # (una notificación entrante) y moverla sería robar una ventana ajena.
                if addr in before and app_class is None:
                    # Relanzamiento single-instance: traer al workspace actual.
                    cli = client_of(addr)
                    if cli and cli["workspace"]["id"] != target_ws:
                        dispatch("movetoworkspace", f"{target_ws},address:{addr}")
                    dispatch("focuswindow", f"address:{addr}")
                    return


if __name__ == "__main__":
    main()
