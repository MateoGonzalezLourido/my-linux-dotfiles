# Suspensión falsa

> **Estado: PROPUESTA. Nada de esto está implementado todavía.** Este documento fija el diseño
> antes de escribir código: qué se reutiliza, qué es nuevo, qué se descartó y qué falla en
> silencio si se hace de otra forma. Cuando se implemente, lo que quede vivo de aquí se resume en
> [`hyprland-modulos.md`](hyprland-modulos.md) (una sección más) y este fichero se queda como el
> porqué largo.

## El problema

La suspensión real (S3) **rompe cosas**. Una descarga a medias muere por timeout, una compilación
larga se congela con el reloj de pared corriendo, una sesión SSH se cae, un backup a medio subir
se queda a medias, y el dongle Bluetooth se reenumera al volver (ver la sección de BT en
`ags/CLAUDE.md`). Pero al dejar el equipo desatendido lo que se quiere es justo lo que la
suspensión da: pantalla apagada, ventiladores callados, batería que no se evapora.

La **suspensión falsa** es el punto medio: se apaga todo lo que se puede apagar **sin detener el
kernel**. La red sigue viva, los procesos siguen corriendo, el reloj no da un salto — y aun así el
escritorio queda tan quieto y tan barato como se pueda.

## Qué NO es

- **No reemplaza a la suspensión real, y no se acerca a su consumo.** Un S3 baja a ~0,3 W; esto
  deja la CPU en idle con la red viva, que en este portátil son varios vatios. Si no hay nada que
  proteger, la suspensión de verdad sigue siendo la respuesta correcta.
- **No es un "modo ahorro más agresivo"** aunque comparta casi toda la maquinaria. El modo ahorro
  reacciona a la batería y el usuario sigue delante; la suspensión falsa la pide el usuario
  explícitamente y **asume que se va**.
- **No congela nada por su cuenta.** La lista de apps a congelar nace vacía y la escribe el
  usuario, por el motivo del apartado «Congelar apps».

## Lo que ya existe y se reutiliza tal cual

La mayor parte de esta función **ya está escrita**: es un orquestador, no un subsistema. Antes de
añadir mecanismo nuevo, comprobar que no esté aquí.

| Necesidad | Pieza existente |
|---|---|
| Apagar la pantalla | `hypr/scripts/idle-action.sh dpms-off` (la TABLA `{action='off'}`, nunca el string) |
| Vetar la suspensión **real** de hypridle | contrato de `wakeup.json` + `blocked()` en `idle-action.sh` |
| Congelar el sondeo de fondo (updates, smartctl, unidades, clamscan) | `powerSaveFreeze` en `runtime-state.json` → `hypr/scripts/lib/gaming-gate.sh` |
| Apagar cava, preview de escritorios (grim), mascota, píldora de Spotify | `spectrumSuspended`, `wsPreviewSuspended`, `mascotaSuspended`, `spotifyBarSuspended` (`servicios/energia/powerState.ts`) |
| Opacar paneles y ventanas (mata blur y transparencias) | `transparenciaSuspendida`, `opacidadVentanasForzada` |
| Bajar el brillo con apunte en disco para no perderlo si AGS muere | `servicios/energia/brilloAhorro.ts` + `brightnessBefore` |
| TLP a perfil `ahorro` | `tlpAutoInPowerSave` + `/usr/local/bin/gigios-tlp-apply` |
| Bloquear la sesión | `pidof hyprlock \|\| hyprlock` (la guarda de instancia única, que hyprlock NO tiene) |
| Silenciar popups sin perder notificaciones | `notifd.dontDisturb` con la disciplina `autoOwned` de `modulos/notificaciones/autoDnd/watcher.ts` |

### El lever más grande, y es gratis

Con **DPMS apagado el compositor deja de emitir frame callbacks** a ese output, y todo cliente
Wayland bien educado (Firefox, Discord, el propio AGS/GTK4) **deja de pintar solo**. No hay que
"parar el renderizado de AGS" a mano para conseguir el grueso del ahorro: lo consigue el `dpms
off` que ya está escrito.

Ocultar las ventanas de AGS (`visible={false}`) sigue mereciendo la pena, pero por otra razón: un
widget oculto no ejecuta sus `GLib.timeout_add` de repintado (reloj, chips, medidores). El ahorro
es de timers y de wakeups de CPU, no de GPU. **No lo vendas como lo que apaga el renderizado.**

Corolario para el diseño: **apagar la pantalla es lo PRIMERO de la secuencia de entrada**, no lo
último. Todo lo que venga después ya se ejecuta con el sistema medio dormido.

## Secuencia de entrada

En este orden, y el orden importa:

1. **Marcar el estado** (`suspensionFalsaActiva` en RAM + fichero de estado en disco, ver abajo).
   Primero, para que nadie corra un tick de mantenimiento durante los pasos siguientes.
2. **DPMS off** vía `idle-action.sh dpms-off`.
3. **Bloquear** (opcional, por defecto **sí**): `pidof hyprlock || hyprlock`. Es además la puerta
   de salida — ver «Cómo se sale».
4. **DND** encendido con la marca `autoOwned`, para no pisar una elección manual del usuario.
5. **Suspensiones del shell**: los flags de `powerState.ts` ya existentes se activan por OR con el
   estado de suspensión falsa (cava, preview, mascota, Spotify, opacidad, sondeo de fondo).
6. **Ocultar las ventanas de AGS.**
7. **Brillo a 0** por el camino de `brilloAhorro.ts`, con su apunte en disco. Con DPMS off no se ve
   nada, pero el apunte evita que al volver el panel encienda a pleno brillo en una habitación a
   oscuras.
8. **Retroiluminación de teclado y LEDs a 0** (ver «Qué más se apaga»).
9. **TLP a `ahorro`**, si procede (ver «Ajustes»).
10. **Congelar las apps del allowlist**, si hay alguna. Lo último porque es lo único
    potencialmente destructivo.

## Secuencia de salida

Exactamente la inversa, y con una regla: **restaurar solo lo que impusimos nosotros.** Es la misma
disciplina que ya aplican `brilloAhorro.ts` (compara contra `ultimoAplicado`) y el watcher de
auto-DND (`autoOwned` / `userOptedOut`). Si el usuario tocó el brillo, el DND o el perfil TLP
durante la suspensión falsa, **manda lo suyo y no se restaura nada de eso**.

El deshielo de las apps congeladas va **primero**, no último: una app congelada que recibe eventos
de entrada antes de descongelarse llega al escritorio con una cola de basura.

## Contrato del estado en disco

El lado bash (`idle-action.sh`, `gaming-gate.sh`) necesita saber si hay una suspensión falsa
puesta. Contrato, calcado del de `wakeup.json`:

```json
{ "active": true, "until": 1756480000, "pid": 4231, "thenSuspend": false }
```

- `until`: epoch **absoluto** en segundos, o `null` sin límite. Absoluto y no un contador, por lo
  mismo que en `wakeup.json` y `lastGameFocus`: el lado bash lo resuelve contra el reloj de pared
  sin que nadie tenga que reescribir el fichero.
- `pid`: el de AGS. **Es una guarda, no información.** Sin ella, un AGS caído con la suspensión
  falsa puesta dejaría el mantenimiento congelado y la suspensión real vetada **para siempre, en
  silencio y sin UI donde apagarlo**. Mismo patrón y mismo motivo que `wakeup.json` y
  `runtime-state.json`.
- `thenSuspend`: qué hacer al vencer `until` (ver «Salir a suspensión real»).

### Dónde vive: cuidado con el fichero compartido

`runtime-state.json` lo reescribe **entero** `servicios/energia/gamingState.ts` en cada cambio.
**Dos escritores sobre el mismo JSON se pisan** (esto ya está documentado allí como el motivo de
que `powerSaveFreeze` viaje en ese fichero y no en uno propio). Así que hay dos opciones válidas y
una mala:

- ✅ Extender el escritor de `gamingState.ts` con las claves nuevas.
- ✅ Fichero propio, `~/.config/gigios/suspension-falsa.json`, con su propio escritor único.
- ❌ Escribir en `runtime-state.json` desde un segundo módulo.

### ⚠️ NO reusar `forcePowerSave`

La tentación evidente es encender `forcePowerSave` y dejar que todo el modo ahorro se dispare
solo. **No.** `forcePowerSave` es un ajuste **persistido** en `~/.config/power-save/config.json`:
si AGS muere durante la suspensión falsa, el usuario se queda en ahorro forzado permanente, con el
brillo bajo y los paneles opacos, sin ninguna pista de por qué.

Lo correcto es un estado **en RAM** que se OR-ea con `powerSaveActive` en los computeds que ya
existen — igual que `backgroundJobsSuspended` combina hoy dos motivos. Un crash devuelve el
escritorio a su sitio, que es el modo de fallo que se quiere.

El residuo físico es la excepción: **el brillo y el perfil TLP sí sobreviven al proceso** (el
brillo por DDC se graba en la firmware del monitor; TLP escribe `/etc/tlp.conf`). Esos dos ya
tienen su mecanismo de apunte en disco y restauración diferida en `brilloAhorro.ts` — reutilizarlo,
no inventar otro.

## El veto de la suspensión real

Sin esto la función **no sirve para nada**: a los 20 min el listener de `hypridle.conf` dispara
`idle-action.sh suspend` y el equipo se suspende de verdad, con las descargas que se quería
proteger.

`blocked()` en `idle-action.sh` tiene que consultar también el estado de la suspensión falsa,
conservando literalmente sus dos reglas actuales:

- **REGLA DE ORO — fail-open.** Sin fichero, sin `jq`, con JSON corrupto, con `until` vencido o con
  el pid muerto → **se ejecuta la acción**. Un fallo aquí debe degradar a "la suspensión falsa no
  funciona" (visible y arreglable), nunca a "el PC no se suspende jamás" (silencioso, permanente y
  se come la batería).
- **La caducidad se resuelve contra `now`**, no fiándose de que alguien reescriba el fichero.

Alcance: veta `suspend`. **No veta `dpms-off` ni `lock`** — ya estamos apagados y bloqueados, y
dejarlos pasar no hace daño. `dpms-on` no se veta nunca, como hoy.

Y lo de siempre: hypridle **no repite un `on-timeout` ya disparado**, así que al salir de la
suspensión falsa hay que **reiniciar hypridle** para rearmar los contadores desde cero. Eso ya lo
hace `servicios/pantalla/reinicioHypridle.ts` para el Wake up; se llama igual.

## Congelar apps del usuario

El primer instinto es `SIGSTOP` a un PID. Está mal: los hijos se escapan, el árbol no se para
atómicamente y `SIGCONT` no garantiza el orden. La primitiva correcta es el **freezer de cgroups**,
que en esta máquina está disponible y es un one-liner, porque las apps salen en scopes propios:

```
app-discord-17743.scope
app-org.chromium.Chromium-4948.scope
```

```sh
systemctl --user freeze app-discord-17743.scope
systemctl --user thaw   app-discord-17743.scope
```

Congela el árbol entero, atómicamente, y descongela limpio.

### La lista es un allowlist explícito y nace VACÍA

Y esto no es prudencia decorativa:

- **Nunca congelar nada con red viva.** Un Firefox o un Chromium congelado cierra su ventana TCP y
  **la descarga muere por timeout exactamente igual que con la suspensión real** — o sea, el fallo
  que esta función existe para evitar, reintroducido por la puerta de atrás. Discord congelado se
  limita a reconectar al volver, que es tolerable.
- **Nunca congelar una slice entera.** Bajo `app.slice` conviven `xdg-desktop-portal-gtk`,
  `dconf.service` y el registry de a11y: congelar el conjunto es un deadlock del escritorio en
  cuanto algo pida un portal, y el síntoma no se parece en nada a la causa.
- **Nunca**: AGS, Hyprland, `pipewire`/`wireplumber`, NetworkManager, ni nada con un lock de D-Bus
  que otro proceso necesite mientras tanto.
- **Nada de congelar por clase o por heurística.** El usuario elige por nombre, una a una, en
  Ajustes. El coste de equivocarse aquí lo paga en datos perdidos, no en un tirón de framerate.

El scope lleva el PID en el nombre (`app-discord-17743.scope`), así que la lista se guarda por
**nombre de app** y el scope se resuelve en el momento con `systemctl --user list-units --type=scope`.

## Cómo se sale — el punto de diseño que más fácil se rompe

Con la pantalla apagada **por nuestra mano**, el `on-resume` del listener de DPMS de
`hypridle.conf` **no se dispara**: hypridle solo emite `on-resume` de un timeout que disparó él.
Si el deshielo cuelga de ese evento, la sesión se queda congelada **sin forma de volver** — y con
las ventanas de AGS ocultas no hay ni UI donde apagarlo.

La salida robusta es **hyprlock como puerta**:

1. Una tecla enciende la pantalla. El ratón **no** (`mouse_move_enables_dpms = false` en
   `gigios/ventanas.lua`), lo cual aquí es una ventaja: un roce en la mesa no despierta el equipo.
2. Aparece hyprlock. El usuario desbloquea.
3. El desbloqueo dispara la secuencia de salida.

Además, y sin excepción, **un atajo de escape directo** (`SUPER + …`) que salga de la suspensión
falsa sin pasar por nada. Es la red de seguridad: si el paso 3 falla, el atajo sigue estando ahí.
Registrarlo con el envoltorio `bind()` de `gigios/keybinds.lua`, nunca con `hl.bind` directo — si
no, no da error, solo deja un bind sordo (ver `gigios/nop-binds.lua`).

Con la opción de bloqueo desactivada, la salida es solo el atajo. Conviene decirlo en la UI.

## Salir a suspensión real

La adición que convierte esto de parche en **espera**: `thenSuspend`. Cuando la razón para no
suspender deja de existir, se suspende de verdad, sin que el usuario tenga que volver.

- **Por tiempo**: «suspensión falsa 40 min, luego suspender».
- **Por condición**: «suspender de verdad cuando no queden descargas activas». La vigilancia de la
  carpeta de descargas ya existe en `oom-monitor.sh` (`monitor_downloads`, con la carpeta resuelta
  por `xdg-user-dir DOWNLOAD` — aquí es `~/Descargas`, no `~/Downloads`).

Ojo: al llegar el momento hay que **salir primero de la suspensión falsa** (deshelar apps,
restaurar TLP, quitar el veto) y solo entonces `systemctl suspend`. Suspender con apps congeladas
deja el freezer puesto al despertar.

## Qué más se apaga

- **Retroiluminación del teclado y LEDs a 0.** Es el delator visual de que el equipo no está
  suspendido de verdad. Cuidado con el tropiezo ya documentado del brillo: `brightnessctl` **sin**
  `-c backlight` cae al primer dispositivo `leds` y enciende el LED de scroll-lock — aquí queremos
  justo la clase `leds`, así que el selector va explícito en la otra dirección
  (`brightnessctl -d <dispositivo> …`), nunca implícito.
- **Bluetooth off**, opcional y apagado por defecto: es lo que hace de facto la suspensión real, y
  el dongle RTL se reenumera igual al encender.
- **Silenciar el audio**, opcional y apagado por defecto: puede que la música sea justo lo que se
  quiere dejar sonando.

## Qué se descartó, y por qué

- **Modo juego / `gamemode`: no ayuda, hace lo contrario.** Sube el gobernador de CPU a
  `performance` y ajusta prioridades para dar MÁS recursos. Lo aprovechable de la infraestructura
  de juegos no es GameMode sino el **gate** (`lib/gaming-gate.sh`), que ya congela el sondeo caro y
  ya tiene un segundo motivo (modo ahorro) — la suspensión falsa es simplemente un tercero.
- **Congelar `hyprpaper` o apagar animaciones y blur por `hl.config`**: innecesario. Sin frame
  callbacks no pinta nadie. Añadirlo sería mecanismo que no se puede probar que haga algo.
- **Apagar la Wi-Fi**: contradice el motivo de existir de la función.
- **`systemctl --user stop` de servicios**: parar no es congelar. Un servicio parado pierde estado
  y puede no volver; el freezer conserva el proceso intacto.

## Ajustes nuevos

En Ajustes > Energía, sección propia. Todo lo que **se ve o puede perder datos** nace apagado, que
es la regla que ya siguen `opaquePanels`, `opaqueWindows`, `reduceBrightness` y `tlpAuto`.

| Ajuste | Por defecto |
|---|---|
| Bloquear al entrar | **sí** (es la puerta de salida) |
| Apagar retroiluminación de teclado / LEDs | sí |
| No molestar mientras dure | sí |
| Apps a congelar | **lista vacía** |
| Apagar Bluetooth | no |
| Silenciar audio | no |
| Al vencer el plazo: nada / suspender de verdad | nada |

### El TLP ya tiene su ajuste — no añadas un segundo

`tlpAuto` (`~/.config/power-save/config.json`, Ajustes > Energía) ya existe, ya nace apagado y ya
es exactamente la pregunta «¿quieres que el perfil TLP baje a ahorro?». La suspensión falsa debe
**respetarlo**, no duplicarlo. Un segundo interruptor con la misma pregunta obliga al usuario a
mantener dos ajustes coherentes y garantiza que algún día no lo estén.

Si de verdad se quiere desacoplar (ahorro sin TLP pero suspensión falsa con TLP), la forma es un
tercer valor en el ajuste existente, no un interruptor paralelo.

## Superficie de UI

- **Función conmutable en el menú de la barra**, junto a «Wake up»: `FUNCIONES_BARRA` en
  `modulos/barra/funciones/registro.ts`, con `estado` (chip con el tiempo restante, como
  `textoChipMantenerDespierto`) y `expandir` para el plazo y el destino final.
- **Atajo de teclado** para entrar y para salir (ver «Cómo se sale»).
- **Menú de energía**: encaja conceptualmente, pero ojo — `ACCIONES_ENERGIA`
  (`modulos/menu-energia/acciones.ts`) es una lista de **comandos de shell** (`comando: string`)
  que se ejecutan con `execAsync`. Una acción interna del shell no cabe en ese tipo sin cambiarlo.
  Las dos salidas: ampliar el tipo con una acción opcional, o exponer la entrada como un comando
  (un script, o `astal`/IPC). La segunda es más barata y además da un punto de entrada scriptable.

## Trampas conocidas, antes de escribir una línea

1. **`hl.dsp.dpms('off')` es un TOGGLE.** El argumento tiene que ser una TABLA. Con string,
   `tableToggleAction()` sale por `if (!lua_istable(...)) return TOGGLE_ACTION_TOGGLE`, tira el
   `'off'`, invierte el estado y responde `ok` — rc 0, stdout `ok`, acción invertida. Ver la
   sección «Salir de suspensión» de [`hyprland-modulos.md`](hyprland-modulos.md). **Usar
   `idle-action.sh`, que ya lo tiene bien**, en vez de escribir el dispatcher otra vez.
2. **No meter llaves `{}` en `hypr/hypridle.conf`.** El parser de Ajustes > Pantalla trocea los
   listeners con `listener\s*\{[^}]*\}` y una llave de tabla Lua corta el bloque antes de tiempo:
   el listener deja de ser editable desde la UI **en silencio**. Es el motivo de que
   `idle-action.sh` exista.
3. **hyprlock no tiene guarda de instancia única.** Lanzarlo con uno ya puesto arranca un segundo
   proceso de verdad. Siempre `pidof hyprlock || hyprlock`.
4. **Editar un `*-monitor.sh` no afecta al que ya está corriendo.** Hace falta `pkill -f <script>`
   + relanzar, o `hyprctl reload full-reset` (un `hyprctl reload` normal **no** re-ejecuta el
   autostart).
5. **`jq '.clave // true'` trata un `false` literal como ausente** y siempre resuelve a `true`. Para
   los ajustes booleanos nuevos, la forma es `if has("clave") then … else … end` (mismo tropiezo ya
   documentado en `battery-monitor.sh`, `temp-monitor.sh` y `gaming-gate.sh`).
6. **Nada bloqueante en un callback de Hyprland**: `hl.on` y los binds con función tienen **timeout
   de 100 ms**.
7. **Los PID se reciclan.** La guarda de pid necesita su otra mitad: reescribir el fichero de
   estado al arrancar el shell, como hacen `initGamingState()` e `initWakeUp()`.

## Plan de implementación

Por fases, cada una útil por sí sola y probable de forma aislada:

1. **Núcleo**: estado en RAM + fichero + entrada/salida con DPMS, bloqueo, DND, flags de
   `powerState`, ocultar ventanas de AGS. Atajo de escape **desde el primer commit**.
2. **Veto**: `blocked()` en `idle-action.sh` + reinicio de hypridle al salir.
3. **UI**: función de la barra con chip de tiempo, sección de Ajustes > Energía.
4. **Brillo, LEDs y TLP**, reutilizando los caminos de apunte/restauración existentes.
5. **`thenSuspend`** por tiempo, y luego por condición (descargas).
6. **Congelar apps.** La última a propósito: es lo único que puede perder datos del usuario.

### Cómo probar cada pieza

- Que el veto funciona: entrar en suspensión falsa, bajar el timeout de suspensión de
  `hypridle.conf` a 60 s, esperar. Debe **no** suspenderse. Repetir matando AGS a mano: debe
  suspenderse (fail-open).
- Que la salida funciona con la pantalla apagada por nuestra mano y **sin** que ningún listener de
  hypridle haya vencido. Es el caso que rompe el diseño ingenuo.
- Que un crash de AGS a mitad devuelve el escritorio a su sitio: `pkill ags` con todo puesto y
  mirar brillo, opacidad, DND, TLP y apps congeladas.
- Que una descarga larga sobrevive a un ciclo completo de entrada y salida. Es el motivo de existir
  de la función y debería ser el primer test que se escribe.
