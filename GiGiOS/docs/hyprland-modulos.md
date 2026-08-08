# Hyprland: estructura, GPU/pantalla/idioma y módulos individuales

Detalle completo de la estructura de `hypr/gigios/*.lua` (perfil de GPU, dispositivos, pantalla, idioma) y
el porqué de cada script/módulo individual del sistema (Wake up, gaming-gate, USB, TLP, ClamAV, monitores de
recursos, etc). Referenciado desde `CLAUDE.md` — leer la sección correspondiente antes de tocar el script o
módulo que nombra su título. Para el mapa de directorios y orden de carga, ver `docs/hypr-estructura.md`.

## Hyprland structure

For the directory layout, the module load order, and which script fires from where, see
[`docs/hypr-estructura.md`](docs/hypr-estructura.md) — this section only covers the *why* behind
specific decisions, not a structural map.

**El razonamiento de abajo sigue vigente aunque la sintaxis haya cambiado**: `gigios/*.lua` es un
port fiel de los `.conf`, así que donde se lea "`keybinds.conf`" o "un `source =`" hay que entender
su módulo equivalente. `hypr/hyprland.lua` is a thin entry point that loads the split modules
(`env`, `monitores`, `input`, `ventanas`, `animaciones`, `reglas`, `keybinds`, `autostart`,
`permisos`, …). Note:

- **GPU profile is machine-specific**: exactly one module under `hypr/gigios/gpu/` is loaded
  (`laptop-hibrida.lua` / `sobremesa-nvidia.lua` / …), y **ya no se descomenta a mano** — lo elige
  `~/.config/gigios/gpu-perfil`, un fichero local de una línea fuera del repo.
- `gigios/dispositivos.lua` **lee `~/.config/gigios/devices.json`** (Ajustes > Dispositivos, vía
  `ags/servicios/dispositivos/service.ts`) y se carga después de `gigios/userprefs.lua` para pisar
  lo de ahí. Fichero ausente = no se aplica nada y manda `userprefs`. Los defaults del módulo son
  el espejo de `DEFAULT_DEVICE_SETTINGS` y solo entran por clave ausente o de tipo raro: AGS ya
  escribe el JSON normalizado. De ahí sale también el **tema del puntero** (ver la sección de
  hyprcursor, abajo).
- `gigios/pantalla.lua` **lee `~/.config/gigios/display.json`** (Ajustes > Pantalla, vía
  `ags/servicios/pantalla/service.ts`), recorre `monitors` y emite un `hl.monitor` por entrada
  **después de `gigios/monitores.lua`**, cuya única regla es la comodín (preferido, escala 1).
  Resolución/Hz/escala/VRR/posición se aplicaban antes solo **en vivo** (`hyprctl keyword monitor`)
  y al arrancar AGS, guardándose únicamente en el JSON — que Hyprland no leía. Resultado: cualquier
  **`hyprctl reload`** releía los configs y devolvía la pantalla a modo preferido y escala 1
  (240 Hz → 60 Hz, 1.25 → 1), sin que AGS se enterara (no hay señal de recarga, y su poller solo
  observa). Las specs van por `desc:` (estable entre reconexiones, a diferencia de `DP-1`) y una
  spec concreta gana a la comodín. Efecto extra: el compositor ya arranca en el modo bueno, sin el
  parpadeo de la re-aplicación.
  **Por eso `saveMonitorPref` escribe SÍNCRONO** (`saveDisplayConfigNow`) y no por el debounce de
  2 s que usa el resto de `display.json`: el fichero dejó de ser solo de AGS, y un `hyprctl reload`
  disparado justo después de tocar la resolución releería el JSON viejo y desharía el cambio.
- **El idioma (LANG/LC_ALL) lo lee `gigios/env.lua` de `~/.config/gigios/datetime.json`** (clave
  `locale`, Ajustes > Región, fecha y hora). Antes AGS reescribía un bloque entre marcadores dentro
  del propio `env.lua`, que está **versionado**: estado de máquina ensuciando git, y un marcador
  tocado a mano dejaba el bloque huérfano con AGS añadiendo otro debajo. **Clave ausente = no se
  emite ningún `hl.env`** y manda el LANG de la sesión: poner uno de fábrica ahí cambiaría el idioma
  sin que nadie lo pida. Al portar una máquina que venía del esquema viejo hay que volver a elegir
  el idioma una vez en Ajustes (o escribir la clave a mano).
- Colour management (`render.cm_enabled`) is deliberately **off** because `hyprsunset` owns the
  KMS CTM for night light; enabling Hyprland's CM too washes out the image.

`hypr/gigios/autostart.lua` launches the shell (`ags run ~/.config/ags/`), `hypridle`, `init.sh`,
`wallpaper.sh`, and a set of `hypr/scripts/*-monitor.sh` background daemons (battery, temp,
ram, disk, oom, wifi, usb, bt, screencast, updates). Todo ello cuelga de un
`hl.on("hyprland.start", …)`, que es el equivalente EXACTO de `exec-once`: se dispara una vez por
sesión y un `reload` **no** lo repite (medido). El código de nivel superior del config sí se
re-ejecuta en cada reload — esa es la semántica del viejo `exec =`, y es donde vive la llamada a
`GiGiOS.daltonismo()`. Use `hyprctl reload` for a normal config reload. To restart Hyprland
correctly —including re-running the autostart— use the newer `hyprctl reload full-reset`; a plain
reload does not restart those commands. Relaunch AGS separately when its code changes.

**El arranque está ESCALONADO, y `gigios/autostart.lua` es el único sitio donde se lee el
calendario entero.** Todo esto salía a la vez y competía con la carga de Hyprland y del shell con la caché
fría. La regla: lo que se ve (wallpaper, AGS, `init.sh`) o lo que no puede perder eventos va a
t=0; lo que solo consulta el estado del PC se aparta — eventos a t=3..6 (bt, usb, wifi,
screencast), sondeos a t=8..15 (ram, temp, batería, disco), y lo caro al final (updates t=20,
`boot-healthcheck` t=30, que antes esperaba 5 s por dentro). Van a segundos DISTINTOS a
propósito: darles a todos el mismo `sleep` solo movería la avalancha unos segundos más tarde.

**El retardo vive en el punto de llamada, no dentro de los scripts**, y eso es deliberado:
`screencast-monitor` y `updates-monitor` también los lanza AGS en caliente desde sus
interruptores de Ajustes (setter maestro = `pkill` + re-exec), así que un `sleep` interno haría
que encender el interruptor tardara y pareciera roto. La excepción es `oom-monitor.sh`, que se
escalona por dentro porque sus sub-monitores no corren el mismo riesgo (ver su sección).

**Editar un `*-monitor.sh` NO afecta al que ya está corriendo — hay que matarlo y relanzarlo.**
Son `exec-once`, así que viven desde el login; una recarga normal (`hyprctl reload`) **no** los
reinicia, mientras que `hyprctl reload full-reset` sí vuelve a ejecutar el autostart. Bash además
ya tiene el bucle parseado en memoria, de
modo que el proceso vivo sigue ejecutando el código **anterior** a tu edición: el fichero en disco
y lo que corre divergen sin ningún aviso. Se manifiesta como "mi cambio no hace nada" horas
después — así se coló una tanda de notificaciones de USB sin el hint `x-gigios-source` cuando ya
estaba puesto en el script. Tras editar: `pkill -f ~/.config/hypr/scripts/<x>-monitor.sh` y
relanzarlo (`setsid nohup … &`), o cerrar sesión. Ojo al comprobarlo: `battery-monitor` y
`temp-monitor` **salen solos** si su toggle está a `false` en `preferences.json`, y `disk-monitor`
/ `wifi-monitor` no son daemons persistentes — que no aparezcan en `ps` no significa que fallen.

**`wifi-monitor` distingue tres desenlaces, y antes no.** Salía con un aviso **crítico** en cuanto
`nmcli` no le daba interfaz, sin mirar por qué, juntando dos casos opuestos: en un **sobremesa sin
wifi** (este equipo: solo `enp4s0`; ni `/sys/class/net/*/wireless`, ni entrada en `rfkill`, ni
tarjeta PCI) era un popup rojo en **cada login** anunciando que un hardware inexistente no existe
—ruido del que enseña a ignorar los críticos—; y en un **portátil** era una carrera que se
resolvía **mintiendo** (sale de un `exec-once` a la vez que NetworkManager: perder la carrera
avisaba de "no hay WiFi" habiéndola, y dejaba la sesión sin monitor). Hoy: hay interfaz → vigila;
**no hay hardware → sale en silencio** (se mira `/sys/class/net/<if>/wireless`, que lo publica el
**kernel** y no depende de NM, así que no reintroduce la carrera); hay antena pero NM no la
publica → reintenta 30 s y solo entonces avisa, que ahí sí es un problema real.

**Una vez con interfaz, es 100 % dirigido por eventos**: bloquea en `nmcli monitor` (D-Bus de
NetworkManager) y no sondea nada mientras está inactivo. La línea global `"Connectivity is now
'X'"` de `nmcli monitor` refleja la conectividad **primaria** de NetworkManager, no la de la wifi
en concreto — con cable y wifi a la vez ese evento puede venir del cable —, así que ante cualquier
cambio se reconsulta la conectividad **por interfaz** (`IP4-CONNECTIVITY` de `$IFACE`) y solo se
avisa de portal cautivo si el portal es el de la wifi. `LC_ALL=C` fuerza inglés en la lectura de
`nmcli monitor` porque sus palabras clave (`connected`/`disconnected`) son fijas en ese idioma
independientemente del locale del sistema — lo que ve el usuario por `notify-send` sigue en
español, definido aparte en las funciones `notify_*`. Si `nmcli monitor` muere (NetworkManager se
reinicia), el bucle exterior lo relanza en vez de dejar el daemon colgado para siempre.

### Wake up: la puerta `idle-action.sh` delante de hypridle

**Los `on-timeout` de `hypridle.conf` ya no llaman a la acción: llaman a
`hypr/scripts/idle-action.sh {dpms-off|lock|suspend}`**, que la ejecuta salvo que la función
**Wake up** del menú del logo Arch la esté vetando ("que el PC no se suspenda aunque no lo toque").
Hizo falta una puerta porque hypridle **no tiene API en caliente**: no se le puede desactivar un
listener suelto ni recargarle el config. Las dos alternativas se descartaron con motivo.
`systemd-inhibit --what=idle` (que hypridle sí respeta) apaga **todos** los listeners a la vez, y
entonces "que no se suspenda **pero la pantalla sí se apague**" —el modo por defecto— es
inexpresable. Y reutilizar el `# GIGIOS-OFF` que ya sabe comentar listeners (Ajustes > Pantalla)
significaría **escribir en el config del usuario** para un estado temporal: si AGS muere a mitad,
sus tiempos quedan desactivados para siempre y la UI de Ajustes los enseña apagados, confundiendo
"lo apagué yo" con "lo apagó el Wake up".

**Alcance**: Wake up a secas veta **solo `suspend`** — la pantalla se apaga a los 10 min y bloquea
a los 11, como siempre. Con la subopción **Pantalla** veta además `dpms-off` **y `lock`**: el
bloqueo va atado a la pantalla porque hyprlock la taparía, que es justo lo que la opción evita.
`on-resume` **no** pasa por la puerta: encender la pantalla al volver no se veta nunca, y es lo
único que la despierta si vuelves con el ratón (`mouse_move_enables_dpms = false` en
`gigios/ventanas.lua`; solo una tecla la enciende por su cuenta).

**Estado**: `~/.config/gigios/wakeup.json`, `{active, until, screen, pid}`, escrito por AGS
(`ags/servicios/energia/mantenerDespierto.ts`) y leído por el script — misma dirección que
`runtime-state.json`, no al revés que los `*-monitor.sh`. `until` es **epoch absoluto**, no un
contador: así la puerta resuelve la caducidad sola contra el reloj de pared aunque nadie reescriba
el fichero, y la cuenta atrás no se desfasa tras una suspensión manual (los timeouts de GLib no
corren dormidos). `pid` es el de AGS y la puerta comprueba que sigue vivo.

**Todo error ejecuta la acción (fail-open), y esa asimetría es el diseño**: sin fichero, con JSON
corrupto, sin `jq`, con el pid muerto o con el plazo vencido, la acción sale. Un fallo aquí debe
degradar a "el Wake up no funciona" —visible y arreglable— y nunca a "el PC no se suspende jamás",
que es silencioso, permanente, se come la batería y **no tiene UI donde apagarse** si AGS ya no
está. Por eso hay dos guardas encadenadas y no una: el `pid` cubre "AGS murió y no volvió", pero
los pid **se reciclan** —tras un reinicio el del AGS anterior puede estar ocupado por otro proceso
vivo y la puerta lo daría por bueno—, así que además `initWakeUp()` **limpia el JSON al arrancar**
el shell. El Wake up es por sesión, como el resto del menú de funciones.

**Al caducar se reinicia hypridle** (`pkill hypridle; hypridle &`, el mismo gesto que ya hace
`ags/modulos/ajustes/pantalla/Inactividad.tsx` al guardar los tiempos). No es opcional: hypridle **no repite un `on-timeout`
ya disparado** en esa tanda de inactividad, así que un Wake up de 30 min que veta la suspensión en
el minuto 11 y caduca en el 30 dejaría el PC despierto **para siempre** — nadie volvería a
intentarlo hasta que tocaras el teclado. Reiniciarlo rearma los contadores desde cero: se suspende
~11 min después de caducar, y nunca estando tú delante. El peaje aceptado es ese margen extra.

**Si tocas los `on-timeout`, mira `kindOf()`** en `ags/servicios/pantalla/hypridle.ts`: Ajustes >
Pantalla reconoce los tres listeners **por su comando**, y ahora los tres nombran el mismo script
—los distingue el argumento—. Si dejara de reconocerlos, sus tiempos se volverían ineditables **en
silencio** (`parseHypridle` degrada a "no encontrado", no a un error). Sigue leyendo también el
formato directo (`hyprctl dispatch dpms off` / `hyprlock` / `systemctl suspend`) para un config
traído de otra máquina. Cubierto por `hypridle.test.ts`.

**Desactivar un tiempo se hace comentando la línea, NUNCA con `timeout = 0`.** Cada fila de Ajustes
> Pantalla lleva un interruptor que apaga *ese* listener (`FilaInactividad` en
> `ags/modulos/ajustes/pantalla/Inactividad.tsx` →
`writeHypridle(…, {enabled:false})` → `# timeout = N   # GIGIOS-OFF`). El 0 no es una forma pobre de
decir "nunca": es lo contrario. Medido en hypridle 0.1.7 — con `timeout = 0` el listener **se
registra y se dispara al instante** (`Registered timeout rule for 0s`, y la acción ejecutada ya), o
sea que ponerlo en la fila "Suspender" apagaría el PC nada más guardar. Comentado, hypridle saca un
`Category has a missing timeout setting`, **ignora ese listener y sigue con los demás** (también
medido) — y el valor sobrevive dentro del comentario, así que al reencender vuelve el número del
usuario. De ahí el suelo de 1 min al leer el fichero: un listener ausente parsea a `{timeout: 0}`, y
ese 0 llegaría al `.conf` al encender la fila. **El estado del interruptor sale de `parseHypridle`,
no de un `true` fijo**: cuando la UI escribía `enabled: true` a pelo, mover cualquier stepper
reescribía los tres listeners como activos y resucitaba en silencio un GIGIOS-OFF ya puesto.

**"Bloquear" (el listener) y "Bloquear al suspender" (`before_sleep_cmd`) son ajustes distintos, y
confundirlos costó un bug.** Con el listener de bloqueo apagado, al despertar de una suspensión
seguía apareciendo hyprlock: quien lo pone ahí es `before_sleep_cmd = loginctl lock-session` del
bloque `general`, que **no** cuenta inactividad — lo dispara logind ante *cualquier* suspensión
(el listener de suspender, el menú de energía, el botón físico, cerrar la tapa, un `systemctl
suspend` a mano). No tenía interruptor, así que no había forma de suspender sin bloquear. Ahora lo
gobierna el último interruptor de la tarjeta (`writeBloqueoAlSuspender` en
`ags/servicios/pantalla/hypridle.ts`), que comenta la línea con el mismo sentinel GIGIOS-OFF para
conservar el comando escrito. Ojo al tocar ese regex: `after_sleep_cmd` comparte sufijo con
`before_sleep_cmd` y es lo único que vuelve a encender la pantalla al despertar.

### Diálogo de contraseña de root: hyprpolkitagent, y por qué sigue siendo feo

El agente de polkit —la ventanita que pide la contraseña al necesitar root— **ya es
hyprpolkitagent**, lanzado desde `gigios/autostart.lua`; `polkit-kde-agent` está instalado como
arrastre de Plasma pero no corre ni publica servicio D-Bus. O sea que **no hay ninguna migración
pendiente desde KDE**: si alguien vuelve a plantearla, la respuesta es que ya está hecha.

**No se puede personalizar con la versión de los repos, y el README de GitHub dice lo contrario
porque documenta `main`.** Upstream reescribió el agente de Qt/QML a hyprtoolkit, pero esa
reescritura **no tiene tag** (el último sigue siendo v0.1.3), así que `extra/hyprpolkitagent` es el
Qt viejo: 4 ficheros, ninguno de configuración, y el QML **compilado AOT dentro del binario**
(se ve en los símbolos, `QmlCacheGeneratedCode::_qt_qml_hpa_qml_main_qml`). No hay fichero que
editar ni ruta que sobreescribir. Leer la doc de `main` ejecutando el tag viejo es el modo de
fallo de esta sección.

**La configuración ya está escrita y esperando**: `hypr/hyprtoolkit.conf` (paleta, espejo de
`ags/estilos/_colores.scss`) y `hyprpolkitagent/hyprpolkitagent.conf` (geometría). El primero **no
está inerte**: hyprtoolkit 0.5.4 de repos trae el mismo lector, así que esa paleta ya la aplica
`hyprland-guiutils`. El día que taguen el release, el diálogo de polkit se suma sin tocar nada.

**Se probó la vía AUR y se revirtió a propósito. No lo repitas sin leer esto.** Funcionó —el
diálogo salía con la paleta— pero el coste de mantenimiento era desproporcionado para una mejora
estética, y el mecanismo es concreto: el `hyprtoolkit-git` que hay que instalar tiene **el mismo
nombre y versión que el de chaotic-aur**, así que no cuenta como paquete foráneo (`pacman -Qm` no
lo lista) y **un `-Syu` normal lo reemplaza por el de chaotic en cuanto publiquen una revisión
nueva — y ese depende de `aquamarine-git`**, o sea que el backend de render de Hyprland salta a
rama de desarrollo por pura resolución de dependencias. En paralelo, `hyprpolkitagent-git` se
recompila en cada `-Syu` contra la hyprtoolkit del momento, y ese acoplamiento entre dos ramas sin
ABI estable es exactamente lo que falló al intentarlo (`setText`/`setPassword`/`eyeIcon`/
`setEnabled` no existen en 0.5.4). Cuando eso pase en un `-Syu` de rutina falla **callado**, y lo
que se queda roto es el agente de autenticación.

**Lo medido durante la prueba, para no redescubrirlo:**

- **El binario CAMBIA DE SITIO entre versiones.** En el 0.1.3 de repos es
  `/usr/lib/hyprpolkitagent/hyprpolkitagent` (directorio con el ejecutable dentro); en la
  reescritura, `/usr/lib/hyprpolkitagent` **es** el ejecutable. `gigios/autostart.lua` apunta a la
  primera. Equivocarse no da ningún error: `hl.exec_cmd` falla en silencio y la sesión se queda sin
  agente, cosa que no se nota hasta que algo pide root a mitad de sesión.
- **`window_width` no hace nada** (A/B en 0.1.3.r11): la ventana sale a 460 px pidiendo 500 y
  pidiendo 700, porque el ancho lo fija el contenido. `window_height` sí manda, con un +8 constante.
- **El PKGBUILD de AUR de hyprtoolkit-git exige la cadena `-git` entera** (aquamarine, hyprgraphics,
  hyprwayland-scanner) por conservadurismo del mantenedor, no por necesidad: hyprtoolkit `main`
  compila y enlaza contra las versiones de repos y produce el **mismo soname**
  (`libhyprtoolkit.so.5`), que es lo que necesita `hyprland-guiutils`.
- La otra salida sería escribir el agente dentro de AGS (es un objeto D-Bus
  `org.freedesktop.PolicyKit1.AuthenticationAgent` más `polkit-agent-helper-1` para el PAM). Se
  descartó: son cientos de líneas para lo que 18 claves de config darán gratis al llegar el release.

### Botón de encendido: `gigios/boton-apagado.lua` + `system/logind.conf.d/`

Ajustes > Energía decide qué hace la pulsación **corta** del botón físico (apagar, suspender,
hibernar, bloquear, apagar la pantalla, abrir el menú de energía, cerrar sesión, reiniciar o
nada). Lo ejecuta `GiGiOS.boton_apagado()` (`hypr/gigios/boton-apagado.lua`) desde el bind de
`XF86PowerOff` con **`{ locked = true }`** en `gigios/keybinds.lua` — `locked` (el viejo `bindl`)
porque el botón tiene que responder también con hyprlock puesto, que es justo cuando más se pulsa.
Era un script de bash (`boton-apagado.sh`); se inlineó al migrar a Lua, y con él desapareció la
doble indirección bind → bash → `hyprctl dispatch`.

**El shell NO ejecuta la acción, solo guarda la elección** (`botonApagado` en
`preferences.json`), y el config la relee **en cada pulsación** (`util.leer_json`, no la caché de
`util.prefs()`). Así el botón sigue funcionando
con AGS caído (con la acción de fábrica, `apagar`) y cambiar el ajuste no necesita relanzar nada
— se aparta de la advertencia general de los `*-monitor.sh` porque no hay proceso vivo. La única
acción que sí pasa por AGS es `menu`, vía `ags request toggle-power-menu`, y bajo hyprlock **no
se hace**: el menú quedaría dibujado por debajo del bloqueo y abierto al desbloquear.

**Sin ceder la tecla, el bind se ejecuta pero NO se nota — y ese es el modo de fallo.**
`systemd-logind` maneja esa misma tecla por su cuenta (`HandlePowerKey`, **`poweroff` de
fábrica**) a nivel de **asiento**, leyendo el evento de entrada sin pasar por el compositor. O
sea que las dos acciones ocurren a la vez y gana el apagado de logind: elijas lo que elijas, el
PC se apaga, y sin ningún error por ningún lado. De ahí `system/logind.conf.d/99-gigios-powerkey.conf`
(`HandlePowerKey=ignore`), que como la regla udev de USB y el `i2c-dev` va a `/etc` y **no se
symlinkea**: lo copia `install.sh` (paso 9) y recarga con **`systemctl reload systemd-logind`**
— `reload`, no `restart`, que puede llevarse la sesión por delante. La pulsación **larga** se
deja como esté (`HandlePowerKeyLongPress`, `ignore` por defecto): es la salida de emergencia del
firmware y no debe depender de que el shell responda.

**La UI comprueba la propiedad REAL de logind, no la presencia del fichero**: `busctl --system
get-property … HandlePowerKey` (sin privilegios), en `ags/servicios/energia/botonEncendido.ts`.
El fichero puede estar en otro sitio, o el valor cambiado a mano, así que preguntar a logind es
la única respuesta que no miente. El aviso solo sale cuando la elección **de verdad no puede
cumplirse**: con `apagar` el resultado es el mismo venga de quien venga, y avisar ahí sería ruido.
Un `null` (no se pudo consultar) **no** avisa — no poder comprobarlo no es saber que está mal.

### Notificaciones de los scripts: los hints `x-gigios-source` y `x-gigios-event`

**Todo `notify-send` de `hypr/scripts/` sale por `notificar <id> …`, de
[`lib/notif.sh`](../hypr/scripts/lib/notif.sh)**, que pone los dos hints: `x-gigios-source:system`
(qué clase de notificación es) y `x-gigios-event:<id>` (**cuál** de ellas es). El fichero se sourcea
con el mismo patrón que `lib/gaming-gate.sh`, con un respaldo inline que emite igual sin el id: sin
la librería se pierde la identidad del aviso, nunca el aviso.

**El `event` existe porque el `source` no bastaba para configurarlas por separado.** Con solo el
origen, «USB desconectado», «Disco casi lleno» y «🔓 Escalada de privilegios» eran indistinguibles
para el motor de reglas: mismo hint, y en 44 de las llamadas mismo `app_name` («notify-send»,
porque no pasaban `-a`). El único gancho que quedaba era el **título**, que cambia con el contenido
(`"RAM muy baja: 812MB disponibles"`, `"CPU sobrecalentada: 91°C"`) y con cualquier retoque de
redacción — o sea que silenciar un aviso concreto exigía escribir a mano una regla con un
`contains` frágil, y en varios casos ni eso, porque dos avisos distintos comparten prefijo. El id
es estable, no depende del texto, y **dos ramas del mismo suceso lo comparten a propósito** (el
singular y el plural de «ejecutable nuevo en Descargas»: quien silencia uno quiere los dos
callados). El catálogo de ids vive en
`ags/modulos/notificaciones/rules/catalogoSistema.ts` y es lo que pinta Ajustes > Notificaciones >
**Sistema**, con una fila por aviso; lo que el usuario cambia va a
`~/.config/gigios/notif-sistema.json`. **Al añadir un aviso nuevo, da de alta su id en el
catálogo**: sin eso el aviso funciona igual, pero no aparece en Ajustes — que es lo único que se
pierde, y todo lo que esto pretendía ganar.

`lib/notif-agrupar.sh` es la capa ortogonal: `notif.sh` da IDENTIDAD, `notif-agrupar.sh` decide
CUÁNDO y CUÁNTOS avisos salen. El resumen de una ráfaga se emite con el **mismo id** que el aviso
individual.

El hint de origen no es decorativo: es lo que hace que el popup
salga con el **skin dunst** — esquinas rectas, marco de 3 px, monoespaciada y fondo sólido por
urgencia (azul `#285577` normal, `#900000` con marco `#ff0000` crítica, `#222222` baja), y **sin
nombre de app ni icono**, porque el `format` por defecto de dunst es `"<b>%s</b>\n%b"`. Las apps
normales conservan el diseño del shell. **Un script nuevo que se olvide del hint saldrá con el
diseño normal**, sin error ni aviso — es el único modo de fallo aquí.

**`-u warning` NO EXISTE, y las 16 notificaciones que lo usaban no salían nunca.** libnotify solo
acepta `low`, `normal` y `critical`; ante cualquier otra cosa `notify-send` escribe *«Unknown
urgency warning specified»* por **stderr** y sale con **rc=1 sin enviar nada** (medido en 0.8.8).
Como todas estas llamadas salen de daemons de fondo cuyo stderr no lo lee nadie, el fallo era
**mudo y total**: "⬇️ Ejecutable nuevo en Descargas", "🛡️ No se pudo analizar", "💽 Salud de disco",
"🥾 Cambio en /boot", "⚙️ Servicio fallido", "🌡️ CPU Throttling" y "🌐 SSH" llevaban desde siempre
sin aparecer — el escáner de descargas avisaba de un ejecutable nuevo y no se veía. Todas están ya
en `normal` (el escalón intermedio no existe: o es rutina o es crítico). Al añadir una notificación,
**pruébala ejecutándola**: no basta con leerla, porque la línea parece correcta.

El hint no pinta nada por sí mismo: lo lee el **motor de reglas** (`match.source`), y quien pide
el skin es una regla builtin visible y desactivable desde Ajustes, **`builtin.system-dunst`**
(`ags/modulos/notificaciones/rules/defaults.ts`). Una regla de usuario de más prioridad la pisa —
para sacar del skin a algo del sistema, o para metérselo a una app normal. **Consecuencia
aceptada**: al estar cubiertas por una regla, las notificaciones de los scripts **no aparecen en
el historial** ("Detectadas"). Hoy eso ya no deja ninguna sin configurar —para eso está la pestaña
Sistema, que las enumera todas aunque no se hayan disparado nunca—, que era el problema real que
esa consecuencia arrastraba. Ver `ags/CLAUDE.md`.

Se eligió el hint y no "casar por nombre de app" porque 44 de las 47 llamadas no pasan `-a`, así
que llegan como app `notify-send`: filtrar por ahí le habría puesto el skin también a cualquier
`notify-send` lanzado a mano desde una terminal. El hint es inequívoco y no cambia el nombre que
se ve. Ojo al leerlo en AGS: se saca con `hints.lookup_value()` de la clave suelta, **no** con el
`extractHints()` que ya existe — ese hace `recursiveUnpack()` de todo el `a{sv}`, y un
`image-data` trae los píxeles en crudo; hoy solo se libra de ese coste porque únicamente corre
cuando una regla reescribe texto.

### Agrupar ráfagas de notificaciones (`lib/notif-agrupar.sh`)

**Los eventos no vienen de uno en uno, y una tarjeta por evento no es "informar": es tapar.** Un
`pacman -Syu` toca decenas de rutas vigiladas; una GPU atragantada repite la misma línea NVRM
cuarenta veces; un hub con tres pendrives emite tres conexiones a la vez; un SSH expuesto recibe
cientos de `Failed password` por minuto; apagar el Bluetooth tumba a la vez los cascos, el ratón y
el mando. Como buena parte de esos avisos son **críticos con `-t 0`** (sin autocierre), la pila
resultante se despacha cerrándola en bloque sin leer nada — el mismo efecto práctico que apagar la
categoría entera, y por la misma razón que motivó la allowlist de `privEsc`: **una alerta que
satura enseña a ignorarla**.

La librería acumula por categoría y emite **una** notificación por categoría. Es ortogonal a
`lib/notif.sh`: aquella da IDENTIDAD (`x-gigios-event`), esta decide CUÁNDO y CUÁNTOS avisos
salen. **El resumen lleva el mismo id que el aviso individual** — quien silencia «errores de GPU»
quiere callados los dos.

**Dos relojes, y los dos hacen falta.** `NOTIF_CALMA` (4 s por defecto) son los segundos sin
eventos nuevos que cierran el grupo: es lo que hace que un evento **aislado** —el caso que de
verdad importa— siga avisando casi al instante. `NOTIF_TOPE` (20 s) es el máximo que la ventana
permanece abierta aunque los eventos no paren: **sin él, una actualización de sistema que genera
eventos durante minutos no cerraría la ventana nunca** y el aviso llegaría cuando ya no sirve;
con él sale un resumen cada 20 s mientras dure la ráfaga.

**El recuento del título cuenta EVENTOS, no líneas únicas**, y la distinción no es cosmética:
cinco fallos de sudo producen cinco veces exactamente el mismo texto, y colapsarlos a uno
convertiría un intento de fuerza bruta en un despiste. Se deduplica para la **lista** (con su
multiplicidad, `· <texto> (×5)`) mientras el total sigue siendo el real. **Salvo cuando el texto
repetido ES el mismo suceso visto dos veces**: `inotifywait` emite `create` **y** `close_write` por
un único cambio de fichero, y contarlos como dos anunciaría «3 archivos críticos modificados»
habiendo cambiado dos. Esas categorías se marcan con `notif_grupo_unico`. La regla para elegir:
¿dos textos iguales son dos sucesos, o uno contado dos veces? Sucesos (sudo, SSH, GPU) → por
defecto; el mismo (rutas de fichero) → `unico`. `NOTIF_LISTA=8` entradas
antes del «… y N más»; `NOTIF_CAP=300` entradas únicas retenidas — pasado ese tope el evento
**sigue contando** en el total pero deja de listarse, porque la deduplicación es un barrido lineal
y una ráfaga patológica lo volvería cuadrático.

**Con un solo evento el texto es el de siempre, palabra por palabra** (`título` + `<prefijo><texto><sufijo>`).
Agrupar no debe cambiar el caso de un evento — si lo cambiara, sería un rediseño disfrazado de
optimización.

**La ventana se implementa con el timeout de `read`** (`notif_leer` → `read -t`), sobre la misma
tubería que el bucle ya estaba leyendo. Con nada encolado el `read` bloquea **sin** timeout: en
reposo el bucle sigue costando ~0 % de CPU y **no hay ningún temporizador de fondo ni proceso
extra**. `rc > 128` es el vencimiento; cualquier otro fallo es fin de la tubería → volcar y salir.

**No todos los usuarios necesitan la ventana.** Cuando el lote ya existe por otro motivo, se usan
solo `notif_encolar` + `notif_volcar` y el reloj sobra: `monitor_units` vuelca al final de cada
pasada de `systemctl --failed`, el escáner de descargas al terminar de leer la salida de un
`clamscan`, `disk-monitor.sh` al acabar el barrido de `df`. Ahí agrupar **no retrasa nada**.

Quien la usa hoy: `oom-monitor.sh` (kernel, sistema, ficheros, unidades, malware), `usb-monitor.sh`,
`bt-monitor.sh` y `disk-monitor.sh`. **Excepciones deliberadas**: el **kernel panic** no se agrupa
(el sistema se está yendo y 4 s pueden ser más de lo que le queda a la sesión, y además no llega
en ráfaga), y la **tormenta de crashes** tampoco (ya es un resumen, con su propio límite de 1/60 s).

**Límite conocido:** lo encolado y aún no volcado se pierde si el proceso muere — como mucho una
ventana de `NOTIF_CALMA`. No se instala un trap a propósito: en un apagado el bus de
notificaciones se está cayendo también, así que el volcado de despedida no llegaría a ninguna
parte. Al recargar un monitor a mano (`pkill -f <script>` + relanzar) se puede perder lo de los
últimos segundos.

### Congelar tareas de fondo al jugar — y en modo ahorro (`lib/gaming-gate.sh`)

**El "modo juego" tiene dos mitades, y antes solo existía una.** El auto-DND ya callaba las
notificaciones mientras juegas, pero nada quitaba la CARGA: los sondeos de mantenimiento seguían
despertando discos, forkeando y tocando la red en mitad de una partida. `hypr/scripts/lib/gaming-gate.sh`
es la otra mitad — se **sourcea** (no se ejecuta) y expone `gaming_active` / `gaming_gate_wait`.

**No detecta nada nuevo**: reutiliza el flag que ya escribía AGS en `runtime-state.json`
(`servicios/energia/gamingState.ts`, que a su vez reutiliza el `isGameClient` de la barra). Bash no
sabría detectar un juego mejor que el shell.

**Qué se congela** — solo sondeo de mantenimiento, caro y sin nada urgente que mirar:
`updates-monitor.sh` (red + BD temporal de pacman), `monitor_smart` (smartctl **despierta cada
disco físico**) y `monitor_units` (4 forks de `systemctl` + awk cada 120 s). `monitor_downloads`
conserva su propia pausa `dlPauseWhileGaming` — más específica y ya tiene UI —, que es **la más cara
de todas** (clamscan recarga ~200 MB de firmas por invocación) y por eso **viene ACTIVADA por
defecto**, al revés que sus dos hermanas (`dlPauseOnBattery`/`dlPauseInPowerSave` siguen en `false`:
sacrificar seguridad por autonomía lo decide el usuario). De ahí que los defaults sean **por clave**
en `ags/modulos/ajustes/seguridad/preferencias.ts` y no uno común. En bash **no puede leerse con `.dlPauseWhileGaming // true`**:
el operador `//` de jq trata un `false` literal como ausente, así que apagar la pausa desde la UI no
habría servido de nada — va con la forma `if has(…)`, el mismo tropiezo ya documentado en
`battery-monitor.sh`.

**Qué NO se congela, y no es un olvido.** Los tres **seguidores** de eventos (`monitor_kernel`,
`monitor_system`, `monitor_files`) leen con `-n 0` a propósito y **no recuperan el pasado**:
congelarlos convertiría un OOM, un `sudo` fallido o un cambio en `/etc/shadow` en una **ventana
ciega**, y encima no ahorraría nada — bloqueados en `journalctl -f`/`inotifywait` ya cuestan ~0 %
de CPU. `temp-monitor.sh` tampoco: jugar es exactamente cuando la CPU y la GPU se cuecen, así que
congelar el termómetro apagaría la alarma en el único momento que importa. `ram-monitor` y
`battery-monitor` son bucles de builtins puros (cero forks por tick) y vigilan cosas que importan
MÁS con un juego delante. `usb`/`bt`/`wifi`/`screencast` son event-driven y de cara al usuario.
`disk-monitor` es one-shot: para cuando juegas ya salió.

**El gate BLOQUEA, no SALTA**: el trabajo aplazado se hace al descongelar, no se pierde. Por eso
va justo **antes del cuerpo del sondeo y después de la espera** — así `updates-monitor` sigue
bloqueado en su `inotifywait` (que no cuesta nada) y solo se retiene el `run_check`.

**"Juego abierto" no es "estás jugando", y confundirlos congelaba el mantenimiento el día entero.**
`gaming` vive hasta que la ventana **cierra** —a propósito: irte a otro workspace 30 s no es dejar de
jugar—, así que con eso solo, dejar un juego aparcado en el ws9 mientras trabajas bloqueaba
updates/SMART/units **indefinidamente y en silencio**. Por eso `gamingState.ts` publica además
`gameFocused` y `lastGameFocus` (epoch **absoluto**, por lo mismo que el `until` de `wakeup.json`:
la gracia se resuelve contra el reloj de pared sin que nadie reescriba el fichero, y no se desfasa
tras una suspensión). El gate congela si el juego **tiene el foco**, o si lo perdió hace menos de
`GAMING_FOCUS_GRACE` (5 min). La gracia evita el fallo contrario, que sería peor: descongelar en
cada alt-tab haría que un vistazo de 10 s a Discord lanzara `smartctl` y `clamscan` con el juego
cargado y a punto de recuperar el foco. Se escribe solo en la **transición** (el juego coge o pierde
el foco), no en cada cambio de ventana. Un fichero de un AGS anterior, sin esas claves, conserva el
comportamiento de antes (congelar mientras el juego viva) y se auto-corrige al reescribirse.
Verificado en vivo con eventos reales: abrir → congela; cambiar de workspace → sigue congelado
dentro de la gracia y descongela fuera de ella; volver al juego → **vuelve a congelar**; cerrar → libera.

**Al descongelar espera `GAMING_GATE_RESUME_DELAY` (5 s) antes de trabajar.** Al cerrar un juego el
sistema todavía está devolviendo RAM y VRAM y bajando relojes, y arrancar ahí mismo un `smartctl` o
un `clamscan` es justo el tirón que se nota al volver al escritorio. No le importa a nada de lo que
hay detrás del gate (el sondeo más frecuente es de 120 s) y **solo se paga si hubo congelación**: el
camino sin juego sale antes, sin dormir ni forkear.

**En `monitor_units` el gate se salta la PRIMERA pasada, y esa condición no sobra.**
`systemctl --failed` es estado de **nivel**, no de flanco: una unidad que caiga durante la partida
sigue en la lista al reanudar y se avisa entonces. Pero si el gate atrapara la pasada de **siembra**,
todo lo que hubiera fallado durante esas horas se sembraría como "preexistente" y no se notificaría
**nunca**. La siembra son 4 forks una sola vez: congelarla no ahorra nada y cuesta avisos.

**Fail-open, igual que la puerta del Wake up.** Sin fichero, con JSON corrupto, sin `pid` o con el
pid muerto, el gate responde "no estoy jugando" y **el trabajo se hace**. Un fallo aquí debe
degradar a "la congelación no funciona" —visible, y lo peor es un tirón en el juego— y nunca a "los
escáneres no vuelven a correr jamás", que es silencioso, permanente y no tiene UI donde notarse.
De ahí que `gamingState.ts` escriba ahora **también el pid de AGS**: mientras el flag solo pausaba
las descargas (opcional y por defecto apagado) que se quedara pegado en `true` daba casi igual;
ahora congela tres monitores más. La otra mitad de la cadena es que `initGamingState()` reescribe el
fichero al arrancar el shell, necesaria porque los pid **se reciclan**.

**Sin forks en el camino caliente**: el flag se lee con un redirect builtin + regex, no con `jq` —
un `jq` cada 10 s durante una partida de tres horas sería justo el coste que este gate existe para
quitar. El ajuste (`gamingFreeze` en `preferences.json`, ausente = activado) sí usa `jq`, pero
cacheado 30 s; se lee **en vivo**, no una vez al arrancar, porque es un control de recursos:
apagarlo descongela en ≤30 s sin reiniciar ningún monitor, incluso a mitad de partida.

**El mismo gate congela también en MODO AHORRO, y ese es su segundo motivo.** La lista de lo que
se congela es idéntica —sondeo caro y aplazable— porque la razón es hermana: al jugar el
mantenimiento molesta, con la batería baja **cuesta autonomía** (`smartctl` despierta discos,
`updates-monitor` enciende la radio). Lo decide AGS y llega **ya combinado** (ahorro activo **Y**
el interruptor de Ajustes > Energía > "Reducir procesos en segundo plano", `freezeBackground` en
`~/.config/power-save/config.json`, ausente = activado) como **`powerSaveFreeze`** en ese mismo
`runtime-state.json` — mismo fichero porque se reescribe **entero** en cada cambio y dos
escritores se pisarían; lo publica `gamingState.ts`, suscrito al estado de `powerState.ts`.

**Bash NO rederiva "¿estoy en ahorro?", y esa es la decisión.** Mirar `/sys/class/power_supply` a
mano ya salió mal una vez —lista también la pila del **ratón**, que reporta `Discharging` para
siempre (ver `_is_system_battery` en `oom-monitor.sh`)—, mientras que AGS ya tiene la respuesta
buena por upower y con el umbral que enseña la UI. Una sola fuente de verdad, y el error de
paralaje entre lo que dice Ajustes y lo que hace el gate deja de ser posible.

**Son dos interruptores, no uno**: `gamingFreeze` gobierna **solo** el motivo "juego" — apagar la
congelación al jugar no debe apagar la del ahorro, y al revés. Lo demás se comparte tal cual: la
guarda del `pid` de AGS, el fail-open (sin fichero, JSON corrupto, pid muerto o clave ausente → se
trabaja) y el bucle de espera, que **relee ambos motivos** en cada vuelta, así que salir del ahorro
—o desactivar el ajuste— descongela en ≤`GAMING_GATE_POLL` sin reiniciar ningún monitor.

**`GAMING_GATE_SLEEP` no es decorativo.** `updates-monitor` lo pone a `blocking sleep` porque bash
**difiere las señales** mientras espera a un hijo en primer plano: con un `sleep` normal, el `pkill`
del toggle maestro de AGS no mataría el script hasta acabar la espera. En `oom-monitor` los
sub-monitores ya duermen en primer plano, así que ahí `sleep` a secas es lo coherente.

### Escáner de apps al iniciar sesión (`gigios/escaner-apps.lua`)

Al empezar la sesión se abren ventanas **solas** (autostart, restauración de sesión) y no siempre
en el escritorio que estás mirando: acabas delante de uno vacío mientras tus apps están en otro.
Esto mira los primeros 30 s y te lleva donde hayan quedado. `0` ventanas nuevas → no hace nada;
**un** escritorio destino → salta a él; **dos o más** → llama a `GiGiOS.compactar()` y salta al
destino **más cercano** al activo (empate → id menor).

**Era un script de bash que parseaba el socket de eventos a mano**, con la trampa de que la
dirección de `openwindow>>` llega SIN el `0x` que sí trae `hyprctl clients` — cruzar ambas fuentes
sin normalizar daba cero coincidencias en silencio. Con `hl.on("window.open", …)` la ventana llega
ya tipada (`win.address` con su `0x`) y esa clase de fallo desaparece de raíz.

**La decisión se toma AL FINAL de los 30 s, no en cada evento, y esa es la diferencia entre la
función y un tic nervioso.** Saltar según llega cada `openwindow` haría rebotar el escritorio
activo cuatro o cinco veces mientras arranca la sesión — justo el desconcierto que esto viene a
quitar. El peaje aceptado es que la corrección llega a los 30 s, no al instante.

**Se registra a t=0, y es la excepción al calendario escalonado**: escucha las aperturas de ventana
desde el propio `hyprland.start`, y las apps de autostart abren **exactamente ahí**. Retrasarlo no
es apartarlo del pico de carga, es perderse las ventanas que existe para seguir — el mismo motivo
por el que `oom-monitor` no se retrasa entero. Ya no cuesta ni un proceso: es un callback del
compositor, y a los 30 s se desuscribe (`sub:remove()`) en vez de morir un `nc`.

**La dirección del evento viene SIN el `0x`** que sí trae `hyprctl clients` (`openwindow>>ADDRESS,
workspace,class,title`, y hay que cortar en la primera coma: la línea entera trae también
workspace, clase y título). Cruzar ambas fuentes sin normalizar da cero coincidencias **en
silencio** — el script recolecta bien, resuelve a lista vacía y sale con éxito sin saltar a ningún
sitio. Fue el primer fallo real y no da ningún error.

**Los escritorios se re-resuelven DESPUÉS de compactar**, porque `GiGiOS.compactar()` renumera:
un id leído antes de compactar apunta a otro sitio (o a nada) al terminar. Como la llamada es
síncrona, la re-resolución va justo detrás, sin temporizadores de por medio. Solo cuentan las
ventanas que **no existían** al registrarse (la base se toma con `hl.get_windows()`) — lo ya
abierto no es un autolanzamiento — y se ignoran los escritorios especiales, que no son una posición
donde dejar al usuario.

**Es de un solo disparo, no un vigilante permanente**, así que se aparta de la advertencia general
de los `*-monitor.sh`: lee su preferencia al cargar el config, mira 30 s y se desuscribe. No hay
proceso vivo que se quede ejecutando código viejo, ni hace falta `pkill` + re-exec al cambiar el
ajuste — se aplica en la próxima sesión, como `limpiezaPortapapelesAlIniciar`.

**Alcance real**: corre al arrancar **Hyprland**, no al volver de una suspensión o hibernación
(volver no reinicia el compositor, así que `hyprland.start` no se vuelve a disparar). Cubre el
autostart y cualquier restauración de sesión que ocurra tras un arranque completo.

La ventana de 30 s la cierra un `hl.timer` de un disparo. Toda la maquinaria que hacía falta en
bash —leer el socket con `nc -U`/`socat`, el sondeo de repliegue cada 2 s, distinguir "el lector no
ha dicho nada" de "no se ha abierto ninguna ventana"— desapareció con la reescritura: aquí los
eventos los entrega el compositor al callback.

**Ajuste**: `escanerAppsInicio` en `~/.config/gigios/preferences.json` (Ajustes > Personalización >
Ventanas y escritorios). **Ausente = DESACTIVADO**, al revés que la mayoría de claves de este
fichero: mover el escritorio activo por su cuenta es intrusivo y hay que optar a ello. Ese default
es también lo que hace seguro leerlo con `.escanerAppsInicio // false` — el tropiezo del operador
`//` de jq documentado en `gaming-gate.sh` (que trata un `false` literal como ausente) aquí da el
mismo resultado por ambos caminos. `GIGIOS_ESCANER_SEGS` acorta la ventana para probarlo sin
esperar medio minuto, la misma costura que `GIGIOS_USB_PENDING_DIR` en el monitor de USB.

### Que una ventana no acabe estrujada, al abrirse o al soltarla (`gigios/reparto-ventanas.lua`)

**El problema es del primer cálculo de tamaño, no del layout en reposo.** dwindle parte siempre la
ventana objetivo en dos, y el objetivo por defecto es la última que tuvo el foco en ese escritorio,
así que abrir cuatro terminales seguidas da una progresión geométrica, no un reparto — medido en
este equipo (escritorio de 2032x1098): **1014 · 504 · 252 · 250**. La quinta habría nacido con
125 px. Este módulo decide, en `window.open_early` (antes de colocarla, que es el único momento sin
cirugía sobre el árbol), **qué se parte** y **por qué lado**. Las mismas ocho terminales salen a
**504x547 cada una** (medido).

**Dos palancas, y la primera sola NO basta.** (1) *Qué*: se enfoca la ventana en mosaico **más
cercana al ratón de entre las que aún dan una mitad decente** — dwindle toma como objetivo la
última enfocada, así que enfocar es la única forma de redirigir el corte; el foco se lo lleva la
ventana nueva al mapearse, así que no se nota. (2) *Por dónde*: `preselect`, que fija dos cosas a la
vez — el **eje** sale del lado largo del objetivo (ancha → se parte en vertical, alta → se apila,
que es lo que convierte la progresión en rejilla) y el **lado**, de en qué mitad de esa ventana está
el ratón, porque `preselect <dir>` coloca la nueva en ese lado. Hace falta porque con `smart_split` el
eje **no sale de la forma de la ventana, sale del cuadrante del cursor sobre ella**, y al lanzar
desde Orion o rofi el cursor está donde lo dejaste: el eje sale a suertes y se repite igual ventana
tras ventana. Medido A/B sobre la misma ventana de 2032x1098: con smart_split, 2032x547 (apilada);
sin él, 1014x1098 (lo correcto para una apaisada). O sea que enfocar la mayor sin arreglar el eje
daba ocho tiras de **2032x134**. `preselect` tiene prioridad sobre el cuadrante, sobre `smart_split`
y sobre `force_split` (ya documentado en `gigios/keybinds.lua`, donde se usa para lo mismo en
SUPER+SHIFT+dirección), así que no hay que tocar `smart_split`, que sigue mandando en el arrastre.

**La cercanía al ratón es el SEGUNDO criterio, no el primero**, y el orden es lo que lo hace
funcionar: elegir por cercanía a secas devuelve el problema de partida, porque el hueco pegado al
cursor suele ser justo la rendija que acabas de crear. Primero se filtran las candidatas por si su
mitad da la talla y solo entre las que pasan gana la más cercana (a igual distancia, la más grande);
si no pasa ninguna —escritorio lleno— manda la mayor, porque ahí ya no se puede acercar al ratón sin
estrujar. Verificado en vivo con el mismo estado de partida y el ratón en las cuatro esquinas: con
el cursor dentro de una ventana de 506x547 (mitad 506x273 → no da la talla) la nueva sale partiendo
la de 504x1098 de al lado, **por arriba o por abajo según dónde esté el ratón**; con el cursor a la
derecha, parte la columna derecha, arriba o abajo igual. `hl.get_cursor_pos()` existe y devuelve
`{x, y}` — la ausencia de esa función se dio por supuesta al escribir la primera versión y era falsa.

**Es PREVENCIÓN, no una rejilla forzada**: mientras el sitio natural dé un tamaño razonable el
módulo **no interviene** y manda dwindle con su cuadrante. El listón se mide sobre la **peor mitad
posible** del objetivo natural — la que sale de partirlo por su lado **corto**, la más achatada de
las dos —, y se toma la peor porque la real depende del cursor y el cursor no se puede consultar
desde el config. Con dos ventanas de 1014x1098 la peor mitad es 507x1098 → cabe → la tercera nace
donde diga tu cursor; con cuatro de 1014x547 es 1014x273 → 273 < 320 → se interviene. Ese es
justo el punto en el que "una más" empezaba a estrujar.

**En un escritorio que NO se está viendo no se hace nada, y corregir solo el eje allí sale PEOR.**
Redirigir el corte exige enfocar, y enfocar en un escritorio oculto **arrastra la vista** a él
(medido: la sesión saltó al ws15 durante las pruebas), cosa que abrir una ventana no justifica. Y
sin poder redirigir el objetivo, el corte por el lado largo se ceba con la última ventana y la deja
cuadrada y diminuta: ocho terminales dieron **123x133** frente a las tiras de 252x1098 de dwindle a
secas. Misma área, peor forma — de ahí que se ceda entero. Afecta a lo que se lanza anclado a otro
escritorio.

**Otros límites**: no redistribuye lo ya abierto (es el cálculo de la ventana nueva); si la ventana
acaba flotando por una regla —las reglas aún no están aplicadas en `open_early`— la intervención se
deshace sola en `window.open` (`preselect none` + devolver el foco), y una red de 2 s cubre que
`window.open` no llegue nunca, porque **un `preselect` sin consumir se lo come la SIGUIENTE ventana
que abras**. Con el escritorio ya lleno interviene igual aunque no pueda arreglarlo: partir la mayor
por su lado largo sigue siendo la opción menos mala. Quien decide que ya no cabe nadie es
`gigios/limite-ventanas.lua`, que corre después.

**Al SOLTAR una ventana arrastrada (SUPER + arrastrar) manda la otra palanca: quitarle sitio a los
vecinos.** Es el otro momento en el que un tamaño se decide de golpe — dwindle reinserta la ventana
partiendo el destino en dos, así que soltarla sobre una ventana ya pequeña la deja en la mitad de
poco. Aquí el destino **no** se puede elegir (lo has elegido tú con el ratón), así que si la ventana
cae por debajo de los mínimos se la ensancha con `resizeactive exact`, que mueve las proporciones
del árbol: el hueco sale de **encoger al vecino**, no de tapar a nadie. Se pide **solo el mínimo**,
nunca más — el sitio se le quita a otro y pasarse sería resolver un estrujón creando otro. Medido:
un drop que iba a quedar en 2032x**273** sale en 2032x**320** y el vecino baja de 547 a 223.

**La detección del soltar son dos binds MÁS** sobre `SUPER + mouse:272` (uno normal y otro con
`{release = true}`) que llaman a `GiGiOS.reparto_arrastre_inicio/fin`. Hyprland ejecuta **todos** los
binds de una combinación, así que conviven con el `bindm` nativo — verificado con un **ratón virtual
por uinput** haciendo el arrastre de verdad. Ojo: esto es `release`, **no** el `drag` de la
advertencia de `keybinds.lua`, que sí se come el primer arrastre de cada sesión.

**AL PULSAR NO SE VALIDA NADA, y ese fue el fallo que costó la tarde.** Cuando llega la pulsación,
el `bindm` nativo ya se ejecutó y la ventana **está flotando**: así dibuja Hyprland el arrastre (la
saca del mosaico y la reinserta al soltar). Descartar lo flotante ahí —lo primero que uno escribe—
hacía que la foto no se tomara nunca y que **todo esto no hiciera nada, sin un solo error**. La
geometría en ese instante sí es todavía la del mosaico. Las comprobaciones van al soltar, donde el
estado ya es el bueno; una ventana que **ya** flotaba sigue flotando allí y se descarta entonces.

**El press guarda la geometría para distinguir un arrastre de un SUPER+clic que no movió nada**, y
la comparación lleva **tolerancia de 16 px**, no una igualdad: un clic sin desplazamiento tampoco
deja la geometría intacta —Hyprland saca y mete la ventana igual, y las proporciones bailan unos
píxeles (medido: 223 → 220)—, así que con `==` un simple clic podía acabar ensanchando la ventana.
Con la tolerancia, tres clics seguidos sobre la más pequeña no mueven nada (medido).

**Trampas medidas**: `at` y `size` de una `HL.Window` son tablas **`{x=, y=}`, no arrays** — un
`v.size[1]` devuelve `nil` en silencio, el área sale 0 y toda comparación de tamaño pasa a ser
cierta (el módulo creía que todo cabía y no intervenía nunca, sin un solo error). Y
`hl.dsp.window.resize` **ignora `window = ...`**: redimensiona **siempre la activa**, también sin
avisar (medido: pidiendo agrandar tst3 se agrandó tst2). Por eso el drop comprueba que la activa
siga siendo la ventana que soltaste antes de tocar nada.

**Ajustes** en `~/.config/gigios/preferences.json`, sin UI (como `maxVentanasEscritorio`):
`repartoVentanas` (**ausente = activado**, se comprueba `== false`), `anchoMinimoVentana` /
`altoMinimoVentana` (**ausentes = 480x320**; los dos a 0 lo desactivan). Se leen por `util.prefs()`,
o sea una vez por ejecución del config: cambiarlos pide un `hyprctl reload`.

### Tope de ventanas en mosaico por escritorio (`gigios/limite-ventanas.lua`)

Pasadas unas cuantas ventanas en mosaico el escritorio deja de ser útil: dwindle sigue partiendo el
espacio y acabas con columnas de 200 px. Este módulo pone un techo (**8** por defecto) y, cuando
una ventana nueva lo rebasaría, la **mueve al primer escritorio con sitio**.

**Hyprland NO tiene esta opción** — no existe ningún `max_tiled_windows` en 0.56 ni en el stub de
la API Lua (`/usr/share/hypr/stubs/hl.meta.lua`). Lo que sí hay ya es con qué implementarla desde
el config: `window.open` tipado + `hl.dsp.window.move` con selector por objeto. En hyprlang habría
sido un daemon leyendo el socket de eventos y cruzando direcciones con `hyprctl clients` —el
montaje de `escaner-apps.sh`, con su trampa de las address sin `0x`—; aquí son 40 líneas dentro del
propio config, sin proceso vivo, así que se aparta de la advertencia general de los `*-monitor.sh`
(no hay nada que `pkill`ear: basta `hyprctl reload`).

**El límite es del MOSAICO, no de ventanas**, y por eso se descuentan tres cosas: las **flotantes**
(ni cuentan ni se mueven — no compiten por el espacio del layout, y desterrar un diálogo o un PiP
"porque el escritorio está lleno" no tiene sentido), las **ocultas** (`hidden`, una terminal tragada
por `swallow`: existe pero no ocupa hueco) y los escritorios **especiales** (el scratchpad no es un
sitio donde imponer un tope ni donde dejar al usuario). Verificado en vivo con el tope a 2: la
tercera en mosaico salta, y una cuarta que abre flotante no cuenta ni desplaza a nadie.

**Se sigue a la ventana (`follow = true`), al revés que en `compactar.lua` y en el anclaje.** El
usuario acaba de lanzar la app, y el peor fallo aquí sería que su ventana desapareciera en silencio
a un escritorio que no sabe cuál es. El escritorio lleno se queda como estaba y tú vas donde fue la
ventana. Se cambia con `SEGUIR = false`, pero entonces hay que avisar de algún modo o la app
parecerá no haber arrancado.

**Con el anclaje hay que ARBITRAR, y el árbitro está en `anclaje.py`, no aquí.** Las dos funciones
tiraban en direcciones contrarias y ganaba el anclaje por llegar el último: el tope apartaba la
ventana nueva de un escritorio lleno y te llevaba con ella, y acto seguido el `openwindow` llegaba
al observador, que la veía "descolocada" respecto al escritorio de lanzamiento y la devolvía **en
silencio**. Resultado: tú en el escritorio nuevo y la ventana en el viejo —peor que cualquiera de
las dos funciones por separado, sin ningún error— y la novena ventana otra vez apretujada con las
ocho. Hoy `_hueco_en()` (en `anclaje.py`) **replica el recuento de este módulo** —solo mosaico, ni
flotantes ni ocultas, sin contarse a sí misma— y **no ancla si el destino está lleno**. La
jerarquía: el lanzador decide **dónde nace** la ventana, el tope decide **si ahí cabe**, y manda el
tope porque es el único de los dos que sabe algo que el lanzador no podía saber al lanzar. Si
cambias el criterio de recuento de aquí, hay que cambiarlo **en los dos sitios** o vuelve el tira y
afloja. Verificado en vivo con el tope a 2, por los dos caminos: lanzar sobre un escritorio lleno
deja la ventana en el nuevo (no vuelve), y lanzar sobre uno con hueco **sigue anclando** como
siempre.

**Ajuste**: `maxVentanasEscritorio` en `~/.config/gigios/preferences.json`. **Ausente = 8
(activado)**; un valor **≤ 0 lo desactiva**, y esa vía hace falta precisamente porque el default es
"encendido" (borrar la clave no lo apaga). Se lee por `util.prefs()`, o sea una vez por ejecución
del config: cambiarlo pide un `hyprctl reload`. El barrido de candidatos sube desde el escritorio
actual hasta `WS_MAX` (20) y luego da la vuelta por debajo; un escritorio que aún no existe cuenta
como vacío y Hyprland lo crea al mover. Si **no hay sitio en ninguno**, la ventana se queda donde
estaba: apretujar es mejor que mandarla a un escritorio igual de lleno.

### Anclar las ventanas al escritorio donde las lanzaste (`anclaje.py` + los dos lanzadores)

Abres una app, te vas a otro escritorio mientras carga, y la ventana aparece **donde estás** en vez
de donde la abriste. `hypr/scripts/anclaje.py` es el motor que lo corrige, y lo comparten los **dos**
lanzadores: `rofi-launch.py` (SUPER+SPACE) y `lanzar-anclado.py`, por el que **Orion** abre sus apps
(`ags/modulos/orion/data/launch.ts`). Antes solo lo tenía rofi y Orion hacía `sh -c <exec>` a pelo,
así que la misma app se comportaba de una forma u otra según por dónde la abrieras.

**Dos mecanismos, no uno, y el orden importa.** `lanzar-anclado.py` lanza con
**`hyprctl dispatch exec [workspace N silent] <cmd>`**: la ventana **nace** ya en su escritorio. Antes
se lanzaba a secas y se corregía con un `movetoworkspacesilent` al llegar el `openwindow`; el
resultado final era el mismo, pero por medio la ventana llegaba a **mapearse en el escritorio
equivocado** — un parpadeo de un frame, un amago de render que ni siquiera recolocaba las ventanas
que ya había allí. Con la regla ese instante no existe. Medido con el socket de eventos:
`openwindow>>…,2` + `movewindow>>…,1` (antes) frente a `openwindow>>…,1` y ningún `movewindow`
(ahora). El **`silent`** es obligatorio —sin él, lanzar algo destinado a otro escritorio te
arrastraría allí, justo lo contrario de lo que se busca— y **no rompe el foco** en el caso normal de
lanzar en el escritorio en el que ya estás (medido).

**La regla solo cubre la PRIMERA ventana**, así que el observador de `anclaje.py` sigue haciendo
falta y no es redundante. Medido con un comando que abre dos ventanas separadas 2 s: la primera nace
en el escritorio de la regla, la segunda nace en el activo. O sea que la regla mata el artefacto en
el caso que pasa siempre (una app, una ventana) y el observador queda como red para splashes y
multiventana —ahí sí con el parpadeo— y para la rama `urgent`, que trae al escritorio actual una app
single-instance ya abierta. **Rofi no puede usar la regla**: en modo `drun` ejecuta el `Exec` del
`.desktop` él mismo, así que no hay dónde interponerla y conserva el parpadeo.

**El observador**: escucha el socket de eventos hasta 15 s, deduce la identidad de la app de la
**primera ventana nueva** (`initialClass` + pid) y a partir de ahí solo ancla lo que coincida en
clase o cuelgue de ese árbol de procesos — sin eso se llevaba al escritorio de lanzamiento cualquier
diálogo o popup ajeno que naciera en esa ventana de tiempo. Los 15 s salen de medir el peor caso
real (Steam: tres ventanas, la última a los 10 s). El detalle completo del diseño está en el
docstring de `anclaje.py`.

**Ninguno de los dos es un daemon**, así que se apartan de la advertencia general de los
`*-monitor.sh`: nacen de cero en cada lanzamiento, leen el ajuste y mueren. No hay que hacerles
`pkill` + re-exec al cambiar la preferencia.

**Ajuste**: `anclarVentanasRofi` en `~/.config/gigios/preferences.json` (Ajustes > Personalización >
Ventanas y escritorios), **ausente = activado**. Es **una sola clave para los dos lanzadores** a
propósito: para quien la usa es una única función, y partirla solo permitiría dejarla a medias. El
nombre dice "Rofi" por historia —renombrarla apagaría el anclaje en silencio en la máquina que ya
tiene la clave escrita— y no por alcance. Cuando está **desactivado no se pone la regla** tampoco:
el ajuste significa "que cada ventana aparezca donde yo esté", y fijarla al escritorio de
lanzamiento sería justo lo que se apagó.

**El anclaje CEDE ante el tope de ventanas por escritorio.** Antes de traerse una ventana al
escritorio de lanzamiento, `_hueco_en()` comprueba que ahí quepa según `maxVentanasEscritorio`
(mismo recuento que `gigios/limite-ventanas.lua`: solo mosaico, sin flotantes ni ocultas, sin
contar la propia ventana); si está lleno, **no la ancla** y la deja donde el tope la puso. Sin eso
las dos funciones se deshacían mutuamente y te quedabas mirando un escritorio distinto del de tu
ventana. Ver la sección del tope para el porqué de la jerarquía. Los clientes se piden **una sola
vez por ventana nueva** y de ahí salen el cliente y el recuento: antes eran dos forks de `hyprctl`
y, peor, dos instantes distintos.

**Fallos: siempre hacia "se abre sin anclar", nunca hacia "no se abre".** Sin socket, sin Hyprland o
con un `dispatch` rechazado se relanza por `sh -c`. Ojo con lo último: **`hyprctl` no señala un
dispatch rechazado en el código de salida**, responde `ok` en el stdout, así que mirar solo el
`returncode` daría por bueno un fallo y la app no se lanzaría por ningún camino.

**El lado de la barra**: un traslado silencioso **no emite `notify::clients`** (que es de altas y
bajas, no de movimientos), así que `ags/modulos/barra/escritorios/Escritorios.tsx` escucha además **`client-moved`**.
Sin eso los iconos de la barra se quedaban en el escritorio donde nació la ventana hasta que otra
cosa forzara un refresco. Ver `ags/CLAUDE.md`.

### SUPER + tecla sin atajo no debe escribirse (`gigios/nop-binds.lua`)

Con SUPER pulsado, una tecla que **no** forma un atajo llegaba a la aplicación: `SUPER+C` escribía
una `c`. Es al revés que en Windows, donde la tecla Win sin atajo no hace nada.

**No hay opción global para esto: Hyprland solo se traga una tecla si algún bind la captura.** El
candidato obvio es `catchall`, y el compositor lo rechaza — medido, no supuesto: responde *«Invalid
catchall, catchall keybinds are only allowed in submaps»*. La API Lua tampoco lo trae:
`HL.BindOptions` no tiene `catchall` ni `any`. Así que la única vía es **enumerar** una combinación
por tecla (letras, dígitos, puntuación, F1–F12, teclado numérico, navegación y edición; para
`SUPER`, `SUPER SHIFT`, `SUPER CTRL` y `SUPER ALT`).

**Antes era un fichero generado de 335 líneas** (`keybinds-nop.conf`) más su generador
(`generar-nop-binds.sh`), que parseaba `hyprctl binds` para saber qué combinaciones estaban ya
usadas. Hoy son **~10 líneas de bucle** en `gigios/nop-binds.lua`, y esa es una de las tres cosas
que pagaron la migración a Lua ella sola: al vivir dentro del mismo config, la lista de "lo que ya
es un atajo" **no hay que descubrirla** — la tiene delante.

**El envoltorio `bind()` de `gigios/keybinds.lua` es lo que lo sostiene**: anota cada combinación
(normalizada: mods ordenados y en mayúsculas, así `"SUPER SHIFT + E"` y `"shift+super+e"` casan) en
una tabla `usados`, que `nop-binds` consulta. **Todo atajo nuevo debe pasar por ese envoltorio**, no
por `hl.bind` directo. Saltárselo **no da ningún error**: solo deja esa combinación con dos binds
—el tuyo y un sordo de más—, que Hyprland ejecuta ambos, así que es inofensivo pero deja los sordos
sin reflejar la realidad. Hay un aviso gordo en la cabecera del módulo por eso.

**El no-op es `hl.dsp.no_op()`, nativo.** Antes era `submap, reset`, que solo era inerte *mientras
no existiera ningún submap* en toda la configuración — una trampa que había que documentar y que
aquí desaparece.

**Ya no hay nada que regenerar ni que se pueda desincronizar**: el bucle se recalcula en cada carga
del config. El gesto de "recoger los atajos nuevos" (activar el ajuste para forzar una
regeneración) dejó de existir porque dejó de hacer falta.

**Ajuste**: `absorberSuperSinAtajo` en `~/.config/gigios/preferences.json` (Ajustes >
Personalización > Ventanas y escritorios), **ausente = activado** — ojo al leerlo, se comprueba
`== false` explícitamente, porque un `nil` tiene que activar. Se aplica **en caliente**: el setter
de AGS escribe la preferencia (síncrono) y dispara `hyprctl reload`, que re-ejecuta el config y
vuelve a decidir. Desactivado, los sordos sencillamente no se registran: no queda ningún fichero
residual que borrar ni comentar.

### Escritorio ancla: ir y volver (`gigios/ancla-escritorio.lua`)

`SUPER + SHIFT + S` marca el escritorio actual como **ancla** (repetido ahí mismo, lo desmarca) y
`SUPER + S` es el vaivén: **fuera** del ancla te lleva a ella apuntando de dónde venías, y **en**
ella te devuelve a ese sitio apuntado. `vuelta` se reescribe en **cada** salto hacia el ancla, así
que "volver" significa el sitio desde el que hiciste el **último** salto, no un historial — si tras
saltar a la ancla te vas a otro escritorio a mano y pulsas otra vez, el que se apunta es ese
(verificado en vivo con los dos recorridos).

**Sustituyó al workspace especial `magic`**, que ocupaba esas dos teclas y **no estaba roto**: los
binds se registraban, el dispatcher respondía y con una ventana dentro se veía a pantalla completa
(todo medido antes de tocar nada). Lo que fallaba era el único estado en el que uno lo prueba —
`misc.close_special_on_empty` lo **destruye al quedarse vacío**, y un especial vacío que se abre no
dibuja **nada**: ni marco, ni fondo, ni aviso. O sea que parecía muerto sin dar ningún error. Si
alguien lo quiere de vuelta, el porqué y los dos dispatchers están en el comentario de
`gigios/keybinds.lua`, junto a los binds nuevos.

**El estado va a un FICHERO, no a un local de Lua**, y ahí se aparta a propósito de
`GiGiOS.toggle_gaps()`: en el toggle de gaps el `hyprctl reload` resetea a la vez el flag y los
gaps, así que quedan coherentes; aquí no hay nada en el compositor que resetear, y un reload
borraría el ancla **sin que se note** hasta que pulsaras el atajo y no fuera a ninguna parte. Y los
reloads no son raros: AGS dispara uno al tocar `absorberSuperSinAtajo`, entre otros (verificado que
el ancla sobrevive a un `hyprctl reload`). Vive en `$XDG_RUNTIME_DIR/gigios-ancla-escritorio`
(tmpfs), que da justo la duración que se quiere: **por sesión**, como el Wake up. En `~/.config`
sobreviviría a un reinicio y acabarías saltando a un escritorio de ayer.

**Fail-open hacia "el atajo no hace nada"**: todo va en pcall y cualquier error —fichero ilegible,
contenido a medias, la API devolviendo `nil`— degrada a "no hay ancla", que se arregla volviendo a
anclar. Lo contrario (saltar a un escritorio cualquiera por leer mal un número) movería al usuario
de sitio sin que lo pidiera, que es el fallo molesto de verdad. Por lo mismo, un id `<= 0` en el
fichero cuenta como "ninguno". Los **especiales** quedan fuera (ni se anclan ni se apuntan), igual
que en `limite-ventanas.lua` y `compactar.lua`.

**Cada gesto avisa en pantalla** (`util.notificar`, 2 s). No es adorno: anclar es invisible por
definición —no mueve nada—, y callar ahí reproduce exactamente el fallo del scratchpad, que es
"pulso y no sé si ha pasado algo". Por eso también habla el caso "estás en el ancla pero aún no hay
sitio al que volver". De ahí el `opts.crudo` nuevo de `util.notificar`: quita el prefijo
`[GiGiOS Lua]`, que existe para distinguir un **fallo del config** de un aviso de otro programa y
que en una confirmación rutinaria se lee como un error. Los avisos de fallo siguen con prefijo.

### Update monitor (`updates-monitor.sh`)

Checks for pending updates and surfaces the **important** ones as bar icons (AGS
`modulos/barra/indicadores/sistema/Actualizaciones.tsx`): **two separate icons, one for the kernel (orange Tux) and one
for GPU drivers (green)**, each shown only when its own category has something pending.
Ordinary package/dependency updates deliberately show **no icon at all** — they were pure noise;
they are only listed as context ("Otros: N paquetes") inside the popover. Launched from
`gigios/autostart.lua` as `sleep 20 && …/updates-monitor.sh` — el retardo deja que el resto de la
sesión termine de cargar antes de la primera consulta, que toca **red** y sincroniza una BD
temporal de pacman (eran 3 s; se subió a 20 al escalonar el arranque). El retardo va ahí y no
dentro del script porque el toggle maestro de AGS lo re-ejecuta en caliente, y ahí sí se quiere
inmediato.

**A package-DB watch is what makes the icon go away after you update.** Periodic re-checks alone
left the icon stuck: `updates.json` kept advertising what you had just installed until the next
interval elapsed. So the loop blocks on `inotifywait` over the distro's local package DB
(`/var/lib/pacman/local`, `/var/lib/dpkg`, `/usr/lib/sysimage/rpm`→`/var/lib/rpm`) *or* the
periodic timeout, whichever comes first. An install touches the DB hundreds of times, so an
event is followed by a **debounce** (re-check only after 5 s of quiet). This fires whether you
updated from the popover's button or from your own terminal. Without `inotify-tools` it degrades
to the plain interval sleep (and, if `updatesPeriodic` is off, simply exits after one pass).

Every blocking wait (`inotifywait`, `sleep`) goes through the `blocking()` helper — child in the
background + `wait` + a `TERM` trap — **not** a plain foreground call. Bash defers signals while
waiting on a foreground child, so a foreground `inotifywait` (which can block indefinitely) would
make the master toggle's `pkill` a no-op: the script would survive, later notice a DB change, and
rewrite `updates.json`, resurrecting the icons with the feature switched off.

All polling is **read-only and sudo-free**, one branch per distro family detected from
`/etc/os-release`: Arch/CachyOS → `checkupdates` (pacman-contrib; syncs a *temp* DB in the
user cache, never the system one; falls back to `pacman -Qu`), Fedora → `dnf -q check-update`
(rc 100 = updates), Debian/Ubuntu → `apt list --upgradable` **against the existing cache, no
`apt update`**. Each pending package lands in one of three buckets: *GPU driver* (name matches a vendor actually
present per `lspci` — `*nvidia*`, or `*mesa*`/`*radeon*`/`*amdgpu*`/`*amdvlk*` for AMD), *kernel*
(`linux`, `linux-*`, `kernel`, `kernel-*` — so `util-linux` does **not** match), or *system*
(everything else, counted only). Results are written **atomically** (tmp+`mv`, built with `jq` so
names/versions are escaped) to `~/.config/gigios/updates.json`:
`{checkedAt, distro, updateCmd, system: <count>, kernel: [{name, from, to}], gpu: [{…}], systemSample: [<=20 names]}`.
The widget watches that file with a `Gio.FileMonitor` — a missing/corrupt file simply means
"no updates" (icons hidden). Requires `jq`; without it the script exits without writing.

**Config** (`~/.config/gigios/preferences.json`, written by `PersonalizationSection.tsx`):
`updatesMonitor` (master), `updatesPeriodic`, `updatesIntervalHours` (default 3). Like
`batteryMonitor`/`tempMonitor`, the bash reads these **once at process start** — but the
*master* toggle is applied hot by its AGS setter (`pkill` + delete the JSON on off, re-exec on
on), so only the periodic/interval keys need a script restart.

### Screencast monitor (`screencast-monitor.sh`)

Detecta que **algo está capturando la pantalla** y lo publica en
`~/.config/gigios/screencast.json` (`{active, checkedAt, sources:[{kind:"share"|"record", app}]}`,
escrito atómicamente con `jq` + tmp/`mv`, y **solo cuando el conjunto de fuentes cambia** — así
compartir dos horas no reescribe el fichero ni despierta al widget; pero el memo que decide "ha
cambiado" arranca con un **centinela**, no vacío: si arrancara vacío, el primer sondeo sin nada
capturando se compararía consigo mismo y no escribiría, dejando en pie el JSON de la sesión
anterior — un "Discord compartiendo" sobrevivía al reboot y el icono se quedaba encendido). Lo consume
`ags/modulos/barra/indicadores/sistema/CapturaPantalla.tsx` con un `Gio.FileMonitor`; fichero ausente = nada
capturando = icono oculto.

Un único coordinador conserva en memoria dos estados, porque las formas de capturar no comparten
mecanismo. **Compartir pantalla** (Discord, OBS, Zoom, navegadores) pasa por
`xdg-desktop-portal-hyprland`, que crea un nodo PipeWire `Video/Source`: `pw-mon -p` alimenta un
filtro `awk` que recuerda los ids de los nodos/enlaces de vídeo y descarta todos los demás
eventos (incluido el audio); después de cada ráfaga espera **300 ms reales sin otra señal** y
solo entonces ejecuta un `pw-dump`. No se hace una consulta por cada línea encolada. Se filtra
por nodo del portal y se **excluyen las cámaras** (`v4l2_*`/`libcamera*`) para que la webcam no
encienda el icono;
además, el nodo debe estar **`running` o tener un link `active`**: Discord/Electron puede dejar
un nodo `idle` huérfano al terminar de compartir, y contar su mera existencia mantenía el icono
encendido aunque ya no hubiera captura. Cuando PipeWire lo expone, se sigue el link activo hasta
el nodo `Stream/Input/Video` para nombrar la app consumidora (si no, la etiqueta cae a
"Pantalla"). **Grabar en local** (`wf-recorder`, `gpu-screen-recorder`, `wl-screenrec`, `obs`)
usa wlr-screencopy y **no toca PipeWire**: no hay señal a la que suscribirse, así que ahí se
sondea solo `pgrep` cada 3 s, sin volver a ejecutar `pw-dump`. El coordinador combina ambos
resultados y escribe únicamente si cambia el conjunto final; no usa estado auxiliar en disco.

El trap `TERM` mata al coproceso **y a sus hijos** (`pw-mon`, `awk`) y borra el JSON. El
coproceso se ejecuta con un argv propio (`gigios-screencast-events`): si heredara
`screencast-monitor.sh`, el `pkill -f` del toggle mataría padre e hijo a la vez y podría dejar
`pw-mon` huérfano antes de que el padre hiciera la limpieza. Requiere `jq` y `pw-dump`;
sin ellos sale sin escribir.

**Filtro de PipeWire, medido en esta máquina (no supuesto):** el nodo del portal se identifica
por `node.name == "xdg-desktop-portal-hyprland"` (**no** `xdpw-stream-*`, como se asumía antes de
medir). La webcam es también `media.class=Video/Source` (`node.name=v4l2_input.*`), por eso
excluirla con `v4l2_*`/`libcamera*` es obligatorio, no una precaución de más. La app consumidora
**sí es resoluble**: siguiendo el link (`link.output.node` del nodo del portal →
`link.input.node` de un nodo `Stream/Input/Video`, ambos números en los props) se llega a un nodo
cuyo **`node.name`** trae el nombre ("Discord") — `application.name` viene **vacío** en ese nodo,
así que el orden de preferencia es `application.name // node.name // application.process.binary
// "Pantalla"`.

**Config**: `screencastIndicator` en `~/.config/gigios/preferences.json` (ausente = activado),
leído **una vez al arrancar** — pero el toggle es maestro y su setter de AGS lo aplica **en
caliente** (`pkill` + borrar el JSON al apagar; re-exec al encender), así que no hace falta
reiniciar nada.

### USB (`usb-monitor.sh`, `usb-eject.sh`, `usb-repair.sh`) + `system/udev/`

**La raíz del problema con los USB no es el shell, es `vm.dirty_ratio`.** Linux acepta hasta el
10 % de la RAM en páginas sucias (aquí ~1,5 GB) antes de forzar el volcado, así que una copia a un
pendrive lento se traga los datos a velocidad de RAM: el diálogo llega al 100 % y "termina" en
segundos con cientos de MB aún sin bajar al dispositivo. Al retirarlo — aunque sea minutos después —
el kernel escupe `Buffer I/O error on dev sdb1 … lost async page write` y los datos **se han perdido
de verdad** (a nosotros el volumen NTFS nos quedó `Mark volume as dirty`). Por eso el síntoma solo
aparecía **al mover archivos**: sin escrituras pendientes no hay writeback que fallar.

La cura vive fuera del repo, en `system/udev/99-gigios-usb-writeback.rules`. La instala **`install.sh`
(paso 6)** con `install -Dm644` en `/etc/udev/rules.d/`; en una máquina ya montada hay que copiarla a
mano con `sudo`. **No** es un symlink, y no puede serlo: udev lee `/etc` antes de que `$HOME` esté
montado, y apuntar `/etc` a un directorio escribible por el usuario sería una escalada silenciosa.
La regla baja `bdi/max_bytes` a 16 MiB y pone `strict_limit=1` **solo** en almacenamiento externo. La barra de progreso pasa a ser honesta. Dos detalles medidos, no supuestos:
el `bdi` cuelga del **disco entero** (`/sys/block/sdb/bdi`), las particiones **no tienen `bdi` ni
`removable`** propios → la regla apunta al disco; y se filtra por **`ID_BUS=="usb"`, no por
`removable=="1"`**, porque los **discos duros USB externos reportan `removable=0`** (lo extraíble es
la carcasa, no el medio) y se habrían quedado fuera justo los que más datos mueven.

`usb-monitor.sh` escucha **dos subsistemas en un solo stream** (`usb` + `block`). Un pendrive genera
eventos de ambos, así que sin cuidado saldrían **dos popups** por enchufe: si el dispositivo es de
clase *mass storage* el aviso genérico **se calla** y habla el evento de bloque, que sabe el modelo
y puede ofrecer botón.

**Deducir la clase del evento del `usb_device` no basta, y cuando falla salen los DOS popups.** Se
miraba solo `ID_USB_INTERFACES` (contiene `:08` — las entradas son de 6 dígitos entre `:`, así que
`":08"` solo puede casar al principio de una). Esa heurística falla en dos direcciones: hay bloques
de evento que llegan **con las propiedades a medias** (de ahí el "USB conectado — *dispositivo
desconocido*", que además delata que tampoco venía `ID_MODEL`), y hay dispositivos que se enganchan
a `usb-storage` por una interfaz de clase **propietaria** (`ff…`: lectores de tarjetas, algunas
carcasas) sin ningún `:08` que mirar. En ambos casos salta el genérico y **acto seguido** el de
almacenamiento con el nombre bueno.

Hoy la señal no es la clase declarada sino el hecho **observado** de que el dispositivo acabe
exponiendo un dispositivo de bloque — que solo se sabe unos instantes después. El aviso genérico se
**retiene 3 s** (`DEFER_SECS`) y se **cancela** si en esa ventana llega un evento de bloque de *ese*
dispositivo. El enlace entre ambos es `DEVPATH`: el del bloque cuelga del árbol del `usb_device`
(`…/usb1/1-5` → `…/usb1/1-5/1-5:1.0/host…/block/sdb`), o sea que el del padre es **prefijo** del
hijo. Es una relación exacta, **no una correlación por tiempo**: dos dispositivos enchufados a la
vez no se cancelan el uno al otro (verificado). El diferido también cubre el caso de tirar del
pendrive antes de los 3 s, que antes sacaba un "conectado" **después** del "desconectado".

Los pendientes son un fichero por aviso en `$XDG_RUNTIME_DIR/gigios-usb-pending/` (con su `DEVPATH`
y su etiqueta dentro), y quien dispara **reclama el suyo con un `mv`** antes de notificar: el
rename es atómico y falla si ya no está, así que no hay ventana entre "compruebo que sigue vivo" y
"notifico" por la que una cancelación pueda colarse. El directorio se **borra al arrancar** el
script porque un proceso anterior muerto a mitad deja huérfanos que nadie reclamaría.

**Al DESCONECTAR el duplicado tiene la misma raíz, pero se arregla al revés.** Un dispositivo
compuesto o detrás de un hub expone **varios `usb_device` anidados**, y el kernel emite un `remove`
por cada uno; como el aviso colgaba de ese evento, salían dos popups por un solo tirón — y el del
nodo padre no suele traer `ID_MODEL`, de ahí el "dispositivo desconocido" que acompañaba al bueno.
(Es también la otra mitad de la causa en la conexión: ahí el que se cuela es el padre, y el
diferido ya lo cancela porque el `DEVPATH` del bloque cuelga de él.) En la desconexión no hay
ningún evento posterior que sirva de prueba, así que en vez de cancelar se **fusiona**: el aviso se
retiene `DEFER_SECS` y los removes emparentados por `DEVPATH` colapsan en uno solo con el mejor
nombre disponible.

La regla de fusión es **asimétrica a propósito**, y esa asimetría es lo que la hace correcta llegue
el padre antes o después que los hijos (el kernel suele emitir hijo→padre, pero no se depende de
ello): si el entrante **desciende** de un pendiente lo absorbe y se queda con **su** `DEVPATH` —el
más profundo, que es la función real y la que tiene nombre—; si el entrante es **antecesor** de un
pendiente se **descarta**, porque el hijo ya cubre ese tirón, y solo le cede su etiqueta si el hijo
venía sin nombre. Guardar el `DEVPATH` **más profundo** es justo lo que evita colapsar **hermanos**:
al retirar un hub con tres pendrives, los tres son hermanos entre sí (ninguno desciende de otro) →
**tres** avisos, y el remove del hub se descarta; si se guardara el del hub, los tres se fundirían
en uno. Verificado con A/B sobre seis escenarios (anidado en los dos órdenes, hub con 3 discos,
hijo sin nombre y padre con él, suelto, y dos dispositivos a la vez): el original saca 13 avisos,
el nuevo 9 — uno por dispositivo físico.

**Los hermanos siguen siendo tres dispositivos, pero ya no son tres popups.** La fusión resuelve
"un dispositivo, varios eventos"; no toca —ni debe— el caso de tres dispositivos de verdad. Eso lo
resuelve la capa de arriba: los tres vencen su espera en el **mismo instante**, así que el volcado
del temporizador es el lote natural y sale un único «3 dispositivos USB conectados» con los tres
nombres en el cuerpo. Con uno solo, el texto es el de siempre. Ver `lib/notif-agrupar.sh`.

**El reloj vive ahora en el bucle principal, no en un subshell por pendiente.** Antes cada aviso
retenido arrastraba su propio `( sleep DEFER_SECS; … ) &`, y de ahí salía la limitación anterior:
**quien notificaba era el subshell, que no puede saber que hay otros dos hermanos a punto de
notificar lo mismo**. Hoy el `read` del bucle —que ya estaba bloqueado ahí sin hacer nada— lleva un
timeout hasta el próximo vencimiento (`pending_at`, epoch en memoria; sin pendientes bloquea sin
timeout, como siempre), y quien dispara es el único proceso que lo ve todo. De propina: cero
subshells por evento y **ninguna carrera** entre reclamar y cancelar, porque ya solo hay un actor
tocando los pendientes. `pending_orden` conserva el orden de llegada — recorrer un array asociativo
de bash da un orden de hash, y en una lista de tres nombres eso se nota.

Los pendientes de conexión (`c.*`) y de desconexión (`r.*`) **comparten directorio pero no glob**, y
un aviso ya reclamado se renombra a `.fired.*` —fuera de ambos globs— para que no pueda reaparecer
como pendiente vivo y falsear una cancelación o una fusión. `GIGIOS_USB_PENDING_DIR` permite
apuntar el directorio a otro sitio: es la costura para probar el script sin pisarle los pendientes
al monitor que está corriendo (que además los **borra al arrancar**).

`ID_USB_INTERFACES` y una lectura de `bInterfaceClass` en sysfs siguen ahí, pero **degradados a
atajos**: solo sirven para ahorrarse la espera cuando la respuesta ya se sabe (un pendrive normal se
calla al instante). Si dicen que no, **no se concluye nada** — se difiere. El coste aceptado es que
un teclado tarda 3 s en anunciarse; es un popup pasivo, y se prefiere eso a un falso "dispositivo
desconocido". El sysfs es atajo y no garantía porque las interfaces **no siempre existen todavía**
cuando llega el `add` del `usb_device`.

- **Expulsar** (botón en el aviso de conexión) → `usb-eject.sh <disco>`: desmonta todas las
  particiones y hace `power-off`. El unmount de udisks **hace el flush y espera**: cuando vuelve, los
  datos están físicamente en el pendrive. Si `power-off` falla (hubs que no lo soportan) **no** es
  error: ya está todo volcado, que es lo que protege los datos.
- **Volumen sucio** → en cada partición USB nueva se llama a `org.freedesktop.UDisks2.Filesystem.Check`
  (solo lectura); si no está limpia **se repara sola** (`usb-repair.sh` → `Filesystem.Repair`), sin
  botón ni pregunta. Se puede porque la operación es **conservadora, no destructiva**: en NTFS udisks
  ejecuta `ntfsfix`, que según su propio man **no es un chkdsk** — repara inconsistencias
  fundamentales, resetea el journal y **programa la comprobación de verdad para el primer arranque de
  Windows**. Auto-reparar no esconde nada. Y el instante del enchufe es la **única ventana** en la que
  el volumen está sucio y todavía sin montar, que es lo que `Repair` exige: preguntar aquí solo servía
  para que la ventana se cerrara mientras el usuario decidía. Se recomprueba `/proc/mounts` justo antes
  de reparar — si el gestor de archivos lo montó en ese hueco, **no** se le desmonta por la cara: ahí
  (y solo ahí) se cae al aviso con botón, donde el desmontaje lo autoriza el clic.

**Por qué udisks y no `fsck`/`ntfsfix` directos**: van a un dispositivo `root:disk 660`, harían falta
privilegios, y escalarlos desde un script de `~/.config` (escribible por el usuario) sería
exactamente la escalada silenciosa contra la que avisa la sección de `PRIVESC_ALLOW`. Con udisks el
trabajo privilegiado lo hace `udisksd` y lo autoriza polkit — y **no hay prompt de contraseña**
porque `modify-device` es `allow_active=yes` para dispositivos que **no** son del sistema (en un
disco interno sí lo pediría: `modify-device-system` → `auth_admin_keep`). `Check`/`Repair` **exigen
el volumen desmontado**; si ya está montado, `check_volume` se calla (no vamos a desmontar por la
cara). Cualquier error —fs no soportado, falta la herramienta— también es silencio: esto es una
comodidad y no puede convertirse en una fuente de ruido. Reparar **NTFS** necesita `ntfsfix`, que
viene en el paquete **`ntfsprogs`** — **no** en `ntfs-3g`, que hoy solo trae el driver FUSE
(`pacman -F` puede decir lo contrario: su base de ficheros va desfasada respecto a lo instalado).

### Brillo: dos hardwares, y uno de ellos necesita `sudo` una vez (`system/modules-load.d/`)

El brillo **no es una sola cosa**. En un **portátil** lo maneja la GPU y el kernel lo publica en
`/sys/class/backlight` → `brightnessctl`. En un **sobremesa** ese directorio está **vacío**: el
monitor externo no aparece ahí porque su brillo vive en el firmware del propio monitor, y solo se
habla con él por **DDC/CI** (I2C sobre el cable de vídeo) → `ddcutil setvcp 10`. Lo implementa AGS
en `ags/servicios/pantalla/brightness.ts`, que elige backend solo; ver `ags/CLAUDE.md`.

Para el camino DDC hace falta el módulo **`i2c-dev`**, que no carga nadie por su cuenta. Sin él no
existen los nodos `/dev/i2c-*`, `ddcutil` no ve nada y el slider **desaparece** (que es el
comportamiento correcto: no hay backend). Lo persiste `system/modules-load.d/i2c-dev.conf`, que como
la regla udev de USB va a `/etc` y **no se symlinkea**: lo copia **`install.sh` (paso 6)**, que además
hace el `modprobe` para no obligar a reiniciar. En una máquina ya montada, a mano:

```sh
sudo install -Dm644 system/modules-load.d/i2c-dev.conf /etc/modules-load.d/i2c-dev.conf
sudo modprobe i2c-dev   # modules-load.d solo actúa en el arranque
```

El **acceso** a los nodos no requiere nada más: la regla udev que ya trae el paquete `ddcutil`
(`/usr/lib/udev/rules.d/60-ddcutil-i2c.rules`) marca los buses de la tarjeta gráfica con
`TAG+="uaccess"`, o sea ACL para el usuario de la sesión — **no** hace falta meterse en el grupo
`i2c` ni relogear. Medido en esta máquina (RTX 3060 + ASUS XG27AQDMES por DP): bus `/dev/i2c-3`,
VCP 10 soportado, rango 0–100.

**El brillo por hardware tiene un SUELO, y por debajo atenúa el gamma.** `setvcp 10 0` es el
mínimo que acepta la electrónica del panel — en el OLED de esta máquina, todavía claramente
luminoso. Así que el slider está partido en dos tramos: por encima de un suelo manda el hardware
(DDC/backlight) y por debajo se atenúa el **gamma**, que aplica `hyprsunset` sobre la CTM del KMS.
Es el mismo proceso que sostiene la luz nocturna, y por eso `applyNight()` en
`ags/servicios/pantalla/service.ts` es el **único dueño** y reconcilia los dos canales juntos: lo
mantiene vivo si lo pide cualquiera de los dos, y usa una temperatura neutra (6000 K) cuando solo
hace falta para el gamma — si no, bajar el brillo encendería de paso la luz nocturna. La lógica del
reparto es pura y probada (`ags/servicios/pantalla/atenuacion.ts`); ver `ags/CLAUDE.md` para el
detalle, incluida la restauración desde disco (el gamma no deja residuo: muere con la sesión, al
revés que el valor DDC, que el monitor graba en su firmware).

**`brightnessctl` no se invoca desde ningún otro sitio, y es a propósito.** Sin dispositivos de clase
`backlight` **no falla**: cae al primer dispositivo de clase `leds` y acaba encendiendo el **LED de
scroll-lock del teclado**, devolviendo 0 — un fallo mudo que la UI no podía detectar. Por eso las
teclas `XF86MonBrightness*` de `gigios/keybinds.lua` ya **no** lo llaman (van por `ags request
brightness-up|down`, que aplica al backend que haya y enseña el OSD) y la llamada que queda en
`init.sh` lleva `-c backlight` explícito.

### Puntero: hyprcursor y XCursor son DOS MITADES, no una migración (`bin/generar-hyprcursor.sh`)

**XCursor no se puede retirar, y plantearlo como "migrar a hyprcursor" lleva a la conclusión
equivocada.** hyprcursor cubre **solo el cursor que dibuja el compositor**. XWayland no lo soporta
—es Xcursor y punto— y GTK/Qt dibujan su propio puntero desde `XCURSOR_THEME`. Así que un tema aquí
es **un directorio con las dos mitades**: `cursors/` (PNG por tamaño, XCursor) y
`hyprcursors/*.hlc` + `manifest.hl` (hyprcursor). Con esa forma **un solo nombre** vale para las dos
variables, que es lo que emiten `gigios/dispositivos.lua` y AGS. Es la forma que ya traen los temas
con soporte de fábrica (Bibata-Modern-Ice).

**El problema real no era "estamos en XCursor": era que el tema NO ESTABA FIJADO.** Nada ponía
`XCURSOR_THEME`/`HYPRCURSOR_THEME`, así que Hyprland caía a gsettings (`cursor-theme = 'default'`),
un nombre que libhyprcursor **no sabe resolver**: casa temas por **nombre de directorio** con
`manifest.hl` y **no lee `index.theme` ni sigue `Inherits`** (el `~/.icons/default` que escribió
nwg-look y que hereda de Bibata solo lo entiende XCursor). Y ante un nombre que no encuentra
**libhyprcursor no falla**: coge **el primer tema con `manifest.hl` que se cruce**, ignorando el
nombre pedido. Medido con `hyprcursor_manager_create_with_logger` contra la `.so` instalada:

```
getFullPathForThemeName: failed, trying without name of Adwaita
Found theme Adwaita at ~/.local/share/icons/Bibata-Modern-Ice
```

`valid=false` solo si **no hay ningún** tema hyprcursor en el sistema (verificado apuntando `HOME` y
`XDG_DATA_DIRS` a un sitio vacío). O sea que el puntero del escritorio lo decidía **el orden de
lectura del directorio** —ni alfabético ni "el primero instalado": comprobado instalando un segundo
tema, la elección no cambió—, y bastaba instalar otro tema para cambiarlo sin tocar nada.
**Por eso `temaCursor` no enciende hyprcursor: fija CUÁL**, que es lo que faltaba.

**Ajuste**: `temaCursor` en `~/.config/gigios/devices.json` (Ajustes > Dispositivos > Puntero).
**Vacío = no se emite ningún `hl.env`** y manda el tema de la sesión — el mismo criterio que el
`locale` de `gigios/env.lua`, y por el mismo motivo: un nombre de fábrica cambiaría el puntero de
una máquina que nunca ha tocado el ajuste, y encima nombraría un tema que puede no existir en ella.
El desplegable **solo lista temas con `manifest.hl`**: elegir uno sin él dejaría al compositor
dibujando otro tema en silencio. El nombre se valida contra `^[A-Za-z0-9._+-]+$` **en origen**
(`normalize()`), porque acaba en un `hyprctl setcursor` y en un literal Lua de `hl.env()`; lo que
**no** se comprueba es que el tema exista, para que un `devices.json` traído de otra máquina
conserve la elección.

**`hl.env` solo alcanza a lo que Hyprland lance a partir de ese momento**, así que cambiar el tema
en caliente no reescribe el puntero de las apps ya abiertas: cambian al reiniciarse. El `setcursor`
sí afecta al compositor al instante. AGS escribe además `cursor-theme` en GSettings, no por GTK
solamente: es de donde lo lee Hyprland al arrancar con `cursor:sync_gsettings_theme` activo, y
dejarlo desincronizado revive el tema viejo en el siguiente login.

**`bin/generar-hyprcursor.sh` le añade la mitad hyprcursor a un tema XCursor** (`--list` enseña los
instalados y su estado). Sale **siempre** a `~/.local/share/icons`, nunca a `/usr/share/icons`: ahí
los ficheros son de un paquete y pacman no los rastrearía, así que una actualización dejaría mitades
descuadradas sin avisar. Es idempotente (`--force` rehace). Lo llama `install.sh` (paso 10) sobre
`$CURSOR_THEME`, por defecto `Bibata-Modern-Ice` — que va por el mecanismo de paquete **opcional**
porque vive en chaotic-aur y en un Arch puro haría fallar el `pacman -S` entero. El instalador
**no elige el tema**: preparar el terreno sí, cambiarle el puntero a quien no lo ha pedido no.

**Lo que el generador NO hace es inventar resolución.** Un tema XCursor son PNG por tamaño, así que
el `.hlc` generado lleva **esos mismos PNG** con `resize_algorithm = none` (verificado destripando
un `.hlc` generado: `default_000.png` 16×16, `default_001.png` 24×24…). El salto de calidad de
hyprcursor —SVG, nítido a cualquier tamaño y escala— **solo lo dan los temas autorados en SVG**,
como Bibata-Modern-Ice, cuyos `.hlc` sí contienen un `.svg`. Sobre un tema de paquete esto da
**paridad, no nitidez**. Dato para dimensionarlo: en Bibata la mitad SVG ocupa **328 KB** y la
XCursor **28 MB**.

### Perfiles TLP conmutables (`system/tlp/` + `servicios/energia/tlp.ts`)

Ajustes > Energía ofrece un selector **Normal/Ahorro** que cambia el perfil TLP en batería. El
problema de fondo es el mismo que el del brillo DDC y la regla udev de USB: **`tlp.conf` vive en
`/etc` y aplicarlo (`tlp start`) necesita root, pero AGS corre como usuario**. La regla de oro del
repo prohíbe que algo que toca root sea un symlink al árbol escribible por el usuario (escalada
silenciosa), así que la estructura separa **fuente versionada** de **copia de confianza root-owned**:

- **Fuente (versionada, la editas tú):** `system/tlp/{normal,ahorro}.conf` (perfiles completos que
  se intercambian **enteros**), `system/tlp/gigios-tlp-apply.sh` (el helper) y
  `system/tlp/sudoers-gigios-tlp` (la regla, con `__GIGIOS_USER__` de placeholder).
- **Instalado por `install.sh` paso 6, todo root-owned:** helper → `/usr/local/bin/gigios-tlp-apply`
  (755); perfiles → `/etc/gigios/tlp/{normal,ahorro}.conf` (644); regla → `/etc/sudoers.d/gigios-tlp`
  (440), generada sustituyendo el usuario real y **validada con `visudo -cf` ANTES de instalarla** (una
  regla sudoers malformada rompe `sudo` en toda la máquina). Se instala **solo si `tlp` está presente**;
  en un equipo sin TLP la función queda oculta.

**El flujo:** AGS ejecuta `sudo -n /usr/local/bin/gigios-tlp-apply {normal|ahorro}`, que copia
`/etc/gigios/tlp/<modo>.conf` → `/etc/tlp.conf` (atómico, tmp+`mv`), lanza `tlp start` y anota el modo
en `/etc/gigios/tlp/active` (world-readable, que AGS relee al arrancar sin sudo). **`install.sh` NO
toca `/etc/tlp.conf`** — eso lo hace el helper la primera vez que el usuario elige un perfil; si tenías
un `tlp.conf` afinado, pega su contenido en `system/tlp/normal.conf` antes de reinstalar.

**Por qué es seguro y no una escalada:** todo lo que `sudo` toca es root-owned, y la regla sudoers
casa el comando **exacto con argumento fijo** (`normal`/`ahorro`), no un script en `~/.config`. Editar
la copia del repo no cambia lo que corre como root hasta reinstalar con `sudo` a propósito. El `-n` de
`sudo` evita colgarse pidiendo contraseña: sin la regla, falla en el acto.

**Lado AGS (`servicios/energia/tlp.ts`):** `tlpAvailable` exige `tlp` + el helper + batería presente
(mismo patrón que el brillo sin backend DDC — la tarjeta se oculta entera si falta algo). El estado
inicial sale de leer `/etc/gigios/tlp/active` directamente. `tlpBusy` bloquea el selector mientras el
helper corre (evita dos `tlp start` a la vez). Es un **selector manual e independiente** del "Forzar
modo ahorro" y del umbral de batería. **Forzar modo ahorro** (`forcePowerSave` en
`~/.config/power-save/config.json`) es lo otro nuevo: hace `powerSaveActive` verdadero ignorando
nivel/carga/presencia de batería, así que también funciona en un sobremesa.

### Security monitor (`oom-monitor.sh`) + sandboxed launcher (`run-untrusted.sh`)

Despite the filename, `hypr/scripts/oom-monitor.sh` is the general **security event monitor** —
OOM killer is just one of ~16 scanned event types. Five sub-monitors run in parallel (`&` + `wait`):

**No se retrasa entero desde `gigios/autostart.lua` — se escalona por dentro, y la asimetría es el
diseño.** Sus sub-monitores no corren el mismo riesgo si empiezan tarde. Los que **siguen**
(`journalctl -kf`/`-f` con `-n 0`, que salta el backlog a propósito, e `inotifywait`) no
recuperan lo pasado: retrasarlos convertiría un OOM, un `sudo` fallido o un cambio en
`/etc/shadow` en una **ventana ciega** — justo lo que el script existe para evitar. Los que
**sondean** leen un estado que sigue ahí cuando lo mires, así que apartarlos no pierde nada y son
además los caros: `DELAY_UNITS=25` (su primera pasada solo siembra, no notifica: retrasarla es
literalmente invisible), `DELAY_SMART=45` (despierta cada disco; el sondeo es horario) y
`DELAY_DOWNLOADS=60` (el más caro: recorre Descargas y, ante un fichero nuevo, lo hashea y lo pasa
por ClamAV, que recarga ~200 MB de firmas **por invocación**). Los `sleep` van **dentro de cada
función y tras sus guardas**, para no dejar uno colgando por un monitor apagado. Medido en vivo:
los tres seguidores enganchan a t=0 y las pasadas caen en t=25/45/60.

- `monitor_kernel` — `journalctl -kf` (kernel-only, avoids matching app logs): OOM, panic,
  hung tasks, disk I/O errors, hardware errors (MCE/ECC/EDAC), unsigned/out-of-tree kernel
  modules, GPU/NVIDIA errors, CPU throttling, segfaults.
  **Cada tipo es su propia categoría agrupada** (`lib/notif-agrupar.sh`): una GPU atragantada repite
  la misma línea NVRM decenas de veces y ahora sale un «40 errores de GPU» con la línea listada una
  vez y su `(×40)`. Los **cooldowns** por dispositivo (E/S) y por proceso (segfault) siguen ahí y no
  sobran: son capas distintas — el cooldown decide **qué se encola** (un disco agonizando no aporta
  nada nuevo cada 200 ms), la agrupación decide **cómo se presenta**; sin cooldown, agrupar solo
  cambiaría "40 popups" por "un popup cada 20 s, para siempre". **El kernel panic no se agrupa**: el
  sistema se está yendo y la ventana de calma puede ser más de lo que le queda a la sesión.
  **`diskError` clasifica el dispositivo antes de alarmar.** Casaba `*"i/o error"*` a pelo contra
  cualquier línea del kernel, así que arrancar un pendrive sin expulsarlo (que suelta un
  `Buffer I/O error on dev sdb1 … lost async page write` por cada página no volcada) disparaba una
  **crítica "💾 Error de disco" por línea** — un disco sano denunciado como moribundo. Ahora se saca
  el dispositivo de la línea (`_io_dev`), se resuelve a su disco padre (`_disk_base`; las particiones
  no tienen `bdi`/`removable` propios) y solo es "Error de disco" si `_disk_is_internal`: el nodo
  **sigue existiendo** y `removable=0`. No basta con mirar si existe — el nodo sobrevive unos ms al
  desconecte, y el flag `removable` cubre esa carrera. Si es extraíble o ya desapareció, sale un
  aviso normal **"⏏️ Extracción insegura"** (datos, no hardware). Una línea que no nombre dispositivo
  **sí** alarma (fail-safe). Además hay cooldown de 30 s **por dispositivo**: un disco muriéndose de
  verdad suelta decenas de líneas por segundo. Ver la sección de USB para la causa raíz y la cura.
- `monitor_system` — `journalctl -f` filtered by `-t` identifier (sudo, sshd, su, pkexec,
  polkitd, systemd, systemd-coredump): failed-to-start services, sudo/su/polkit auth failures,
  SSH accepted/failed, coredumps, and a sliding-window "crash storm" detector (≥3 coredumps
  in <60s).
  **Agrupado por tipo**, y aquí la ráfaga típica no es hardware sino un ataque o un servicio en
  bucle: un SSH expuesto recibe cientos de `Failed password` por minuto y una unidad rota reintenta
  cada pocos segundos. El aviso de sudo **no lleva dato variable a propósito** (no se filtra la línea
  del journal al popup), así que encola texto vacío y lo que informa es el recuento: «5 fallos de
  sudo» + el cuerpo de siempre. **La tormenta de crashes no se agrupa**: ya es un resumen, y trae su
  propio límite de uno por minuto.
  **Escaladas de privilegios (`privEsc`) — dos filtros contra el ruido de los juegos.** pkexec
  emite **dos** líneas por escalada: la de PAM (`pam_unix(polkit-1:session): session opened`, que
  no dice *qué* se ejecuta) y la de `Executing command … [COMMAND=…]`. Se avisaba en ambas → doble
  notificación, y la de PAM era además infiltrable por comando. Ahora **solo** notifica la de
  `COMMAND`; no se pierde nada, porque un pkexec **denegado** no abre sesión PAM pero sí loguea su
  `Not authorized`, que la rama sigue captando. Sobre esa línea se aplica `PRIVESC_ALLOW`, una
  allowlist de **globs** comparados contra el `COMMAND=` (que viene con argumentos). Contiene
  **GameMode**: `gamemoded` escala por pkexec **cada vez que un juego arranca y otra vez al
  cerrarse** (`/usr/lib/gamemode/cpugovctl set performance`, `procsysctl split_lock_mitigate`,
  `gpuclockctl`), así que jugar era una lluvia de avisos críticos "🔓 Escalada de privilegios" —
  la clase de ruido que enseña a ignorar la categoría entera. **No se puede exponer la allowlist
  en `security.json`**: el guardado de `ags/modulos/ajustes/seguridad/preferencias.ts`
  reconstruye ese JSON desde cero, así que
  una clave añadida a mano moriría al tocar cualquier switch de la UI. Se amplía editando el array
  en el script — y cada patrón es un agujero permanente, porque una ruta *escribible por el
  usuario* en esa lista es una escalada silenciosa.
- `monitor_files` — `inotifywait` on the *parent directories* of critical paths (not the files
  themselves, so atomic write+rename replacements like `visudo`/`passwd` are still caught):
  `/etc/passwd`, `shadow`, `sudoers`, `ld.so.preload`, `sshd_config`, plus persistence
  locations (`sudoers.d/`, `pam.d/`, `cron.d/`, `systemd/system/`, `~/.config/autostart/`,
  `~/.ssh/authorized_keys`, `/boot/`).
  **Notifica por ráfaga, no por fichero** (vía `lib/notif-agrupar.sh`, ver su sección). Emitía una
  notificación **por cada ruta**, y todas las de `/etc` son críticas con `-t 0` (sin autocierre):
  un `pacman -Syu` normal dejaba decenas de tarjetas críticas apiladas del mismo tema, que se
  despachan cerrándolas en bloque sin leer ninguna — el mismo resultado que apagar la categoría, y
  por la misma razón que la allowlist de `privEsc`. Las cuatro categorías (`archivos.critico-modificado`,
  `archivos.persistencia`, `archivos.clave-ssh`, `archivos.boot`) se acumulan por separado, así que
  una avalancha en `/boot` no se traga un cambio en `/etc/shadow`. `create` + `close_write` del
  mismo fichero son dos eventos del mismo cambio y la deduplicación de la librería los colapsa.
- `monitor_smart` — hourly `smartctl -H -A` polling per physical disk (zram/loop/dm-/sr
  excluded); warns once if it can't read SMART (permissions), alerts on `FAILED`/`FAILING_NOW`.
- `monitor_units` — polls `systemctl --failed` (system *and* user buses) every 120s; the first
  pass only seeds state so pre-existing failures aren't reported as new. Tras un apagón sucio o una
  actualización caen **varias unidades a la vez** y la pasada las devuelve todas juntas: **la pasada
  es el lote**, se encolan y se vuelcan al terminarla — agrupar aquí no cuesta ni un segundo de
  retraso, porque no hace falta ninguna ventana de tiempo.
- `monitor_downloads` — **event-driven `find` sweep** of the locale-aware Downloads dir
  (`xdg-user-dir DOWNLOAD`, falling back to `~/Downloads`/`~/Descargas`; this machine's is
  `~/Descargas`). **inotify is a *wakeup*, not the scanner**: the body is `_dl_sweep` (a nested
  function that sees the persistent state — `_idx`/`_scanned`/`seeded`/`dir` — via bash dynamic
  scope), and the loop blocks on `inotifywait -q -r -t <safety> -e create,close_write,moved_to,moved_from,delete`.
  On an event it **debounces** (~3s of quiet, 30s hard cap) so extracting a game = *one* sweep, not
  thousands; on the `<safety>`=300s timeout it sweeps anyway (net for inotify `IN_Q_OVERFLOW` / the
  `-r` new-subdir blind spot — the sweep is authoritative regardless of which events inotify dropped).
  Idle = blocked, ~zero CPU (vs the old fixed 30s poll). Falls back to a plain 30s poll if
  `inotify-tools` is absent, and degrades to it on inotify errors (rc=1, e.g. watch-limit).
  **Content-hash dedup** (replaced the old permanent `path|size` scheme in `download-seen`, whose
  append-only, never-pruned, reboot-surviving state meant a file was scanned exactly once *ever* —
  re-adding it, even a *different* file of the same size at the same path, was silently skipped).
  Two state files under `~/.cache/gigios/`: `download-index` (`mtime|size|path`, a cheap per-file
  memo, **pruned** to currently-existing files each pass so it can't grow unbounded) and
  `download-hashes` (one `xxh64sum` per already-analyzed *content*, persistent — append-only but
  **capped**: once it passes 10 MB it's truncated to the last 100 entries via `tail -n 100` and the
  in-memory `_scanned` set is rebuilt to match; ~17 B/entry so this is a years-away hard valve, not
  routine). Rule: memo hit
  (`mtime|size` unchanged) → skip without hashing; changed/new → hash it — if that content hash was
  already analyzed, skip (same file re-added ≠ re-scan), else scan it (different content = different
  hash = scanned, even at the same path/size). `download-seen` is deleted on startup by the new code.
  Two jobs: (1) **flags new executables** (`is_runnable`: `+x`, ELF magic, `.appimage/.run/.exe/…`)
  with a "Lanzar aislado" action button — seeded silently on first run to avoid a flood; (2)
  **ClamAV-scans ALL new files** (not just executables — a virus can be a `.com`, document, etc.).
  Prefers `clamscan` (standalone) over `clamdscan` (needs the `clamd` daemon running). NB: the first
  sweep after the state is reset (or after this migration) hashes+scans every existing download once
  — a one-time heavier pass.
  **Resource controls (all live-read from `security.json` each sweep — no reboot needed, unlike the
  event toggles):** hashing and ClamAV run under `nice -n19 ionice -c3` (idle). `_dl_paused` defers
  the *whole* sweep when an enabled pause gate is active *now* — `dlPauseOnBattery` / `dlPauseInPowerSave`
  (battery read from `/sys/class/power_supply`, ver el aviso de abajo; threshold from
  `~/.config/power-save/config.json`) /
  `dlPauseWhileGaming` (reads `~/.config/gigios/runtime-state.json` `{gaming}`, written by AGS
  `servicios/energia/gamingState.ts`, which reuses the `isGameClient` heuristic — `ags/modulos/barra/juegos/`,
  ver `ags/CLAUDE.md`). Deferred work marks nothing, so
  it's picked up when the gate clears. The size cap is `dlMaxScanGB` (default 1 GB), also live.

  **`/sys/class/power_supply/` NO lista solo la batería del equipo, y creerlo rompía la pausa por
  batería en un sobremesa.** El ratón inalámbrico aparece ahí (aquí un Logitech G305 →
  `hidpp_battery_0`) y reporta `status=Discharging` **siempre**: un ratón sin cable siempre tira de
  su pila. `_on_battery`/`_battery_pct` recorrían el directorio entero y se quedaban con el primero
  que casara, así que este sobremesa se creía **"a batería" de forma permanente** y el % era el del
  **ratón**. Con `dlPauseOnBattery` activado eso habría pausado el escáner de descargas **para
  siempre**, en silencio y sin nada en la UI que lo delatara (no llegó a saltar solo porque esa
  pausa está en `false`). El kernel ya lo distingue y `_is_system_battery()` lo usa: fuera
  `scope=Device` (así marca las pilas de periféricos; la del equipo es `scope=System` o **no trae
  `scope`**, como los `BAT0` de portátil) y fuera `type != Battery` (el adaptador es `type=Mains`).
  Verificado con A/B (viejo: "con batería" = sí; nuevo: no) y con un BAT0 simulado para no romper
  el portátil. Mismo patrón en el `HAS_BATTERY` de `boot-healthcheck.sh`, que hace `grep -i bat`
  sobre esa lista y **también** casa con el ratón — ahí sale inofensivo de milagro, porque el bucle
  que va detrás globa `BAT*` y no encuentra nada.
  **Un `clamscan` que FALLA no es un `clamscan` limpio — y darlo por limpio era un agujero real.**
  El lote va a `2>/dev/null` y solo se leían las líneas `FOUND`, sin mirar el código de salida
  (0 = limpio, 1 = virus, **2 = ERROR**: sin base de firmas, permisos, fichero ilegible). Con la
  DB vacía —ClamAV recién instalado y `freshclam` **sin ejecutar nunca**, que es como se encontró
  esta máquina: `/var/lib/clamav` a 0 ficheros— `clamscan` salía con 2 y cero `FOUND`, así que el
  lote caía en la rama de "terminó bien" y **se marcaba como analizado**. Y como el memo va por
  **hash de contenido y es permanente**, esos ficheros no se volverían a analizar **nunca**, ni
  después de instalar las firmas: el escáner era un sello de "analizado" que no analizaba nada
  (medido aquí: **747 hashes** sellados con 0 firmas cargadas). Hoy `rc == 2` → `engine_ok=false`
  → **no se marca `_idx` ni `_scanned`** (el lote se reintenta solo cuando haya motor) + un aviso
  crítico **una vez por proceso** (`_dl_warned_engine`, mismo patrón que `warned_perm` en
  `monitor_smart`; sin el freno sería un aviso por barrido). Un `rc=1` **sí** marca: el análisis
  ocurrió y el hallazgo ya se notificó. Al arreglarlo aparece un efecto de segundo orden que
  obliga a `_alerted`: si no se marca `_idx`, el mismo ejecutable vuelve a entrar en `new_exec`
  en **cada** barrido (uno cada 5 min por la red de seguridad de inotify), así que
  `_alerted` (solo RAM, clave `ruta` → firma `mtime|tamaño`) da **un aviso por fichero y sesión**,
  y vuelve a avisar si el fichero cambia. En el camino sano `_alerted` no hace nada: allí `_idx`
  ya salta el fichero. **Lo ya sellado en falso NO se reevalúa solo**: tras instalar las firmas hay que borrar
  **los dos** ficheros de caché, `~/.cache/gigios/download-index` **y** `download-hashes` (se
  reconstruyen). Borrar solo `download-hashes` **no sirve** y es un error fácil: la primera guarda
  del barrido es `_idx` (`download-index`, memo `mtime|tamaño`) y hace `continue` **antes** de
  llegar a hashear, así que el fichero se saltaría igual. La alternativa sin borrar nada es el
  escaneo forzado de Ajustes (`scan-downloads.sh`), que ignora el memo — pero tampoco lo
  actualiza, así que el escáner automático los seguirá dando por analizados. Verificado con A/B sobre un `clamscan` simulado (rc 0/1/2) y con 3 barridos
  seguidos para el spam.

  **Interruptible scan**: `clamscan` reloads its ~200 MB signature DB on *every* invocation (~13 s
  here), so the batch is **not** chunked — one `clamscan --file-list` over the whole batch runs in the
  background while a `_dl_paused` poll (every 2 s) `kill`s it if a gate activates mid-scan (latency
  ~2 s). Completing marks `_idx`+hashes for all; a kill marks nothing, so the batch re-scans on
  resume (FOUND lines already printed before the kill still alert). **In-progress downloads**
  are skipped: browser/manager temp markers (`.part`/`.crdownload`/`.aria2`/`.!qB`/… *and their base
  name*) plus anything modified in the last 15s (still being written); a file moved out of Downloads
  mid-scan is skipped by a per-file existence recheck. Files over the cap raise a "🔍 Escanear"
  notification (wired to `scan-file.sh`). `scan-downloads.sh` is the **forced** full scan (Settings
  button) that ignores the master toggle, the pauses and the cap — it resolves the dir and delegates
  to `scan-file.sh` (now also `nice`/`ionice`-wrapped).

  **Un `.zip` lleno de muestras daba una crítica `-t 0` por firma.** Las líneas `FOUND` se encolan y
  se vuelcan **al terminar de leer la salida de ese `clamscan`**: el lote del escaneo es el grupo
  natural, así que no hay ventana de tiempo ni retraso. Los **archivos grandes sin analizar** siguen
  el mismo tope que los ejecutables nuevos (≤4 individuales con su botón «Escanear igualmente», más
  → un resumen sin botón): el botón es **por fichero**, así que agrupar cuesta el botón, y hasta
  cuatro compensa; descomprimir un juego suelta media docena de archivos enormes de golpe, y eso son
  seis popups con botón que nadie va a pulsar uno por uno.

**Config**: every scanned category is gated by a boolean in `~/.config/gigios/security.json`
(written by `ags/modulos/ajustes/seguridad/SeccionSeguridad.tsx`, absent key = enabled). The bash reads it
**once at process start** — toggling a switch in the AGS Seguridad tab only takes effect after
a reboot or manually restarting this script (the UI says so). Journal reads use `-n 0` to skip
backlog, so a fresh login doesn't re-fire notifications for old events.

**`hypr/scripts/run-untrusted.sh`** — launches a single file through scan-then-contain: ClamAV
first (`clamdscan` preferred, falls back to `clamscan` if the daemon isn't running; a positive
hit blocks the launch entirely, an inconclusive scan warns but still proceeds), then Firejail
(`--whitelist`-only home, `--noroot --nodbus --net=none`). It does **not** disinfect the file —
it contains blast radius if the file turns out to be malicious. Wired into `monitor_downloads`:
new-executable notifications carry a `notify-send -A` action button that invokes it. Requires
`firejail` (and `wine` for `.exe`/`.msi`) to actually be installed — otherwise it notifies and
refuses to launch rather than running unsandboxed.

**`hypr/scripts/scan-file.sh`** — on-demand ClamAV scan of a single path (no size cap; `clamscan -r`
so it descends into archives), notifying clean / infected / couldn't-scan. Invoked by the "🔍 Escanear"
button on the oversized-file notification and by the "Analizar un archivo con ClamAV" path field in
`ags/modulos/ajustes/seguridad/SeccionSeguridad.tsx`. Both `run-untrusted.sh` and `scan-file.sh` prefer `clamscan` and fall back
across engines, and both surface a clear "run `sudo freshclam`" hint when the signature DB is missing.

### Firmas de ClamAV desde la UI (`system/clamav/` + `servicios/seguridad/clamav.ts`)

**Sin firmas no hay antivirus, y hasta ahora el único sitio donde arreglarlo era una terminal.**
Los tres consumidores de ClamAV (el barrido de descargas, `scan-file.sh`, `run-untrusted.sh`)
detectan la base ausente y dicen "ejecuta `sudo freshclam` (o activa clamav-freshclam.service)",
pero eso llega por `notify-send` y hay que acordarse. Peor: mientras tanto el barrido **no marca
nada** (rc 2 → no se sella; ver la sección de `monitor_downloads`), así que la función queda
parada esperando a un gesto que no está en ninguna UI. Ajustes > Seguridad > Antivirus tiene ahora
la tarjeta **Base de firmas**: fecha de la última actualización, si el servicio automático está
activo, y un botón que actualiza **ahora** y de paso deja `clamav-freshclam.service` habilitado.

**Mismo esquema que TLP, y por el mismo motivo**: `/var/lib/clamav` es de `clamav`, el log de
freshclam está en `/var/log/clamav` y `systemctl enable` es de root, así que AGS no toca nada —
delega en `/usr/local/bin/gigios-clamav-update` (root-owned, instalado por **`install.sh` paso 9**
desde `system/clamav/gigios-clamav-update.sh`), autorizado sin contraseña por
`/etc/sudoers.d/gigios-clamav` **solo** para sus dos argumentos fijos. Ni el helper ni la regla se
symlinkean: apuntar algo que corre como root al árbol escribible por el usuario sería la escalada
silenciosa contra la que avisan las secciones de USB, i2c-dev y TLP.

**La actualización automática es un interruptor, y por eso el helper tiene DOS verbos de
actualización.** La fila "Actualizar las firmas automáticamente" enciende y apaga
`clamav-freshclam.service` (`auto-on`/`auto-off`, `disable --now` para que apagar no deje el
demonio vivo hasta el próximo arranque). Con ese interruptor al lado, el botón "Actualizar ahora"
**no puede** forzar el `enable`: reencendería en silencio algo que el usuario acaba de apagar, con
su propio interruptor mintiendo justo encima. De ahí que `update` deje el servicio **como estaba**
(pararlo es un detalle de implementación de esa actualización, no una decisión de nadie) y que
`update-enable` —el que dispara el botón **"Activar y actualizar"** de las notificaciones, donde
activar sí es lo pedido— sea un comando aparte. Los dos están en la regla sudoers por separado.

**El interruptor NO se persiste en ningún JSON de GiGiOS**: el estado es de systemd y se lee de
`systemctl is-enabled` cada vez, también después de fallar una orden — pintar lo que *creemos* que
hizo el comando es como se llega a una UI que se contradice con el sistema. Si el estado no se pudo
consultar (`null`) o falta el helper, la fila **no se pinta**: un interruptor que no sabe dónde
está miente en las dos posiciones. Con el helper ausente el estado se dice en texto, que informa
sin fingir que se puede cambiar.

**Dato medido, por si algún día se quiere simplificar**: en esta máquina `systemctl enable --now` y
`disable --now` sobre esa unidad funcionan **sin root** (polkit se lo concede a la sesión activa),
así que la mitad del interruptor podría no necesitar el helper. Se mantiene por él igualmente:
depender de la política de polkit haría que en otra máquina el interruptor abriera un diálogo de
contraseña —o fallara— mientras el botón de actualizar sigue yendo por sudo, dos caminos distintos
para la misma tarjeta.

**El helper PARA el servicio antes de actualizar, y no es un capricho.** `clamav-freshclam` mantiene
`freshclam.log` bloqueado, así que un `freshclam` suelto con el demonio vivo aborta con *"locked by
another process"*. La alternativa obvia —`systemctl restart clamav-freshclam`— actualiza pero es
**asíncrona**: no deja ni código de salida ni salida que enseñarle al usuario, o sea que el botón no
podría distinguir "actualizado" de "sigue sin firmas". Se para, se actualiza en primer plano y se
vuelve a habilitar con `enable --now`. La ventana sin demonio son segundos.

**Leer el estado NO pasa por el helper ni por sudo**: la fecha sale del `mtime` de
`/var/lib/clamav/daily.{cld,cvd}` (world-readable) y el "se actualiza solo" de `systemctl
is-enabled`, que cualquiera puede consultar. Preguntarle al sistema es lo único que no puede mentir
— el helper puede estar instalado y el servicio apagado a mano, igual que con `HandlePowerKey` en
la sección del botón de encendido. `clamavAutoUpdate` es `boolean | null` por lo mismo: `null` = no
se pudo consultar, y **no** se afirma nada en la UI.

**Sin el helper la tarjeta SE SIGUE PINTANDO, y ahí se aparta del selector TLP a propósito.**
La primera versión la ocultaba entera copiando aquel criterio, y estaba mal: en TLP "falta TLP"
significa *esta función no aplica a esta máquina* y esconderla es correcto; aquí significa *te falta
un paso de instalación*, así que ocultarla reproduce **el problema exacto que la tarjeta viene a
resolver** — un arreglo que existe pero que no hay dónde encontrar (reportado en vivo: "no veo los
ajustes"). Con `clamavHelperInstalled` en falso se enseña el estado igual y el botón cede el sitio a
la orden que hay que ejecutar una vez. Lo único que la hace desaparecer es `clamavPresent`: sin
ClamAV no hay firmas de las que hablar.

**El aviso de "no puedo analizar" lleva BOTÓN, y ese es el punto**: es el único fallo de esta
familia con una cura de un solo gesto, y un popup que dice "ejecuta `sudo freshclam`" y se va en un
minuto le pide al usuario que se acuerde de algo cuando ya esté en una terminal. Las tres
notificaciones que lo reportan —el `rc == 2` del barrido de descargas (`oom-monitor.sh`), y el "no
se pudo analizar" de `scan-file.sh` y `run-untrusted.sh`— llevan ahora
`-A "update=🛡️ Activar y actualizar"` → **`hypr/scripts/actualizar-firmas.sh`**, el lado de usuario
del helper. Se pulsa con **clic derecho** sobre el popup (ver `ags/CLAUDE.md`, "Acciones D-Bus en el
popup"), y el `-t 0` ya no es un popup eterno: con acciones, `popupLifetime()` lo acota a 60 s.

**Por qué un script y no llamar al helper desde el `-A`**: hace falta algo que **notifique el
resultado** —el helper solo imprime por stdout, y de una acción de `notify-send` no lee nadie— y que
no se pueda lanzar dos veces a la vez (`flock -n`: freshclam descarga ~200 MB, y dos clics serían
dos descargas peleándose por el mismo lock del log). El botón de Ajustes **no** pasa por él: AGS
llama al helper directo porque ya tiene su `clamavBusy` y sus propias notificaciones. Sin la regla
sudoers, `sudo -n` falla en el acto y el script traduce el error a "ejecuta `install.sh`" en vez de
enseñar el mensaje crudo de sudo — colgarse pidiendo contraseña sería lo peor de todo, porque esto
sale de un clic en un popup y no hay terminal donde teclearla.

**En `oom-monitor.sh` el `--wait -A` va en subshell de fondo, y no es opcional**: bloquea hasta el
clic o el cierre, así que en primer plano detendría el barrido entero hasta que alguien mirase el
popup (mismo motivo que en `download_alert`). En `run-untrusted.sh` también, y ahí por otra razón:
el usuario ha pedido **lanzar** algo y esperar a que mire el popup retrasaría el lanzamiento. En
`scan-file.sh` sí va en primer plano — su trabajo ya terminó cuando notifica.

**Al arreglar las firmas, lo ya sellado en falso NO se reevalúa solo.** Es la secuela documentada en
`monitor_downloads`: si el barrido llegó a correr con la base vacía *antes* del arreglo de `rc == 2`,
esos ficheros quedaron marcados como analizados **para siempre**. Hay que borrar **los dos** ficheros
de caché (`~/.cache/gigios/download-index` **y** `download-hashes`) y relanzar `oom-monitor.sh`
(`pkill` + `setsid nohup`), porque el índice y el conjunto de hashes se cargan en RAM al arrancar el
script: borrarlos en caliente no sirve de nada.

### Desinstalar apps desde Orion (`desinstalar-app.sh`)

El panel derecho de Orion —el que se despliega al pulsar una app— tiene una acción **Desinstalar**
además de Abrir / Editar config / Fijar en inicio. La ejecuta `hypr/scripts/desinstalar-app.sh`, con
dos verbos que reciben **los mismos argumentos**: `detectar` (solo consulta, devuelve JSON) y
`desinstalar` (hace el trabajo). Los dos detectan por su cuenta, así que `desinstalar` no depende de
que nadie haya llamado antes a `detectar`.

**Se desinstala DE UN CLIC: no hay pantalla de confirmación, y `detectar` NO lo usa la UI.** Hubo una
—con el método, el paquete y la lista completa de lo que `-Rs` se llevaría— y se quitó a petición del
usuario. El razonamiento por el que se acepta: **la confirmación es el propio diálogo de contraseña
de polkit**, que no se puede saltar, sale con el nombre del comando y hay que atender de todas
formas; una pantalla previa era un segundo "¿seguro?" delante de otro que ya existe. `detectar` se
conserva como entrada de **diagnóstico** — es la forma de responder «¿por qué eligió este método?» o
«¿qué se llevaría por delante?» sin borrar nada, y es con lo que se prueban los cinco caminos.
Peaje asumido y explícito: en los métodos que **no** pasan por pkexec (Flatpak de usuario, Steam,
y el borrado manual **dentro de `$HOME`**) no hay ninguna confirmación de por medio — el clic borra.

**Es FAIL-SAFE, al revés que casi todo el repo.** El resto de scripts de GiGiOS son fail-open —ante
la duda, hacen el trabajo—. Aquí toda ambigüedad termina en "no se desinstala nada" con el motivo
escrito, porque el fallo silencioso de esto sería borrar software que nadie pidió borrar. Lo mismo en
el lado TS: `interpretarSalida` trata como `error` **todo lo que no sea exactamente `ok` o
`cancelado`** — dar por buena una salida que no se entiende borraría el favorito de una app que quizá
sigue instalada.

**pkexec, no `sudo` ni `paru`/`yay`, y los tres motivos son distintos.** Esto sale de un clic en una
interfaz gráfica: no hay terminal donde teclear nada, así que `sudo` se colgaría en un stdin
inexistente. `pkexec` es lo que abre el diálogo (hyprpolkitagent, ya lanzado desde
`gigios/autostart.lua`) y su acción por defecto es `auth_admin` — pide la contraseña del usuario
porque está en `wheel`, y **no la recuerda**: cada desinstalación la vuelve a pedir, que es lo
correcto para algo irreversible. Los helpers del AUR **no sirven de ejecutores** aunque estén
instalados: se niegan a correr como root y por dentro llaman a `sudo`, el mismo callejón sin salida.
Y tampoco hacen falta — **`pacman -Rns` borra igual un paquete del AUR que uno de los repos**; el
helper solo interviene en la *instalación*. Se detectan para dos cosas reales: etiquetar el paquete
como AUR en la UI y **limpiar su clon en la caché** (`~/.cache/{paru,yay}/clone/<pkg>`), que pacman no
conoce y se quedaría ocupando disco.

**Cinco métodos, y el ORDEN de detección es lo que evita el peor fallo.** Steam y Flatpak van
**antes** que pacman porque sus `.desktop` viven en `~/.local/share/applications` y no los posee
ningún paquete: al revés caerían en la rama "manual" y se ofrecería borrar el **acceso directo**,
dejando el juego de 80 GB en disco y al usuario convencido de haberlo desinstalado.

1. **Steam** (`steam://rungameid/N`) → `steam steam://uninstall/N`. Steam no tiene desinstalación no
   interactiva: abre su propio diálogo, y por eso el botón dice "Abrir Steam" y se avisa — si no, esa
   ventana parecería llegar de la nada.
2. **Flatpak** (`flatpak run …`) → `flatpak uninstall -y --delete-data`. Escala solo por polkit si el
   runtime es de sistema.
3. **pacman** → `pacman -Qoq` **primero sobre el `.desktop`** y solo si no lo posee nadie, sobre el
   binario: el `Exec` puede ser un envoltorio (`sh -c`, `env`) y resolvería al intérprete. Se
   distingue AUR con `pacman -Qmq`.
4. **Manual** (curl \| sh, AppImage, tarball): nadie lo posee. Se listan **solo ficheros concretos,
   nunca directorios** —un `rm -rf` sobre un directorio adivinado convierte esta función en una
   pérdida de datos—: el binario, su destino si es symlink (donde vive lo que instalan los scripts de
   curl) y el `.desktop` **solo si es del usuario**. Root únicamente si algo cae fuera de `$HOME`.
5. **Desconocido** → no se ofrece nada, con el motivo escrito.

**El desenlace viaja por STDOUT (`ok`/`externo`/`cancelado`/`error`) con rc=0**, no en el código de
salida. `execAsync` rechaza con el **stderr** ante cualquier rc≠0, así que codificarlo ahí dejaba "el
usuario cerró el diálogo de contraseña" indistinguible de un fallo real. Los rc≠0 quedan para lo que
ni siquiera llegó a intentarse (uso incorrecto, sin `jq`). Solo un `ok` borra el favorito y tira la
caché del catálogo.

**`externo` es el desenlace de Steam y NO puede colapsarse a `ok`.** Ahí no se ha desinstalado nada
todavía: el juego sigue instalado hasta que el usuario confirme en la ventana de Steam, y de eso no
nos vamos a enterar nunca. Tratarlo como éxito hacía dos cosas mal a la vez — borrar el favorito de
un juego que quizá sigue ahí, y **hacer reaparecer Orion justo encima del diálogo de Steam**, que es
el mismo problema de capas que motiva todo lo de abajo.

**El script es el ÚNICO que notifica el resultado**, y tiene que serlo: `pkexec` puede tardar lo que
tarde el usuario en teclear la contraseña, y para entonces Orion lleva rato cerrado. La excepción es
"falta el script", donde AGS notifica por su cuenta — si no, con Orion ya cerrado el usuario se
quedaría mirando un escritorio en el que no ha pasado absolutamente nada.

**Un rc≠0 de `pacman -Rs --print` NO es un fallo del script: es la respuesta.** Significa que otro
paquete depende de este, y su texto es la explicación que hay que enseñar. Sale por **stdout**, no
por stderr (medido). Se recorta a cuatro líneas más un contador: pacman emite una por cada
dependiente, y con algo como `glibc` son **68 KB** de texto idéntico que ni la UI pinta ni nadie lee.

**`-Rs` arrastra las dependencias que quedan huérfanas**, así que desinstalar `kitty` se lleva cuatro
paquetes. Sin pantalla de confirmación eso ya no se ve **antes**, solo después: la notificación de
éxito dice cuántos se quitaron, y `detectar` sigue siendo la forma de mirarlo de antemano.

**`CRITICOS` sigue existiendo aunque su aviso ya no tenga dónde pintarse.** pacman se niega solo
cuando algo depende del paquete, pero varios de los que dejan la sesión inutilizable son **hojas** del
grafo (`hyprland`, `sddm`, el propio shell) y saldrían sin una sola queja. Hoy el campo `aviso` solo
lo devuelve `detectar`; si algún día vuelve a haber UI previa, ese es el dato que tiene que pintar en
ámbar. **No conviertas la lista en un bloqueo**: el usuario manda.

**AGS APARTA ORION ANTES DE LANZAR NADA, y no es cortesía.** El diálogo de contraseña de polkit es
una ventana normal y Orion es una layer-shell **`OVERLAY`**, capa que va por encima de **todas** las
ventanas normales por definición del protocolo; encima Orion tiene keymode `ON_DEMAND`, o sea que
también pelea por el teclado. Con Orion en pantalla el diálogo salía **debajo** y había que cerrarlo
a mano para poder escribir. Y no basta con llamar a `hidePanel()` primero: la salida son ~280 ms de
animación más un par de frames antes de que la superficie se desmapee, así que
`data/uninstall.ts` **sondea el estado real de la ventana** (`app.get_windows()`, nombre `orion` +
`visible`) en vez de dormir una constante copiada de `Orion.tsx`, que se habría desincronizado en
silencio la primera vez que alguien la retocara. Con techo de ~1 s: si la animación se atasca se
sigue adelante, porque lo peor que pasa entonces es el comportamiento de antes.

**Y se APARTA, no se cierra: al terminar Orion vuelve donde estaba.** Un `hidePanel()` es una salida
de verdad —vacía búsqueda y resultados, y devuelve la sección a Inicio salvo con
`orionRecordarUltimaSeccion` activado—, y aquí el usuario no ha pedido salir de ningún sitio: se le
estaba quitando la vista por un motivo puramente técnico, así que perderle el sitio es un efecto
colateral, no una decisión. `suspenderPanel()`/`reanudarPanel()` (`ags/modulos/orion/state.ts`)
guardan una foto, cierran sin limpiar y la reponen. Ver `ags/CLAUDE.md` para las tres reglas que
tiene: qué pasa si el usuario reabre Orion por su cuenta, por qué la ficha del panel derecho solo se
suelta tras un `ok`, y por qué `externo` **descarta** la foto en vez de olvidarla.

**Cada desinstalación disparará el aviso «🔓 Escalada de privilegios» de `oom-monitor.sh`, y eso es
correcto.** `pkexec` loguea su `COMMAND=`, que es justo lo que esa rama vigila. **No lo metas en
`PRIVESC_ALLOW`**: el patrón tendría que ser `*/pacman -Rns*`, o sea una autorización permanente para
borrar cualquier paquete, y la sección de `oom-monitor.sh` ya avisa de que cada entrada de esa lista
es un agujero permanente. Un aviso por una escalada que el usuario acaba de autorizar a mano no es
ruido.

### Almacenamiento y autolimpieza (`analizar-almacenamiento.sh`, `limpiar-almacenamiento.sh`, `limpieza-arranque.sh` + `system/limpieza/`)

Ajustes > **Almacenamiento** (qué ocupa el disco, catálogo de apps por tamaño) y **Liberar espacio**
(limpiezas manuales y autolimpieza). Cuatro piezas, y están separadas a propósito:

| Pieza | Qué hace | Privilegio |
| --- | --- | --- |
| `analizar-almacenamiento.sh` | mide y emite JSON. **No borra nada.** | usuario (+ `sudo -n` solo para contar instantáneas) |
| `limpiar-almacenamiento.sh` | ejecuta una o varias acciones, emite JSON con lo liberado | mezcla, ver abajo |
| `limpieza-arranque.sh` | comprobación de un disparo al iniciar sesión: decide si toca | ninguno propio |
| `system/limpieza/gigios-limpieza.sh` | la parte de root, root-owned + sudoers NOPASSWD | root |

**Un solo `pacman -Qi` para todo el análisis.** Se invocaba tres veces —el total instalado, los
huérfanos y el catálogo de aplicaciones— y sobre 1632 paquetes cuesta **~290 ms cada vez**, o sea
que casi 0,6 s del análisis se iban en volver a preguntar lo mismo. Hoy se vuelca una vez a un
temporal y los tres consumidores lo leen; los huérfanos se filtran **dentro de awk** contra un
conjunto en vez de con `pacman -Qi -- pkg…`, y la cuenta de paquetes sale de contar los `Name:` del
volcado en lugar de un `pacman -Qq | wc -l`. Medido: **1,03 s → 0,72 s de CPU**, con salida
byte-idéntica. El volcado se genera **antes** de forkear los tres sondeos paralelos del verbo
`todo`: una variable asignada dentro de un subshell no vuelve al padre, así que con creación
perezosa habrían seguido siendo tres invocaciones, solo que simultáneas — la misma CPU con mejor
pinta en el reloj de pared. Su `trap` de borrado se **encadena** con el de los tres temporales de
salida: un `trap` nuevo sustituye al anterior, y sin eso el volcado se quedaba en `/tmp`.

**El análisis se cachea en `~/.cache/gigios/almacenamiento.json` y por eso la sección se pinta llena
en el primer frame**, igual que Ajustes > Sistema: recorrer `~/.cache`, `/var/cache/pacman` y el hogar
con `du` cuesta ~1,4 s con caché de inodos caliente y decenas de segundos en frío. Cada `du` corre
bajo `timeout` (20 s por defecto) y lo que no llega sale como **`bytes: null`**, que la UI pinta como
`—`. **`null` y `0` NO son lo mismo y no deben unificarse**: una carpeta sin permisos de lectura
pintada como `0 B` hace creer que ya está limpio lo que pueden ser 40 GB.

**`df` lista los subvolúmenes btrfs como discos distintos, con cifras idénticas.** En esta
instalación de CachyOS, `/`, `/home`, `/root`, `/srv`, `/var/cache`, `/var/log` y `/var/tmp` son
subvolúmenes del **mismo** `/dev/nvme0n1p3`: la sección enseñaba siete discos de 1 TB, como si
hubiera siete. Se deduplica por **dispositivo**, quedándose con el punto de montaje más corto (`/`).
`disk-monitor.sh` ya hacía lo mismo (`declare -A seen  # device -> 1, to dedup btrfs subvolumes`):
es el mismo problema resuelto dos veces porque las dos piezas leen `df` por su cuenta.

**El color de la barra NO usa los umbrales de `disk-monitor.sh`.** La barra corta en 75/90 % de
*uso*; el monitor avisa por espacio libre **absoluto** (menos de 5 GB). Que no coincidan es
correcto: un 10 % libre son 100 GB en un disco de 1 TB y 5 GB en uno de 50. El color es una pista
de lectura del reparto, la notificación es la alarma.

**Contar instantáneas es de root, y snapper miente con rc=0.** `snapper --machine-readable csv list`
sin privilegios responde «Sin permisos» y **sale con 0**, así que el `grep -c` daba 0 y la fila
desaparecía como si el equipo no tuviera instantáneas; `btrfs subvolume list /` al menos falla con
rc≠0. Por eso la cuenta sale del helper root (`gigios-limpieza instantaneas`) vía `sudo -n`, y sin
helper instalado **la fila no se enseña** en vez de afirmar que hay cero. El *tamaño* de las
instantáneas no se da y no es un olvido: el espacio exclusivo de un snapshot solo lo sabe
`btrfs qgroup show` (qgroups + root), y sumar sus `du` daría una cifra enorme y falsa —todo lo
compartido contado una vez por snapshot—.

**Tres niveles de privilegio, y de ahí sale qué se puede automatizar:**

1. **usuario** — todo lo que vive bajo `$HOME` (cachés, miniaturas, papelera, descargas, flatpak).
2. **`sudo -n` al helper** — lo de root que **se regenera solo**: caché de pacman (`paccache -rk1`
   + `-ruk0`), journal (`--vacuum-size`), `/var/tmp`, huérfanos (`pacman -Rns $(pacman -Qtdq)`).
   El NOPASSWD es lo que permite la autolimpieza desatendida.
3. **`pkexec`** — lo irreversible: vaciar la caché **entera** (`pacman -Scc`), que deja el equipo sin
   poder revertir una actualización sin red. **Nunca automatizable**, y esa invariante está probada
   (`servicios/disco/catalogo.test.ts`): si alguien añade una acción de pkexec, la prueba la impide
   entrar en el lote desatendido. Un diálogo de contraseña que aparece solo, de madrugada, no lo lee
   nadie — se aprende a darle a Enter sin mirar, que es peor que no tenerlo.

**Ninguna herramienta informa de forma fiable de cuánto liberó** (`paccache` imprime texto libre,
`journalctl --vacuum-size` no imprime nada útil, `rm` menos), así que el espacio liberado se mide con
`du` **antes y después**. Como `du` mide un blanco móvil —el navegador reescribe su caché entre las
dos pasadas—, la resta puede salir negativa y se recorta a 0; el estado sigue siendo `ok`.

**Lo que `cacheUsuario` NO borra, y por qué.** Un `rm -rf ~/.cache/*` a ciegas cuesta datos reales:
se excluyen `gigios` (mapa de fuentes del CSS, sondeo de hardware), `paru`/`yay` (tienen su propia
acción y su propia forma correcta de limpiarse, `-Sc`; borrarlos a mano deja al helper
reconstruyéndolo todo) y las cachés de shaders de Mesa/NVIDIA (reconstruirlas cuesta más que lo que
liberan, en forma de tirones la primera vez que abres cada juego). `/tmp` tampoco se toca: es un
tmpfs (RAM) y borrarlo bajo los pies de los procesos vivos rompe sockets y ficheros de bloqueo.

**La autolimpieza NO es un daemon, y esto es una corrección de la primera versión.** Empezó siendo
`limpieza-monitor.sh`: dormía 60 s, comprobaba y se quedaba en un `while :; do pasada; sleep 3600;
done` el resto de la sesión. Coste medido de **cada** pasada: hasta **15 procesos `jq`** —uno por
clave de configuración, más uno por cada una de las 11 acciones automatizables, dentro del bucle—
más un `df`, y casi siempre para responder «todavía no toca»: con el intervalo por defecto de 24 h,
23 de cada 24 despertares no hacían nada salvo forkear quince veces y volverse a dormir. Encima
dejaba un bash residente por sesión.

Hoy `limpieza-arranque.sh` corre **una vez**, desde el autostart (t=45), y su camino normal es
**una lectura y un `if`**: un solo `jq -n --slurpfile` que abre los dos JSON (configuración y
estado) y emite una línea TSV con todo lo que hace falta decidir. Medido: **2,9 ms** y cero
procesos residentes cuando no toca limpiar. `command -v jq` no cuenta — es un builtin de bash— y
`date` desapareció a favor de `printf '%(%s)T'`, que también lo es. El `df` del umbral solo se
ejecuta si hay umbral configurado.

**Lo que se pierde, y es deliberado**: un equipo encendido durante días ya no autolimpia hasta el
siguiente inicio de sesión. Se acepta porque lo que esto borra —caché de paquetes, journal,
temporales, miniaturas— crece con el **uso**, no con el reloj, y porque el botón «Ejecutar ahora»
(`--ahora`, que se salta intervalo y umbral) cubre el caso raro. Si algún día hiciera falta la
comprobación periódica, el sitio correcto es un timer de `systemd --user`, **no** volver al bucle:
un timer duerme sin proceso.

La marca de la última limpieza vive en `~/.cache/gigios/limpieza.json` y **no** en el JSON de
configuración: AGS reescribe ese fichero entero con un `replace_contents`, así que se llevaría la
marca por delante. Se pone **antes** de limpiar — si algo se cuelga se pierde un ciclo, en vez de
relanzar la limpieza entera en cada inicio de sesión para siempre. El umbral se mira **después**
del intervalo y sin tocar la marca: con el disco holgado no hay nada que hacer, pero un disco que
se llena mañana no debe esperar un ciclo entero.

**`//` de jq considera falsy a `false`, no solo a `null`.** `.notificar // true` devolvía `true`
con la opción desactivada, o sea que la limpieza avisaba igual después de que el usuario apagara el
aviso. Las claves **booleanas** se leen con `if (… | has("clave")) then …`; las numéricas sí pueden
usar `//` porque en jq un `0` es truthy.

**Configuración y defaults.** `~/.config/gigios/almacenamiento.json`, escrito por
`servicios/disco/preferencias.ts` y releído por los scripts **en cada pasada** (a diferencia de
`security.json`, que `oom-monitor.sh` lee una sola vez al arrancar). La autolimpieza nace **apagada
y con todas las casillas sin marcar**, al revés que `security.json` —donde todo viene ON—: allí los
defaults deciden si algo se *vigila*, aquí si algo se *borra sin preguntar*. Encender o apagar el
interruptor no lanza ni mata nada: la comprobación de arranque leerá el valor nuevo en la
siguiente sesión.

**No hay proceso que relanzar al tocar el interruptor**, y esa es la consecuencia visible de lo
anterior: `setAutoLimpieza` solo escribe `auto` en el JSON, que es lo que leerá el siguiente
arranque. La versión de bucle hacía `pkill -f limpieza-monitor.sh` + re-exec, como
`screencast-monitor` y `updates-monitor`; eso ya no aplica y se quitó. (Al actualizar desde la
versión antigua, un `limpieza-monitor.sh` de la sesión en curso sigue vivo hasta cerrar sesión: el
fichero ya no existe, así que no vuelve.)

**Instalación:** `install.sh` paso 9-bis instala el helper en `/usr/local/bin/gigios-limpieza` y la
regla en `/etc/sudoers.d/gigios-limpieza` (validada con `visudo -cf` antes de moverla). Sin el
helper, las acciones de nivel 2 devuelven `estado:"sin-permisos"` con el paso que falta, y todo lo
de `$HOME` sigue funcionando. Igual que los helpers de TLP y ClamAV, **no se symlinkea**: apuntar un
comando NOPASSWD a un fichero escribible por el usuario es una escalada silenciosa.

**La desinstalación de aplicaciones NO está aquí**, aunque el catálogo las liste por tamaño: la hace
`desinstalar-app.sh` desde Orion, que ya distingue repos, AUR, Flatpak, Steam e instalación manual y
tiene su propia lógica fail-safe (ver su sección más arriba). Duplicarla en Ajustes habría dado dos
caminos con dos criterios distintos para la misma operación irreversible.

### Comprobación de arranque (`boot-healthcheck.sh`)

Es el `exec-once` más caro del arranque —de ahí que vaya al final del calendario escalonado, a
`t=30` (ver la sección de `gigios/autostart.lua` más arriba)— y por eso está pensado para ser **silencioso
en una máquina sana**: solo notifica por categoría cuando encuentra un problema, y todo (incluida la
pasada limpia) queda en `hypr/logs/boot-healthcheck.log` (ignorado por git, ver `.gitignore`).
Ejecutado a mano responde al instante — el retraso lo pone quien lo lanza, no el script.

**Los problemas se acumulan y se emiten al FINAL, no según se encuentran.** Este script comprueba
~19 cosas de una tacada y cada aviso sale con `--expire-time=0`, o sea **sin autocierre**: un
arranque regulero (servicios fallidos + errores en el journal + arranque lento + red inactiva +
batería degradada) recibía al usuario con cinco tarjetas permanentes que hay que cerrar a mano una
por una — y lo que se aprende de eso es a cerrarlas todas sin leerlas. Desde `RESUMEN_DESDE=3`
problemas sale **uno solo**, `arranque.resumen`, con la lista de títulos y un puntero al log;
con uno o dos siguen saliendo individuales, que es lo mejor cuando son pocos porque conservan su
identidad y su remedio concreto. Aquí **no** se usa `lib/notif-agrupar.sh`: aquella agrupa N
eventos **del mismo tipo** llegados en ráfaga, y esto es lo contrario —N problemas de tipos
distintos que comparten un momento—, así que el resumen es un aviso propio y no un recuento.
El cuerpo de cada problema lleva su remedio (`revisa: journalctl -b …`) y esos ni caben ni se leen
apilados en un popup: **por eso el resumen remite al log**, que ya los registraba todos.

**Ojo con la urgencia:** once llamadas pasan `warning`, que **no es un nivel válido** (`notify-send`
solo acepta `low`/`normal`/`critical`; con cualquier otro escribe *«Unknown urgency»* y sale con
rc=1 **sin enviar nada** — ver la sección de notificaciones). Aquí el campo se conserva porque
alimenta también el **log**, donde sí distingue gravedad; `urgencia_valida()` lo traduce a `normal`
en el único punto de emisión. Es la red que impide que ese fallo vuelva a colarse en este script.

**Fase 1 autodescubre el hardware presente** (batería, GPU NVIDIA, NVMe, SATA, soporte SMART,
sensores de ventilador, swap, Bluetooth, audio, red, USB) y la Fase 2 solo comprueba las categorías
cuyo hardware existe — un sobremesa sin batería no recibe ningún chequeo de batería, ni un aviso de
que no la tiene. La GPU NVIDIA se detecta por **PCI** (`lspci`/`vendor` sysfs), no por si el módulo
`nvidia` está cargado: mirar el módulo primero se comería precisamente el caso que este chequeo
existe para pillar (GPU presente, driver no cargado).

**Varios comandos caros se ejecutan una sola vez y se reutilizan entre chequeos** (`sensors`,
`rfkill list bluetooth`, `aplay -l`, `ip link show`, `journalctl -b -1`): cada uno alimenta dos
comprobaciones distintas (existencia + estado) con la misma lectura, en vez de invocar el comando
dos veces por una diferencia de grep. El de ventilador parado además se beneficia de que sea **la
misma muestra**: correlaciona la temperatura de CPU y las RPM del ventilador de una única lectura de
`sensors`, no de dos llamadas casi simultáneas que podrían no coincidir.

**Los errores de kernel/journal se deduplican por proceso/unidad**, no por línea — N repeticiones
de la misma fuente cuentan como un solo problema, y se filtra ruido conocido de antemano (ACPI,
init de Bluetooth, nouveau, WMI, variables EFI, pstore, firmware). El chequeo de suspensión/hibernación
mira el **arranque anterior** (`journalctl -b -1`), no el actual: busca errores de suspend/hibernate,
servicios `systemd-*sleep*` en estado failed, y señales de reinicio forzado (watchdog, "rebooted
forcefully", modo de emergencia) — con `sddm-helper` excluido a propósito porque incrusta el log de
Xorg, que contiene literalmente la cadena "nowatchdog" en su `cmdline` y daría un falso positivo.

**La salud de batería compara `energy_full` contra `energy_full_design`** (o su par `charge_*` en
equipos que no exponen energía), no un simple porcentaje de carga — es la métrica de degradación
real de la celda, y avisa por debajo del 80 % de la capacidad de diseño original.

### Grabar pantalla (`grabar-pantalla.sh`)

**Capturas y grabaciones comparten esquema de teclas**: la **tecla** dice el alcance y el **SHIFT**
dice si es foto o vídeo — `SUPER+Z` recorte / `SUPER+SHIFT+Z` grabar ventana, `SUPER+X` pantalla
completa / `SUPER+SHIFT+X` grabar el monitor activo. Estaban en `CTRL+F`/`CTRL+S`/`CTRL+SHIFT+F`/
`CTRL+SHIFT+S`, y moverlas a `mainMod` **le devuelve `CTRL+S` y `CTRL+F` a las aplicaciones**: eran
binds globales, así que el compositor se los tragaba antes de llegar a ninguna ventana y no se podía
guardar ni buscar con el atajo de siempre. `SUPER+SHIFT+P` (región con slurp) se queda fuera del
esquema porque no es un tercer alcance sino otra herramienta: `wf-recorder` a pelo, sin el toggle ni
el audio del sistema de este script — se detiene matando el proceso, no repitiendo el atajo.

Toggle de dos invocaciones: la primera arranca `wf-recorder` en segundo plano y bloquea esperándolo;
la segunda (mismo atajo) detecta que ya hay una grabación y le manda `SIGINT` para que cierre el
contenedor MP4 correctamente en vez de dejarlo truncado. Todo el estado va protegido por un
`flock` sobre un fichero de bloqueo — necesario porque pulsar el atajo dos veces seguidas rápido es
exactamente el caso de uso.

**Validar "hay una grabación activa" no se conforma con que el PID exista.** Comprueba además que
`/proc/$pid/comm` sea literalmente `wf-recorder` **y** que `/proc/$pid/cmdline` contenga la ruta de
salida exacta que se guardó — un PID reciclado por otro proceso cualquiera tras un cierre forzado no
basta para que el toggle lo confunda con "sigue grabando". Solo si esa doble comprobación falla se
borra el fichero de estado (nunca antes, para no perder la referencia a una grabación real que sigue
viva).

**El modo `ventana` restringe `slurp` a las ventanas realmente seleccionables**: geometrías sacadas
de `hyprctl clients -j`, filtradas a las que están en un workspace **visible ahora mismo** (según
`hyprctl monitors -j`), mapeadas, no ocultas y con tamaño > 0 — en vez de dejar a `slurp` seleccionar
una región libre de la pantalla. Cancelar con Esc sale con código 0 en silencio, no es un error.

Graba **siempre** con el audio interno del sistema: resuelve el sink por defecto con
`pactl get-default-sink` y usa su fuente `.monitor`, verificando primero que esa fuente exista de
verdad en `pactl list short sources` antes de arrancar. Tras lanzar `wf-recorder` espera 0.25 s y
comprueba que el proceso siga vivo — así un fallo inmediato de salida, audio o códec no se anuncia
como "grabación iniciada" cuando en realidad murió al instante.

### Portapapeles (`clipboard-history.sh`, `limpiar-portapapeles.sh`, `miniatura-portapapeles.sh`)

`clipboard-history.sh start` arranca el watcher (`wl-paste --watch cliphist store`) con
**`setsid --fork`**, no con `exec` ni en primer plano: así queda reparentado a init y sobrevive a
quien lo lanzó — tanto Hyprland (`gigios/autostart.lua`) como AGS (`execAsync`) llaman a `start`, y antes
el watcher moría junto con AGS por usar `exec`. Dos patrones de proceso distintos cumplen roles
distintos: uno general (cualquier límite de `-max-items`) sirve para detectar y **sustituir** un
watcher que quedó con un límite antiguo sin perder el historial ya guardado (`stop` no vale para
eso: también hace `cliphist wipe`), y uno exacto (límite actual) sirve para el caso normal de "ya
está corriendo bien, no hacer nada".

`picker` (SUPER+V) es un toggle de Rofi: si ya está abierto, la segunda pulsación lo cierra. Con el
historial desactivado por preferencia no abre nada (`stop` ya lo vació, no hay qué mostrar). El AWK
que arma la lista distingue tres tipos de entrada de `cliphist`: imágenes binarias (miniatura vía
`miniatura-portapapeles.sh`), rutas de imagen en texto (decodificando `file://` con sus `%XX`), y
texto normal — conservando el ID de `cliphist` en una columna oculta para poder decodificar la
selección exacta. Cancelar (Esc) sale con 0 sin tocar el portapapeles, para no pisar con un
`wl-copy` vacío lo que el usuario tenía copiado.

`miniatura-portapapeles.sh` no crea ficheros intermedios ni caché propia: canaliza
`cliphist decode` directo a ImageMagick, con límites de memoria/mapa/disco (128 MiB/0/0) para acotar
el coste de generar una miniatura bajo demanda, escribiendo ya en la ruta que espera Rofi.

`limpiar-portapapeles.sh` tiene dos entradas: `limpiar` (llamada directa, p. ej. desde AGS) y
`al-iniciar` (la usa `gigios/autostart.lua`, respeta la preferencia `limpiezaPortapapelesAlIniciar`).
Borra primero la selección activa de Wayland (`wl-copy --clear`) y solo después el historial
persistente (`cliphist wipe`) — en ese orden: si el watcher llegara a capturar el clear como una
entrada nueva, el wipe posterior se la lleva también.

### Utilidades cortas de un solo uso

- **`GiGiOS.daltonismo(modo)`** (`gigios/daltonismo.lua`) — aplica o quita un shader de pantalla
  (`decoration.screen_shader`) para protanopia/deuteranopia/tritanopia. Sin sondeo: lo invoca AGS al
  cambiar el ajuste (`hyprctl eval`) y el propio `hyprland.lua` en cada arranque/recarga para
  restaurar `modoDaltonismo` de `preferences.json`; sin argumento lee esa preferencia en el momento,
  sin caché (`util.leer_json`, no `util.prefs()`).
- **`GiGiOS.compactar()`** (`gigios/compactar.lua`) — renumera los escritorios ocupados a IDs
  consecutivos desde 1, moviendo ventanas en silencio y siguiendo al escritorio activo hasta su
  nuevo número. Sale sin hacer nada si no hay ninguna ventana en ningún escritorio. Es el motor que
  usa `gigios/escaner-apps.lua` cuando detecta dos o más escritorios destino (ver esa sección) — y
  por lo que esa sección advierte que los IDs deben releerse **después** de compactar. Al ser una
  llamada Lua síncrona el resultado está disponible al volver (medido: 0,2 ms), sin la carrera que
  había con el script.
- **`GiGiOS.toggle_orion()`** (`gigios/orion.lua`) — antes de tocar nada comprueba el ajuste maestro
  `orion` en `preferences.json`: si está desactivado no manda el toggle a AGS, porque deliberadamente
  no hay ninguna ventana registrada que responda. Luego intenta `ags request toggle-orion` y solo si
  falla o no devuelve `"ok"` cae a `ags toggle orion` — cubre la breve ventana de una recarga en la
  que el config en disco ya se actualizó pero la instancia de AGS en marcha todavía no, sin la cual
  el atajo quedaría inservible justo en ese momento.
  **Era `toggle-orion.sh`**, y lo que pagó el inline fue la comprobación de la preferencia: el script
  la leía con `jq` —un fork de bash y otro de jq en cada pulsación— más una rama de repuesto con
  `grep` por si jq no estaba instalado; aquí es un `util.leer_json` sin procesos ni dependencias. La
  llamada a AGS **sí sigue saliendo a un shell** (`hl.exec_cmd`, asíncrono): un `ags request` dentro
  del callback del bind lo bloquearía, y los callbacks tienen 100 ms. Ausente = activado, así que la
  comprobación es `== false` explícito — un `nil` tiene que dejar pasar. Fail-open hacia "el atajo
  funciona": si la lectura falla, se manda el toggle igual.
- **`GiGiOS.toggle_gaps()`** (definida en `gigios/keybinds.lua`, junto a su bind) — alterna
  gaps/borde/rounding a 0 (modo compacto) y de vuelta al diseño normal. **Los valores de vuelta
  se LEEN de `gigios/ventanas.lua`**, que exporta la tabla `aspecto` (`gaps_in`, `gaps_out`,
  `border_size`, `rounding`) con la que él mismo se configura — antes eran literales copiados en
  el toggle con una advertencia de "replícalo si los cambias", y esa advertencia no da ningún
  error cuando se incumple: el toggle "restauraba" un espaciado que ya no era el tuyo y parecía
  que el atajo estropeaba el diseño. `ventanas.lua` es el **único escritor** de esas cuatro claves
  en todo el config (`reglas.lua` solo las nombra en ejemplos comentados), así que no hay un
  segundo sitio con el que desincronizarse. El `require` va en `pcall` con repliegue a los valores
  de siempre: un error ahí dejaría la sesión **sin ningún atajo** (la trampa nº 1 del config Lua),
  y perder este toggle no vale eso. **`border_size` entra ahora en el ciclo** — el atajo se llamaba
  "toggle-gaps-borders" pero nunca tocó el borde, porque el diseño de hoy lo tiene a 0 y no se
  notaba; subirlo algún día habría dejado un marco pintado en el único modo cuya razón de ser es
  que las ventanas se toquen. El estado vive en una `local` de Lua, no en un fichero de
  `$XDG_RUNTIME_DIR`: igual de efímero, y con la ventaja de que un `hyprctl reload` resetea a la vez
  el flag y los gaps — el esquema viejo restauraba los gaps pero el fichero sobrevivía, así que el
  siguiente toggle "restauraba" un estado en el que ya estabas.
- **`wallpaper.sh`** — aplica fondos; **ya no decide cuál** (eso es
  `wallpaper-select.py`, sección aparte más abajo). Cinco modos: sin argumento (arranque, respeta
  `randomOnStart`), `--random` (botón de Orion), `--auto` (reevaluar la franja horaria, lo llama el
  planificador de AGS), `--grupo <id>` y `<ruta>`. Los campos `current` y `currentGroup` de
  `~/.config/gigios/wallpaper.json` los escribe **siempre este script** tras aplicar un fondo, y
  `randomOnStart` lo escribe **siempre AGS** desde su toggle — cada lado hace read-modify-write
  conservando los campos del otro, así que ninguno pisa el ajuste del otro por accidente. Léelo con
  el mismo cuidado que el resto del repo: `.randomOnStart // true` sería incorrecto (el `//` de `jq`
  trataría un `false` real como ausente). Si el selector falla se repliega al `shuf` de siempre; la
  excepción es `--auto`, que **no** se repliega — sin saber qué franja rige, sortear sería un cambio
  a destiempo y sin motivo visible, y que no pase nada es el fallo correcto ahí.

### Franjas horarias y grupos de fondos (`wallpaper-select.py` + `lib/seleccion_fondos.py`)

El sorteo de fondos ya no es "uno cualquiera de la carpeta": primero se mira **qué fondos están
permitidos a esta hora** y solo entre esos se sortea. El motivo original es que no salga un fondo
claro de madrugada, pero de paso permite atardeceres a su hora. Todo se gestiona desde Orion >
Temas; lo único que sigue haciéndose por el explorador de archivos es **añadir imágenes** a
`Wallpapers/`.

**Son DOS sistemas de franjas, no uno, y mezclarlos fue la primera tentación**:

- Las **franjas globales** (`día`/`tarde`/`noche` de fábrica, N libres) gobiernan los fondos
  **sueltos**. Cada fondo declara en cuáles es apto; **sin declaración es apto siempre**, así que
  estrenar la función —o copiar una imagen nueva a la carpeta— no deja nada invisible sin que nadie
  lo pida.
- La **línea de 24 h propia de cada grupo** gobierna sus variantes, y es **independiente** de las
  globales: un grupo puede mudar a las 5:00 aunque "día" empiece a las 7:00. Cada tramo lleva una
  **lista** de imágenes, no una: con varias se sortea entre ellas.

Ambas listas se definen **solo por el inicio** de cada entrada y llegan hasta el comienzo de la
siguiente, envolviendo la medianoche — con tres franjas se ponen tres horas, no seis. **Antes del
primer inicio del día manda la ÚLTIMA entrada** (la que viene de ayer): a las 00:30 con la primera
franja a las 07:00 rige "noche". Es el caso que se olvida al escribir esta aritmética a mano, y hay
test a los dos lados por eso.

**Un grupo es UNA entidad de cara al sorteo** —es la definición de grupo: para el sistema es un
fondo, no N— y sus imágenes **no compiten además como fondos sueltos**. Si lo hicieran, meter cuatro
variantes en un grupo cuadruplicaría sus posibilidades frente a un fondo suelto. **Un tramo con la
lista vacía es la forma de decir "aquí este grupo no sale"**, que es lo que implementa "un grupo sin
imagen apta para la franja actual queda fuera de la selección" sin necesitar una segunda marca de
aptitud encima de la línea de tiempo. Un grupo cuyas imágenes hayan desaparecido del disco queda
fuera por la misma vía.

**LA DECISIÓN TIENE UN SOLO DUEÑO, y ese es todo el diseño.** Hay **dos** disparadores para la misma
elección: el arranque de la sesión (`wallpaper.sh` desde `gigios/autostart.lua`, en t=0, cuando AGS
todavía no existe) y el cruce de franja (AGS, con el escritorio ya vivo). Con dos implementaciones
acabarían discrepando en silencio — el escritorio mostrando un fondo que el planificador cree que es
otro—, así que la lógica vive entera en `hypr/scripts/lib/seleccion_fondos.py` (**puro**: no lee
ficheros, no mira el reloj; todo entra por parámetros, y tiene 41 pruebas en
`lib/seleccion_fondos_test.py`). `wallpaper-select.py` es su única cara: hace la E/S y emite una
línea `<grupo o vacío>\t<ruta>`. **Python y no jq**: el operador `//` ya ha mordido tres veces en
este repo, y esto es demasiada lógica para bash.

**Al cambiar de franja, un GRUPO conserva su identidad y solo muda de variante; un fondo SUELTO que
deja de ser apto se sustituye por otro al azar**, y si sigue siendo apto no se toca. Eso lo sostiene
`currentGroup` en `wallpaper.json`: sin él, al reevaluar solo se vería una ruta y no habría forma de
distinguir "muda de variante" de "sortea otro fondo".

**Dentro de un tramo con varias imágenes NO se re-sortea en cada pasada** (`preferir` en
`resolver_grupo`): el planificador puede despertar más veces de las previstas —el troceo, una
suspensión, un arranque a mitad de tramo— y sin eso el fondo cambiaría sin haber cruzado ningún
límite. Por lo mismo, `auto` **no imprime nada** si lo que toca ya está puesto: reaplicarlo
dispararía la transición de `awww`, un parpadeo en cada comprobación.

**Fail-open, y en dos escalones.** Si tras aplicar los filtros no queda **ni un candidato** (todo
marcado como no apto de noche), se **ignoran los filtros** y se sortea entre todo lo que haya: un
fondo "equivocado" es visible y corregible, un escritorio sin fondo no. Y si el selector entero falla
—falta python, JSON corrupto, un bug—, `wallpaper.sh` cae a su `shuf` de siempre.

**El reloj lo pone AGS** (`ags/servicios/fondos/planificador.ts`), que es lo único que bash no puede
tener sin convertirse en otro daemon. No decide nada: pregunta `next-change` al mismo script y llama
a `wallpaper.sh --auto`.

**Un solo temporizador, armado exacto, sin sondeo**: se duerme el tiempo que falta y punto — entre
dos cambios de franja el coste es cero, ni un despertar ni un fork. Y ese tiempo es el del próximo
límite **relevante**, no el de cualquier franja definida: `limites_relevantes()` mira el estado, así
que **con un grupo puesto solo cuentan los tramos de ESE grupo** (sus variantes no miran las franjas
globales, luego un cambio de "día" a "tarde" no puede alterar nada mientras él esté en pantalla) y
**con un fondo suelto, solo las franjas globales**. Los tramos de los demás grupos no pueden cambiar
nada de lo que hay en pantalla; despertar por ellos sería trabajo tirado. Sin límites relevantes no
se arma **ningún** temporizador. Se rearma ante las tres cosas que invalidan la cuenta atrás: al
vencer, al editarse `wallpapers.json`, y al cambiar el fondo puesto (`wallpaper.json`) — esto último
es obligatorio desde que el cálculo depende del estado, porque aplicar un grupo cambia por completo
qué límites importan.

**⚠️ La suspensión se resuelve con una señal, no troceando el temporizador.** `GLib.timeout_add`
cuenta sobre el reloj **monotónico**, que no avanza mientras el equipo duerme: una espera de ocho
horas armada de una tacada sonaría ocho horas de *actividad* después, y el caso real es justo ese
(suspendes de día, despiertas de noche con un fondo claro). La primera versión lo cubría **troceando
a 15 min**, o sea despertando 96 veces al día para no hacer nada casi ninguna. Se cubre igual —y con
precisión de segundos en vez de un cuarto de hora de desfase— escuchando **`PrepareForSleep`** de
logind por D-Bus: al volver (`false`) se reevalúa contra el reloj de pared y se rearma. Cuesta una
suscripción y ningún despertar. Sin logind se degrada a corregir en el siguiente límite.

Reevaluar de más sigue siendo gratis (`--auto` no aplica nada si el fondo que toca ya está puesto),
que es lo que permite tirar del rearme sin miedo a parpadeos.

**Config**: `~/.config/gigios/wallpapers.json` (`{version, franjas, grupos, fondos}`), la escribe
solo Orion. **Ausente o vacía = el comportamiento de siempre** (todo apto, sorteo plano), así que
esto no cambia nada hasta que se configura. Ver `ags/CLAUDE.md` para el lado de la UI.

### Monitores de recursos restantes (`battery-monitor.sh`, `temp-monitor.sh`, `ram-monitor.sh`, `disk-monitor.sh`, `bt-monitor.sh`)

Los tres primeros comparten un mismo molde: bucle de sondeo con **solo builtins de bash** en el
camino caliente (sin forks salvo `notify-send`/`jq` cuando de verdad hay algo que decir), histéresis
para no oscilar en el umbral, e **intervalo de sondeo adaptativo** (más corto cerca del umbral, más
largo con margen de sobra) para reducir despertares. Los tres leen su interruptor de
`preferences.json` **una sola vez al arrancar** con el mismo cuidado repetido por todo el repo: NO
`.claveMonitor // true`, porque el operador `//` de `jq` trata un `false` literal como ausente y ese
"apagado" nunca surtiría efecto — se lee con `if has(...)`.

- **`battery-monitor.sh`** — sondeo adaptativo (30/60/90 s) de `/sys/class/power_supply/BAT0`. Nunca
  avisa de modo ahorro ni de batería baja mientras carga (se resetean los flags al pasar a
  `Charging`). Espeja el umbral de ahorro de energía de AGS leyendo
  `~/.config/power-save/config.json` cada 10 min como mucho. El primer estado tras arrancar
  (`prev_status=""`) se trata como válido en vez de como un caso aparte, para no disparar un falso
  "cargador desconectado" en el login. La detección de "carga completa" cubre tanto `status=Full`
  como `Charging` al 100 % — hay baterías que nunca reportan `Full`.
- **`temp-monitor.sh`** — resuelve la ruta sysfs de `coretemp` ("Package id 0") **una sola vez** al
  arrancar, no en cada vuelta; la GPU usa `nvidia-smi` (este driver no expone temperatura por hwmon
  en esta máquina) solo si está presente. Histéresis 85 °C/80 °C, sondeo 15 s cerca del umbral, 60 s
  en reposo.
- **`ram-monitor.sh`** — usa `MemAvailable` de `/proc/meminfo`, no un porcentaje de uso: es la
  estimación del propio kernel de lo reutilizable sin llegar a swap (descuenta caché reclamable), así
  que no confunde el cacheo agresivo normal de Linux con memoria realmente agotada. Umbral absoluto en
  MB (no %) porque el mismo porcentaje significa márgenes reales muy distintos en un portátil de 4 GB
  que en un sobremesa de 32 GB. El parseo aprovecha que `MemAvailable` sale entre las primeras líneas
  del fichero para cortar el bucle en cuanto aparece.
- **`disk-monitor.sh`** — **no es un daemon**: corre una vez al login y sale. El espacio libre no
  tiene fuente de eventos y quedarse sin él es raro, así que una sola comprobación al arrancar es el
  compromiso correcto — coste cero el resto de la sesión. Deduplica por dispositivo (los subvolúmenes
  btrfs reportan el mismo dispositivo bajo varios puntos de montaje) e ignora particiones por debajo
  de 6 GB (EFI, boot) por no valer la pena vigilarlas. Con **dos o tres sistemas de ficheros al
  límite** (típico con `/` y `/home` separados) salía un popup por cada uno: el barrido de `df` es
  una sola pasada, así que se encolan y se vuelcan al terminarlo, sin retrasar nada
  (`lib/notif-agrupar.sh`). El punto de montaje pasó del **título** al cuerpo — un título fijo es
  lo que permite fundir dos discos en «2 discos casi llenos», y el dato no se pierde, cambia de sitio.
- **`bt-monitor.sh`** — distingue una pérdida de Bluetooth **inesperada** de una intencionada.
  Suscripción única y siempre activa a D-Bus del sistema (barata mientras bloquea) a los eventos
  `PropertiesChanged` de `Connected` y a las llamadas al método `Disconnect()` de BlueZ: una
  desconexión manual (`bluetoothctl`, ajustes de GNOME/KDE, blueman — cualquier cosa que pase por la
  API estándar) se reconoce por esa llamada a `Disconnect()` y se calla si el `Connected: false`
  correspondiente llega dentro de una ventana de 5 s; y si el adaptador está apagado tampoco avisa
  (apagar el Bluetooth no es "perder" un dispositivo). Una pérdida genuina espera 10 s de gracia
  (cubre desconexiones breves con auto-reconexión) antes de confirmar y notificar, comprobando de
  nuevo el estado al vencer esa gracia. El nombre del dispositivo se captura en el momento de la
  caída, mientras todavía está en la caché de `bluetoothd` — puede dejar de resolverse una vez
  desconectado de verdad.
  **Los dispositivos no se pierden de uno en uno**: salirte del alcance o un fallo del controlador
  tumban a la vez los cascos, el ratón y el mando, y eso eran tres críticas con `-t 0` diciendo lo
  mismo (al revés igual: al encender el Bluetooth se reconectan en cascada). El vencimiento de la
  gracia **ya era** el lote para las pérdidas, así que agruparlas no retrasa nada respecto a antes;
  las conexiones, que eran instantáneas, se retienen `COALESCE=2` s — lo justo para que la cascada
  quepa en un aviso, en un popup informativo que dura 6.
  Ese temporizador **ya no es un `( sleep GRACE ) &` por dispositivo sino el `read -t` del bucle
  principal**, por el mismo motivo que en `usb-monitor.sh`: notificar desde el subshell impide ver
  que hay otros dos a punto de decir lo mismo. Efecto lateral bueno: una reconexión dentro de la
  gracia ahora **anula** la pérdida pendiente en memoria en vez de resolverse con dos consultas más
  a `bluetoothctl`.

