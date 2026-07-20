#!/usr/bin/env python3
"""
lanzar-anclado.py — ejecuta un comando y ancla sus ventanas al escritorio actual.

Es el mismo anclaje que ya tenía rofi (ver `anclaje.py`), pero para quien lanza
apps desde fuera de rofi: hoy Orion (`ags/widget/orion/data/launch.ts`). Orion
llamaba a `sh -c <exec>` a pelo, así que sus apps aparecían donde estuvieras al
terminar de cargar y no donde las abriste — justo lo contrario que rofi.

    lanzar-anclado.py <comando de shell>

El comando se pasa TAL CUAL a `sh -c`, porque lo que hay en un `.desktop` es una
línea de shell (con comillas, `env VAR=x`, tuberías), no un argv. Si llegan
varios argumentos se juntan con espacios, para que dé igual cómo lo trocee quien
llama.

ORDEN: primero se conecta el socket, luego la foto previa, y solo entonces se
lanza. Al revés habría una ventana ciega entre el exec y el `connect()` por la
que una app rápida (kitty abre en 0,1 s) podría colar su `openwindow` antes de
que nadie escuche — y esa ventana justamente no la tiene rofi, que se pasa
segundos esperando a que elijas.

El comando se lanza en su PROPIA sesión (`start_new_session`): este proceso muere
a los 15 s y la app no puede irse con él. Tampoco se espera a que termine ni se
mira su salida — aquí no hay nada que reportar, y quedarse esperando a una app
que dura horas mantendría vivo el observador para nada.

Si algo falla al observar (no hay socket, Hyprland no responde) se sale sin ruido
DESPUÉS de haber lanzado: el fallo debe degradar a "la app se abre donde sea",
nunca a "la app no se abre".
"""

import subprocess
import sys

import anclaje


def main():
    cmd = " ".join(sys.argv[1:]).strip()
    if not cmd:
        return 2

    try:
        sock = anclaje.conectar_eventos()
        before, before_classes, target_ws = anclaje.foto_previa()
    except Exception:
        sock = None

    subprocess.Popen(["sh", "-c", cmd], start_new_session=True)

    if sock is None:
        return 0
    try:
        anclaje.observe(sock, before, target_ws,
                        anclar=anclaje.anclaje_activado(),
                        before_classes=before_classes)
    except Exception:
        pass
    finally:
        sock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
