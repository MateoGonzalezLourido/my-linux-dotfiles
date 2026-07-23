-- gigios/autostart.lua — lo que se lanza al iniciar la sesión, escalonado.
--
-- Todo va dentro de hl.on("hyprland.start"): se dispara UNA vez por sesión y un
-- `hyprctl reload` NO lo repite (medido en Fase 0) — la semántica exacta de
-- `exec-once`. El código top-level de un módulo, en cambio, se re-ejecuta en
-- cada reload (semántica `exec`), y relanzar AGS/monitores en cada recarga
-- sería un desastre.
--
-- ── Calendario de arranque (por qué hay `sleep N &&`) ────────────────────────
-- Todos estos exec salían A LA VEZ, compitiendo con la carga del propio
-- Hyprland y del shell (AGS) justo cuando la caché está fría: journal sin
-- cachear, firmas de ClamAV sin cargar, discos aún despertando. Lo caro no es
-- ninguno por separado, es que ~12 procesos pidan datos del sistema a la vez
-- que se pinta el escritorio.
--
-- La regla: lo que el usuario VE o lo que no puede perder eventos va a t=0; lo
-- que solo consulta el estado del PC (disco, sensores, batería, journal) se
-- aparta unos segundos. Nada de esto es urgente al segundo 0 — un disco lleno o
-- un ventilador parado siguen estándolo 20 s después.
--
-- Van ESCALONADOS, no todos con el mismo sleep: darles a todos `sleep 5` solo
-- movería la misma avalancha 5 s más tarde. Cada uno tiene su hueco. Los
-- `sleep N &&` se conservan TAL CUAL (no se "mejoran" con hl.timer): los
-- tiempos están medidos y razonados, y el retardo vive en el punto de llamada
-- y no dentro de los scripts a propósito — `screencast-monitor` y
-- `updates-monitor` también los lanza AGS en caliente desde sus interruptores
-- de Ajustes (pkill + re-exec), y un sleep interno haría que encender el
-- interruptor tardara 15 s en hacer nada. El retardo es una propiedad del
-- ARRANQUE, no del script.
--
-- Excepción: `oom-monitor.sh` se escalona por dentro. No es una unidad — son 6
-- sub-monitores con riesgos distintos: los que siguen el journal (con `-n 0`)
-- no pueden retrasarse sin abrir una ventana ciega; el escaneo de descargas y
-- el sondeo SMART sí. Ver su cabecera.

hl.on("hyprland.start", function()

  -- ── t=0 · lo que se ve, o lo que no puede perder eventos ───────────────────

  -- Tema oscuro e iconos coherentes para aplicaciones GTK y KDE.
  hl.exec_cmd("gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'")
  hl.exec_cmd("gsettings set org.gnome.desktop.interface icon-theme 'Tela-circle-grey'")

  hl.exec_cmd("hypridle")
  hl.exec_cmd("~/.config/inicializador/init.sh")
  hl.exec_cmd("/usr/lib/hyprpolkitagent/hyprpolkitagent")
  hl.exec_cmd([[pkill -f "ags\.js$" 2>/dev/null; sleep 0.3; ags run ~/.config/ags/]])
  hl.exec_cmd("awww-daemon")
  hl.exec_cmd("~/.config/hypr/scripts/wallpaper.sh")
  -- La limpieza es condicional y termina antes de arrancar el watcher, evitando
  -- que este vuelva a guardar el contenido heredado de la sesión anterior.
  hl.exec_cmd("~/.config/hypr/scripts/limpiar-portapapeles.sh al-iniciar; ~/.config/hypr/scripts/clipboard-history.sh start")
  -- Monitor de eventos de seguridad. Sin retardo: sus seguidores del journal
  -- (`journalctl -kf -n 0`) no ven el backlog, así que arrancar tarde = ventana
  -- ciega en OOM/panic/sudo/SSH. Sus partes caras (SMART, unidades, descargas)
  -- se apartan solas dentro del script.
  hl.exec_cmd("~/.config/hypr/scripts/oom-monitor.sh")
  -- (el escáner de apps de inicio vive en gigios/escaner-apps.lua,
  -- que escucha `window.open` nativo desde su propio hl.on("hyprland.start") —
  -- misma ventana de 30 s, sin socket ni nc. El .sh queda para la sesión legacy.)

  -- ── t=3..6 · monitores dirigidos por eventos ───────────────────────────────
  -- Bloquean en un socket (udev/D-Bus/nmcli/PipeWire): en reposo no cuestan
  -- nada, pero su arranque compite con el de los propios servicios a los que se
  -- enganchan. Los dispositivos ya presentes al encender NO generan eventos
  -- después del login (los emitió el kernel durante el boot, antes de que estos
  -- existieran), así que el retardo solo se saltaría algo que enchufes en esos
  -- primeros segundos.
  hl.exec_cmd("sleep 3 && ~/.config/hypr/scripts/bt-monitor.sh")
  hl.exec_cmd("sleep 4 && ~/.config/hypr/scripts/usb-monitor.sh")
  -- WiFi: además, arrancar tarde estrecha una carrera real — el script busca la
  -- interfaz con `nmcli` nada más nacer, y NetworkManager arranca a la vez que
  -- este autostart. El script ya no depende solo de este margen: si no hay
  -- interfaz distingue "no hay antena" (salida silenciosa) de "hay antena y NM
  -- aún no la publica" (reintenta 30 s antes de avisar). Ver su cabecera.
  -- OJO al depurar: en un equipo SIN wifi (este sobremesa: solo enp4s0 +
  -- tailscale0) no aparece en `ps` y ES lo correcto. Lo mismo con
  -- battery/temp-monitor, que salen solos si su toggle está en `false` en
  -- preferences.json (aquí ambos lo están).
  hl.exec_cmd("sleep 5 && ~/.config/hypr/scripts/wifi-monitor.sh")
  -- Screencast: necesita que PipeWire haya publicado sus nodos para que
  -- `pw-dump` vea algo.
  hl.exec_cmd("sleep 6 && ~/.config/hypr/scripts/screencast-monitor.sh")

  -- ── t=8..15 · sondeos de estado del PC ─────────────────────────────────────
  -- Ninguno es urgente al arrancar: la RAM está libre, la CPU fría y el disco
  -- tan lleno como hace un minuto. Se apartan del pico de carga.
  hl.exec_cmd("sleep 8 && ~/.config/hypr/scripts/ram-monitor.sh")
  hl.exec_cmd("sleep 10 && ~/.config/hypr/scripts/temp-monitor.sh")
  hl.exec_cmd("sleep 12 && ~/.config/hypr/scripts/battery-monitor.sh")
  -- Disco: comprobación única (`df`) y sale. Quedarse sin espacio es cosa de
  -- una vez al año — puede esperar 15 s.
  hl.exec_cmd("sleep 15 && ~/.config/hypr/scripts/disk-monitor.sh")

  -- ── t=20..30 · lo caro ─────────────────────────────────────────────────────
  -- Monitor de actualizaciones (SO + drivers GPU). Toca RED y sincroniza una BD
  -- temporal de pacman: lo último que quieres compitiendo con el arranque de la
  -- sesión.
  hl.exec_cmd("sleep 20 && ~/.config/hypr/scripts/updates-monitor.sh")
  -- Healthcheck de arranque: es el más caro de todos (lee el journal entero del
  -- boot dos veces, SMART de cada disco, sensores, ping). Es un DIAGNÓSTICO, no
  -- una alarma en vivo — nadie lo necesita en el primer medio minuto. Antes
  -- esperaba 5 s por dentro; ese sleep vive aquí para que el calendario se lea
  -- entero en un sitio y para poder ejecutarlo a mano sin esperas. Además le da
  -- tiempo a systemd a terminar el boot: `systemd-analyze` falla si aún no ha
  -- acabado, y con él se perdía el aviso de arranque lento.
  hl.exec_cmd("sleep 30 && ~/.config/hypr/scripts/boot-healthcheck.sh")

  -- (KWallet retirado) Las credenciales de Spotify viven en texto plano en
  -- ~/.config/gigios/spotify-creds.json — no se arranca ningún ksecretd/KWallet.
end)
