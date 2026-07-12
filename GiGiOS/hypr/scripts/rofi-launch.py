#!/usr/bin/env python3
"""
rofi-launch.py

Lanza rofi (drun). Tras lanzar una app, si resulta ser single-instance
(no se crea ninguna ventana nueva pero la app pide atención sobre una ya
existente), trae esa ventana al workspace actual y la enfoca.

Si la app es multi-instancia o es su primer arranque, no hace nada: la
ventana nueva ya nace en el workspace actual.

Detección: se escucha el socket de eventos de Hyprland (.socket2.sock).
  - openwindow de una dirección NUEVA  -> multi-instancia / primer arranque -> nada.
  - urgent de una dirección que YA existía -> relanzamiento single-instance -> mover.

Por qué el evento `urgent` y no el foco: con misc:focus_on_activate = false
(por defecto), al relanzar una app single-instance Hyprland NO cambia el foco
ni el workspace; solo marca la ventana existente como "urgent". Ese es el único
evento fiable de que "intentaste abrir algo que ya estaba abierto".

Ver diseño: docs/superpowers/specs/2026-06-13-rofi-single-instance-move-design.md
"""

import json
import os
import socket
import subprocess
import time

# --- Configuración ---
TIMEOUT = 5.0   # segundos máximos de observación tras lanzar


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


def workspace_of(addr):
    for c in hypr_j("clients"):
        if c["address"] == addr:
            return c["workspace"]["id"]
    return None


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
    # Solo se sustituyen las variables de color: el layout/config del usuario
    # sigue siendo exactamente el que Rofi ya cargaba antes.
    colors = (
        "* { main-bg: #11111be6; main-fg: #cdd6f4ff; "
        "main-br: #cba6f7ff; main-ex: #f5e0dcff; "
        "select-bg: #b4befeff; select-fg: #11111bff; } "
        "window { background-color: #11111be6; border-color: #cba6f7ff; } "
        "mainbox, inputbar, listview { background-color: transparent; } "
        "entry, prompt { background-color: transparent; text-color: #f5e0dcff; } "
        "element { background-color: transparent; text-color: #cdd6f4ff; } "
        "element selected { background-color: #b4befeff; text-color: #11111bff; }"
    )
    subprocess.run(["rofi", "-show", "drun", "-theme-str", colors])

    # --- Observación vía socket de eventos ---
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(event_socket_path())
    sock.settimeout(0.3)

    deadline = time.time() + TIMEOUT
    buf = b""
    while time.time() < deadline:
        try:
            data = sock.recv(4096)
        except socket.timeout:
            continue
        if not data:
            break
        buf += data
        *lines, buf = buf.split(b"\n")
        for raw in lines:
            event, _, payload = raw.decode(errors="replace").partition(">>")

            if event == "openwindow":
                # openwindow>>ADDR,WORKSPACE,CLASS,TITLE  (ADDR sin "0x")
                addr = "0x" + payload.split(",", 1)[0]
                if addr not in before:
                    # Ventana nueva (multi-instancia / primer arranque): anclarla al
                    # workspace donde lancé la app. Si me cambié de workspace mientras
                    # cargaba, la traigo de vuelta en silencio (sin arrastrarme a mí).
                    if workspace_of(addr) != target_ws:
                        dispatch("movetoworkspacesilent",
                                 f"{target_ws},address:{addr}")
                    return

            elif event == "urgent":
                # urgent>>ADDR  (ADDR sin "0x")
                addr = "0x" + payload.strip()
                if addr in before:
                    # Relanzamiento single-instance: traer al workspace actual.
                    if workspace_of(addr) != target_ws:
                        dispatch("movetoworkspace", f"{target_ws},address:{addr}")
                    dispatch("focuswindow", f"address:{addr}")
                    return


if __name__ == "__main__":
    main()
