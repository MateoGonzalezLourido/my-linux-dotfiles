# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An [AGS v2](https://github.com/Aylur/ags) (Astal) desktop shell for Hyprland/Wayland, written in TypeScript + JSX targeting GTK4. It renders a per-monitor bar plus a collection of panels and overlays. There is no `package.json`, `tsconfig.json`, or test suite — AGS itself owns bundling, transpilation, and the runtime. `@girs/` holds generated GObject type stubs for editor support only.

## Running

```sh
ags run ~/.config/ags/app.ts     # launch/reload the shell
```

When a Hyprland restart is needed, use `hyprctl reload full-reset`: it also re-runs the
autostart entries from `hypr/gigios/autostart.lua`. A plain `hyprctl reload` only reloads the
configuration and does not restart those autostart processes.

There is no build/lint/test step for the shell itself. To verify a UI change, run the shell and observe it. `estilos/out.css` is a compiled artifact from `estilos/style.scss` — do not edit it by hand. Its source map is **not** kept next to it (see Styling below).

Pure-logic modules (no GTK imports) are covered by Node's built-in test runner:

```sh
node --test $(rg --files modulos servicios textos -g '*.test.ts')
```

Run the full suite or a single file. Tests live alongside their implementation files (e.g. `engine.ts` / `engine.compile.test.ts`).

## Architecture

`app.ts` is the entry point. Inside `app.start({ css, main })`, every top-level window is instantiated **once per monitor** via `app.get_monitors().map(Component)` (`Barra` uses `.flatMap`). Adding a new top-level window means importing it in `app.ts` and adding a `.map(...)` line. `CalendarPanel` is wrapped in try/catch as the pattern for windows that may fail to construct.

**Los `init*` de fondo van en un `setTimeout(…, 4000)`, no sueltos en `main()`.** Ninguno se ve
(son vigilantes y un barrido de limpieza) y corriendo a pelo competían con la construcción de las
ventanas —una por monitor— justo mientras se pinta el escritorio; `initAutoDnd`/`initGamingState`
además consultan `isGameClient`, que puede acabar parseando los ~161 `.desktop` del sistema
(`Gio.AppInfo.get_all`) para decidir si una ventana es un juego. Apartarlos es seguro porque
**ninguno depende de eventos ocurridos mientras esperan**: `initTrayApps` e `initGamingState`
**siembran** de lo vivo (`tray.get_items()` / `hypr.get_clients()`) *antes* de suscribirse, así
que a los 4 s ven un superconjunto; `initAutoDnd` adopta el DND al empezar; e
`initNotifDaemonCheck` va suscrito a `NameOwnerChanged` y de hecho **gana** fiabilidad (a los
pocos ms el dueño del nombre aún se resuelve). Un `init*` nuevo va ahí **salvo que siembre de un
    evento en vez de del estado**. La excepción es **`inicializarMantenerDespierto()`, que sigue a t=0**: su único
trabajo es limpiar estado heredado peligroso (un `wakeup.json` con `active:true` vetando la
suspensión sin UI que lo enseñe), y es un borrado de fichero — retrasar justo eso no tiene
sentido. Parte del escalonado de arranque del sistema; el calendario completo está en
`hypr/gigios/autostart.lua`.

### State and reactivity

- Reactive state comes from `createState` in the `ags` module: `const [value, setValue] = createState(initial)`.
- Read current value with `.get()`, react with `.subscribe(cb)`.
- In JSX props, bind by passing a transform: `prop={state((v) => derived)}`.
- **`estado/shell.tsx` is the global state hub.** It exports panel-visibility states and the composite `anyPanelVisible`, plus orchestration helpers like `closeAllPanels`, `openQuickSettings`, `openPowerMenu`. Panels are **mutually exclusive**: opening one calls `closeAllPanels()` first.
- La `Barra` autoocultable permanece visible mientras `anyPanelVisible` sea verdadero. **Al añadir un panel, incorpora su estado de visibilidad a `panelStates` en `estado/shell.tsx`**: ese registro se propaga a `anyPanelVisible` y a sus suscriptores. Añade también su cierre a `closeAllPanels()`.
- `panelAutoClose(close, graceMs?)` in `state.tsx` returns `{ onEnter, onLeave }` handlers for a `Gtk.EventControllerMotion` child — centralizes the mouse-leave-then-close pattern all bar panels share.
- Los menús anclados usan `crearControlPopoverAnclado()` con el `ControlVisibilidadBarra` de su monitor; así retienen solo esa barra y liberan la retención de forma idempotente al cerrar o desmontarse.

### Modules / hardware access

System services are GObject libraries imported as `gi://Astal*` (e.g. `AstalWp` audio, `AstalHyprland`, `AstalNetwork`, `AstalBluetooth`, `AstalMpris`, `AstalNotifd`, `AstalBattery`, `AstalTray`). Shelling out uses `ags/process`. Low-level GLib/Gio via `gi://GLib`, `gi://Gio`.

### JSX / GTK4 idioms

- Widgets and JSX runtime come from `ags/gtk4`; `app` from `ags/gtk4/app`.
- Event controllers are written as JSX children, not props: `<Gtk.EventControllerMotion onEnter={...} />`.
- Top-level panels are Layer Shell windows (e.g. Orion uses OVERLAY layer, anchored BOTTOM|LEFT|RIGHT, EXCLUSIVE keymode).

### Styling

Global stylesheet lives in `estilos/` (`style.scss`, large, ~90KB), not loose in `ags/` root —
keeps the three style-related files (source, shared palette, compiled output) together instead of
scattered next to `app.ts`. `estilos/_colores.scss` holds the shared color/font palette
(`$bg-bar`, `$blue`, `$violet`, `$red`, `$orange`, `$pink`, `$teal`, `$text`, `$font-icon`, …) as
the single source of truth; `style.scss` pulls it in with `@use 'colores' as *;` so every existing
unprefixed `$blue`/`$text`/… reference keeps working. **`app.ts` imports `./estilos/out.css`, not
the SCSS** — AGS does *not* compile SCSS at runtime, so editing `style.scss` has no visible effect
until you regenerate the artifact:

```sh
sass --no-charset --source-map-urls=absolute estilos/style.scss estilos/out.css   # from ags/
mv estilos/out.css.map ~/.cache/gigios/out.css.map
sed -i "s#sourceMappingURL=out.css.map#sourceMappingURL=file://$HOME/.cache/gigios/out.css.map#" estilos/out.css
```

**El mapa NO se queda junto al CSS, a propósito.** `sass` no tiene una opción para elegir dónde
escribe el `.map` por separado del `.css` — siempre lo escribe al lado con el mismo nombre base —
así que dejarlo así habría añadido un cuarto fichero suelto (y sin versionar, ya que ni siquiera se
commitea) justo en el directorio que se quería despejar. Se compila con
`--source-map-urls=absolute` para que las rutas a los `.scss` de origen que quedan grabadas
**dentro** del mapa sean absolutas — así el mapa sigue apuntando a las fuentes correctas aunque ya
no viva en el mismo directorio que ellas — y solo entonces se mueve a
`~/.cache/gigios/out.css.map` (mismo sitio que el resto de caché no versionada del proyecto, ver
`sysinfo.json` en `modulos/ajustes/sistema/`) reescribiendo el comentario final de `out.css` para
que apunte ahí. `--no-charset` sigue siendo obligatorio porque GTK CSS rechaza el `@charset` de
Sass. Dark catppuccin-inspired theme. Class-name prefixes scope features: `.nb-*`/`.np-*`/`.notif-*`/`.ns-*`
for notifications, etc. Los módulos autocontenidos pueden conservar su propio SCSS, como
`modulos/orion/orion.scss` — que a su vez consume `estilos/_colores.scss` (`@use
'../../estilos/colores' as c;`) para sus tokens `$j-accent`/`$j-text-primary`/`$j-bg-shell*` en vez
de repetir los mismos hex; solo `$j-accent-pink` es un tono propio sin equivalente en la paleta
global. UI uses JetBrainsMono Nerd Font glyphs throughout for icons.

Palette: `#08080c` bar bg; `#cba6f7` violet, `#89b4fa` blue, `#f38ba8` red, `#fab387` orange, `#f9e2af` yellow, `#a6e3a1` green, `#94e2d5` teal.

## Feature areas

- `modulos/barra/Barra.tsx` + `modulos/barra/*` — barra autoocultable y sus dominios. La raíz de `barra/` conserva solo el compositor principal; la implementación se agrupa en `escritorios/`, `bandeja/`, `juegos/`, `funciones/`, `indicadores/`, `multimedia/`, `controles/` y `componentes/`. Los indicadores se subdividen por `audio`, `conectividad`, `energia`, `notificaciones`, `sistema` y `tiempo`. No vuelvas a acumular widgets de dominio en la raíz. La visibilidad compartida vive en `estado/visibilidadBarra.ts`, la lógica de mantener despierto en `servicios/energia/` y el menú superior de energía en `modulos/menu-energia/` porque tienen responsabilidades o consumidores fuera de la barra.
  El autoocultado es una preferencia (`barAutoHideEnabled`, activada por defecto): al desactivarlo se interrumpen las rutas de ocultado, `showNow()` baja la barra y la ventana pasa de `Exclusivity.NORMAL` a `EXCLUSIVE` para que Hyprland reserve sus 38 px. Se aplica en caliente. **Esa zona exclusiva también desplaza las demás superficies ancladas arriba**: todas pasan por `barTopMargin(px)` (`modulos/ajustes/preferences.ts`), que reduce el margen a 0 cuando el autoocultado está desactivado; `NotificationPopup.tsx` hace lo mismo mediante `panelOffset()`. Las ventanas con exclusividad `IGNORE` no se desplazan.
- `modulos/barra/funciones/` — **el menú del logo Arch.** `estado.ts` declara el estado en RAM, `registro.ts` compone las entradas y `FilaFuncion.tsx`/`ChipEstadoFuncion.tsx` las presentan. Los campos opcionales son `estado` (texto del chip derecho) y `expandir` (referencia al componente desplegable).
  - Las filas conservan una caja estable para que un `<With>` remontado no cambie su posición. En la barra, el mismo contrato lo centraliza `componentes/RanuraCondicionalBarra.tsx`, sin hueco ni transición cuando la función está apagada.
  - **`OpcionesMantenerDespierto` va FUERA del `<button>` de la fila**, no dentro: dentro, cualquier clic en el campo de minutos o en el interruptor "Pantalla" llegaría también al botón y apagaría la función.
  - **Mantener despierto** usa `servicios/energia/mantenerDespierto.ts` y `tiempoMantenerDespierto.ts`, este último puro y probado. Mantiene el PC despierto N minutos, o sin límite si el campo va vacío. `hypr/scripts/idle-action.sh` decide finalmente sobre los `on-timeout` de hypridle; el servicio publica `~/.config/gigios/wakeup.json` `{active, until, screen, pid}`. **`until` es epoch absoluto** y **`pid` es el de AGS**. `inicializarMantenerDespierto()` limpia al arrancar cualquier veto heredado. Al apagarse **reinicia hypridle** para rearmar los timeouts. Detalle completo en el `CLAUDE.md` raíz.
- `servicios/juegos/` + `modulos/barra/juegos/IndicadorJuegos.tsx` — **detección transversal de juegos y su presentación en la barra.** `deteccion.ts` contiene la heurística pura y su prueba; `evidencia.ts` añade `.desktop` y `/proc`; `iconos.ts` resuelve nombre/icono; `registro.ts` comparte el estado dirigido por eventos. Los consumidores deben usar `esClienteJuego()`/el registro, no `esJuego()` sin evidencia.
  - **`fullscreen` es un MODO, no un booleano** (Astal `Fullscreen`: 0 nada, **1 MAXIMIZADO**, 2 pantalla completa). El `fullscreen !== 0` original hacía que *cualquier ventana maximizada* no incluida en la lista negra pasara por juego — así es como Discord acababa en la pastilla, silenciaba las notificaciones (auto-DND) y ponía `{gaming:true}` en disco. Todo lo que mire `fullscreen` compara contra `FULLSCREEN_REAL` (2).
  - Orden de decisión de `isGame` (lo negativo primero): **menús de X11** (`esVentanaEmergenteX11` de `servicios/ventanas/`) → lanzadores (Steam/Lutris/Heroic… — la ventana es el lanzador, **no** el juego, aunque su `.desktop` diga `Categories=Game`) → apps que nunca son juego (Discord, navegadores, media, terminales) → **instaladores de wine/proton** → señales de clase (`steam_app_`, `gamescope`, `wine`/`proton`, `*.exe`) → ruta del proceso (`/proc/<pid>/exe`, `…/steamapps/common/…`) → **`Categories` del `.desktop`: con `Game` es juego; sin `Game` NO lo es** (este negativo fuerte es lo que ancla a Discord) → y solo si el escritorio no conoce la app, fullscreen real. Las listas casan **por nombre, no por subcadena**: con `includes()`, `"st"` (el terminal) casaba dentro de `"counter-strike"`. **El primer negativo va antes que las señales fuertes porque estas no salvan de él**: el desplegable de un juego trae *su misma clase* (`steam_app_…`), así que `senalClase` decía "juego" y la pastilla salía duplicada — medido con un A/B en esta máquina (juego X11 falso + un menú override-redirect con la misma `WM_CLASS`: dos mandos antes, uno después) — y además el auto-DND se disparaba por una ventana que no existe.
  - El filtro de **instaladores** va antes que las señales fuertes porque estas no lo salvan: caso real (el instalador de Voicemod, que ni siquiera es un juego), Steam le da a su ventana la clase `steam_proton` — la misma que a un juego — y su binario cuelga de `…/compatibilitytools.d/proton-…/wine-preloader`, así que la señal de clase *y* la de proceso dicen "juego". Solo el título (`Instalar`/`Install`/`Setup`/…) y el `.tmp` del instalador en el `cmdline` lo delatan. Limitación conocida: una app **no-juego ya instalada** que corra por Proton (el propio Voicemod) sí se detecta como juego — el compositor le da la misma clase que a un juego y no queda ninguna señal que los distinga.
  - **Preview de workspace**: cada instancia observa el `activeWorkspace` de su monitor y ejecuta `grim -o <salida>` hacia `/tmp/ags-ws-preview-<salida>-<id>.jpg`, para una miniatura de **280×158** reescalada al cargar. Publica primero a un temporal y solo lo renombra si el workspace sigue activo, evitando capturas etiquetadas con el ID anterior tras un cambio rápido. Con **JPEG q75** son ~330 KB frente a los 11 MB del antiguo PNG completo. No se usa `-s`: escalar con grim encarece la ruta frecuente unas seis veces.
  - **No filtres la captura por la visibilidad de la barra**: `grim` fotografía la pantalla actual y el único instante en que existe el contenido de un escritorio es mientras está activo. Saltarse esa captura no la aplaza, la pierde. El capturador sigue trabajando con la barra retraída, pero siempre queda limitado a su salida mediante `grim -o`.
  - **Cuándo se refresca `Escritorios.tsx`**: `servicios/escritorios/controlador.ts` comparte una sola colección de señales (`workspaces`, `clients`, `client-moved`, cliente enfocado, monitores y `active-workspace` de cada salida). Cada vista filtra después por el ID de su monitor. `client-moved` no sobra: `notify::clients` avisa de altas/bajas, no de traslados silenciosos.
  - **Un escritorio ESPECIAL se pinta como `0`, y su pastilla NO se abre por id.** La lista solo filtraba por monitor, así que con el scratchpad abierto salía una pastilla etiquetada **`-98`** — el id interno que Hyprland reparte (-98, -97… por orden de aparición: casar contra un -98 literal es el error fácil, de ahí `esEscritorioEspecial`, que mira el signo). Además el botón estaba **muerto**: `hl.dsp.focus({workspace=-98})` sobre un especial oculto no hace nada y responde **`ok`** igualmente (medido en vivo), así que no había ni error que ver. Los especiales se muestran y se ocultan con **`toggle_special`, que va por NOMBRE**, y por eso `EscritorioVisible` lleva ahora `nombre` y `enfocarEscritorio(id, nombre?)` bifurca. El nombre se valida contra `^[A-Za-z0-9._+-]+$` **en origen** (`nombreEspecialEscritorio`) porque acaba dentro de unas comillas simples en un `hyprctl dispatch`; sin nombre utilizable no se despacha nada, en vez de fingir con el focus por id. `alternarPantallaCompleta` pasa por la misma función: con el salto inicial mudo, el resto de su cadena caía sobre la ventana equivocada. **Reordenar, intercambiar y renumerar ignoran los especiales** (las tres entradas: arrastrar, CTRL+arrastrar y teclear un número), porque esas operaciones mueven ventanas entre escritorios numerados y un especial no es una posición del orden sino un cajón — arrastrarlo habría vaciado el scratchpad dentro de un escritorio normal. Lo puro vive en **`servicios/escritorios/especiales.ts`** (con test) y no bajo `barra/` por lo mismo que `servicios/ventanas/emergentesX11.ts`: lo consumen dos capas.
  - **Iconos**: `barra/escritorios/iconos.ts` consume directamente `servicios/aplicaciones/{glifos,iconos,entradasEscritorio}.ts` y `servicios/juegos/{evidencia,iconos}.ts`. Prioriza glifo configurado, recurso original, tema y fallback; no se deben reintroducir shims bajo `barra`.
  - **Un MENÚ de una app X11 llega como un cliente más, con la clase de su padre — y ahí nacía el icono duplicado de Steam.** Las ventanas **override-redirect** (menús, desplegables, tooltips) de un programa sobre XWayland no las gestiona el compositor, pero **sí salen en `hyprctl clients` y sí emiten `openwindow`**, así que Astal las mete en su lista. Steam las abre desde `steamwebhelper` con `WM_CLASS = (steamwebhelper, steam)` → llegan como `class: "steam"` y la barra pintaba **un segundo icono de Steam** mientras el menú estuviera abierto: de ahí que apareciera y desapareciera "según por dónde muevas el ratón". Es literalmente el viejo bug de Firefox (sus menús de X11 hacían lo mismo), que entonces se tapó deduplicando iconos por su glifo; ese apaño se retiró al pasar a **un icono por ventana** —cada uno es un botón que enfoca *esa* ventana, así que deduplicar volvería a ser incorrecto— y con él volvió el síntoma. **Ningún filtro de "ventana viva" sirve**: reproducido creando a mano una ventana override-redirect con esa `WM_CLASS`, Hyprland la da con `mapped: true`, `hidden: false`, `visible: true`, `acceptsInput: true` y tamaño real (A/B con `grim` sobre la barra: dos Steam antes, uno después). La delata la terna de **`servicios/ventanas/emergentesX11.ts`** (puro y con test): `xwayland` (los emergentes nativos de Wayland son `xdg_popup` y no llegan a ser clientes) **+** `floating` (una ventana no gestionada nunca entra en el mosaico) **+** sin `title` **ni** `initialTitle` (un menú no pone `WM_NAME`; se exigen los dos para no tragarse una ventana real que aún no ha puesto el suyo — cuando el título llega, los dos consumidores lo reevalúan). El filtro va en el bucle de `Escritorios.tsx`, **no** en `iconos.ts`, porque también decide `tieneClientes`, o sea si el escritorio se muestra. Vive en `servicios/` y no bajo `barra/` porque **la detección de juegos tiene el mismo agujero**: ver `servicios/juegos/`.
  - **`<For>` INDEXA POR IDENTIDAD DE OBJETO si no le das `id`, y eso reconstruía la barra entera con solo mover el ratón.** `actualizar()` corre ante cualquier señal del controlador —incluida `notify::focused-client`, que con `input:follow_mouse = 1` salta **cada vez que el puntero cruza de una ventana a otra**, no solo al alternar con el teclado— y devuelve siempre objetos nuevos. Sin clave, cada uno de esos eventos destruía y reconstruía **todos** los `BotonEscritorio` de todas las barras, con sus gestos, arrastres, controladores de teclado/foco y ranuras de icono. Medido con un A/B en esta máquina (3 escritorios, 10 cambios de foco): **30 construcciones antes, 0 después**. Con `barAutoHide` en `false` —el caso de este equipo— se pagaba siempre, porque `escritoriosRenderizados` solo se publica con la barra visible. (Al comprobarlo, **la clave en disco se llama `barAutoHide`, no `barAutoHideEnabled`** — ese segundo es el nombre del `createState` en `modulos/ajustes/estado/preferencias.ts`, y por defecto nace en `true`. Preguntar por el nombre equivocado devuelve `null`, que es **indistinguible de "clave ausente"** y lleva a concluir justo lo contrario de la verdad; ya pasó una vez.) Dos piezas, y hacen falta las dos:
    1. **Los dos `createState` llevan `equals: sonEscritoriosEquivalentes`** (`escritorios/modelo.ts`, puro y con test): igualdad por **contenido**, no por identidad de array, así que publicar una lista equivalente conserva el array anterior y no notifica a nadie. La firma incluye orden, id, nombre y —por cliente— dirección, icono y descripción; `enfocar` queda fuera a propósito (clausura nueva en cada pasada, pero solo depende del id y del nombre, que sí están — el nombre entró con los especiales, que se abren por nombre y no por id). El foco vive aparte, en `idEnfocado`/`direccionEnfocada`.
    2. **`id={(escritorio) => escritorio.id}` en el `<For>`**, para que abrir una ventana actualice el botón afectado en vez de rehacer los nueve (verificado: aparecer un escritorio nuevo construye **1** botón, no N).
    **Consecuencia para quien toque `BotonEscritorio`**: se construye UNA vez por escritorio y su prop `escritorio` ya no vuelve a llegar. De ahí solo puede leerse lo que no cambia en toda su vida (`id` —la clave— y `enfocar`); **los clientes entran por el accessor `clientes`**, no por `escritorio.clientes`. El `const clientes = idEnfocado(() => escritorio.clientes)` que había era justo el síntoma: un valor constante que solo re-emitía porque el componente se rehacía entero. Por lo mismo `indiceClienteActivo` depende de **las dos** fuentes (la lista puede reordenarse sin que cambie el foco).
  - **El mismo error estaba en `juegos/IndicadorJuegos.tsx`**, y ahí lo dispara el **título**: el registro republica la lista entera en cada `notify::title` de un juego, así que sin `id` un cambio de título de UNO reconstruía el botón de TODOS (medido). Va indexado por `direccion`, y como el botón ya no se rehace, nombre e icono llegan por accessor — incluida la **forma** del icono, que pasó de un ternario (`iconoGio ? … : nombreIcono ? … : glifo`) a tres ranuras alternadas con `visible`, el mismo patrón que `botonIcono`. Con el ternario, la forma quedaba atada al primer valor: un juego que arranca sin icono de tema y lo resuelve después se quedaba con el glifo genérico para siempre.
- `modulos/ajustes-rapidos/QuickSettings.tsx` — large control panel (Wi-Fi, Bluetooth, audio, display). Al importarse instala el **switch-on-connect de audio**: al conectar un dispositivo, pasa a ser la salida/entrada por defecto. **`speaker-added` NO significa "alguien ha enchufado algo"**, y creerlo costó dos bugs distintos; los dos dejaban el sonido en el **HDMI de la GPU**, que en esta máquina no tiene nada conectado (es una salida interna), y como el default así fijado **se persiste** (`default.configured.audio.sink` en `~/.local/state/wireplumber/default-nodes`), el estropicio sobrevivía al reinicio y pisaba lo que WirePlumber ya había restaurado bien:
  1. **Ráfaga de enumeración.** AstalWp emite `speaker-added`/`microphone-added` también por cada endpoint que **ya existía** al arrancar el shell (medido: HDMI y analógico, ~8 ms entre medias) → se lanzaba un `set-default` por cada sink, en `execAsync` concurrentes donde ganaba el último en *terminar*: moneda al aire en cada arranque de Hyprland. Remedio: **gate de asentamiento** (`AUDIO_SETTLE_MS` de silencio antes de conmutar nada), anclado **a que WirePlumber haya publicado algún endpoint**, no al arranque de AGS — en el boot los dos se levantan a la vez y el shell puede ganar la carrera, así que una gracia contada desde AGS expiraría justo antes de que llegue la ráfaga.
  2. **Recreación de nodos.** La señal se emite otra vez cada vez que un nodo se recrea, y el nodo HDMI/DP se destruye y se recrea al reconfigurar los monitores (**`hyprctl reload`**, DPMS, apagar la pantalla) — llega indistinguible de unos cascos recién puestos, y el id cambia (visto: 86 → 71 → 86). Remedio: **una salida de pantalla nunca es destino** (`isDisplayOutput`). El gate de (1) no cubre esto (la recreación llega mucho después de arrancar) ni al revés: hacen falta los dos.

  **Auditoría del `<For>` sin `id` en este panel** (mismo fallo que en la barra; ver la sección de escritorios): las listas cuyos elementos son **GObjects** —`endpoints` (`AstalWp.Endpoint`), los tres bloques de Bluetooth (`AstalBluetooth.Device`) y los puntos de acceso wifi— son **correctas tal cual**: filtrar y ordenar conserva la referencia, y sus filas ya son reactivas vía `createBinding`. Las de **strings** (barras de señal) se indexan por valor. Las dos que sí fabrican objetos nuevos son las que salen de un sondeo: las **pastillas de pantalla** (`hyprctl monitors -j` cada 2 s) ya van con `id={m.name}` y leen `focused` del state; y la **mezcla de aplicaciones** (`pactl -f json` cada 2 s) se ha dejado **a propósito** sin clave — ahí la reconstrucción de la fila es lo que **re-siembra `currentVol`** desde el valor real del sistema, así que ponerle `id` dejaría el slider sordo a los cambios de volumen hechos fuera del panel. Su exposición ya está acotada: la firma `streamsSignature` evita publicar si nada cambió, el poller solo corre con ese submenú abierto y `spkLastInteraction` congela 2,5 s tras tocar el slider.

  El tipo se decide por el **nombre de nodo** (`wpctl inspect <id>` → `node.name`, `…hdmi-stereo` vs `…analog-stereo`): `Endpoint.name` viene a **null** y el `icon` es el mismo (`audio-card-analog-pci`) en ambos, y la `description` sí se traduce, así que buscar "(HDMI)" ahí dependería del locale. El jack de auriculares **no** pasa por aquí: enchufarlo no crea un sink, cambia la *ruta* del mismo nodo analógico (por eso `bar/Volume.tsx` escucha `notify::route`). Un `set-default` por ráfaga (debounce) y por id de endpoint — no parseando `pactl` con awk.

  **Bluetooth — el "apagado" del usuario lo borraba el propio BlueZ, y el tile mentía.** Dos bugs
  distintos con la misma raíz: *nadie puede distinguir "lo encendió el usuario" de "lo encendió
  BlueZ" si no se le da tiempo al adaptador*.
  1. **`AutoEnable` (activado por defecto en `/etc/bluetooth/main.conf`) enciende el controlador él
     solo en cuanto lo encuentra — y lo hace DESPUÉS de registrar el adaptador.** Queda una ventana
     en la que el adaptador ya existe y sigue apagado, indistinguible de "el usuario lo dejó
     apagado". `resolverRestauracionBluetooth` (`bluetooth/estadoInicio.ts`) daba la restauración
     por terminada ahí mismo, solo porque el estado coincidía con el objetivo; el power-on de BlueZ
     llegaba justo después, nadie lo corregía, y `guardarEstadoSistema` lo **adoptaba como decisión
     del usuario** reescribiendo `bluetooth: true` en `system_state.json`. Resultado medido con un
     A/B: con la lógica vieja, arrancar con el BT apagado y guardado como apagado terminaba con
     `Powered: yes` **y el `false` del disco pisado a `true`** — o sea que el apagado no sobrevivía
     ni a ese arranque, y menos al siguiente. Hoy "coincide con el objetivo" **no basta** para
     cerrar: hace falta el parámetro `asentado`, que se arma con `BT_SETTLE_MS` (5 s) contados
     **desde que el adaptador aparece**, no desde que arranca AGS — es un dongle USB (RTL8761 aquí)
     y puede tardar en enumerarse, así que una gracia contada desde el shell expiraría antes de que
     BlueZ llegue a verlo (mismo razonamiento que el gate de audio de arriba). Mientras no está
     asentado no se actúa, pero la restauración **sigue viva** y corrige el encendido automático.
     **Una acción explícita del usuario cierra la restauración en el acto**
     (`finalizarRestauracionBluetooth()` desde `toggleBluetoothPower`): sin eso, encender el BT
     dentro de esos 5 s haría que la restauración se lo volviera a apagar en la cara. Un encendido
     externo *pasada* la ventana sí se adopta y se guarda, como siempre.
  2. **El tile tenía dos fuentes de verdad para el mismo hecho.** El CSS salía de
     `createComputed(() => btSupported() && btPowered())` sobre un `createBinding(bt, "isPowered")`,
     y el texto de un `createState` que escribía `syncBtInfo`. Los dos cuelgan de
     `notify::is-powered`, pero son **handlers distintos** y GObject los invoca en orden de
     conexión: `syncBtInfo` se conecta al construir el componente y el del binding al renderizar,
     o sea después — el CSS iba un handler por detrás y los dos se contradecían (medido:
     `CSS=ACTIVE` con `TEXTO="Desactivado"`). Ahora `getBluetoothTileInfo` devuelve también
     **`active`**, y el icono, el texto y el CSS salen del **mismo objeto y del mismo setter**:
     contradecirse es imposible por construcción (hay test). De paso se fue `btDevices`, que era
     código muerto. Y se escucha **`notify::is-connected`**: conectar unos cascos **ya emparejados**
     no cambia la lista, así que `notify::devices` no salta y el tile se quedaba en "Desconectado"
     con los cascos puestos.
- `servicios/pantalla/` — cola de pantallas compartida por QuickSettings y Ajustes > Pantalla. `modes.ts` es la lógica pura (testeada con node); `service.ts` tiene el poller, `applyPatch` (aplica en vivo con `hyprctl eval 'hl.monitor{…}'` — bajo config Lua `hyprctl keyword` ya no existe) y la persistencia. **Persiste en UN solo fichero, `~/.config/gigios/display.json`, que lee también el config del compositor** (`hypr/gigios/pantalla.lua`: recorre `monitors` y emite un `hl.monitor{output="desc:…"}` por entrada, después del comodín de `gigios/monitores.lua`). Hace falta porque sin nadie que aplique las prefs al cargar, un **`hyprctl reload`** releía el comodín — `preferred`/escala 1 — y tiraba la pantalla de 240 Hz a 60 y de escala 1.25 a 1, sin que AGS pudiera enterarse (no hay señal de recarga; el poller solo observa). **Antes esto se resolvía volcando además un `monitor-settings.lua` generado**, o sea el mismo dato escrito dos veces, un fichero machine-specific dentro del árbol de git y la `description` del EDID interpolada en un chunk Lua (una comilla suelta rompía la config entera). Consecuencia de que el JSON ya no sea solo nuestro: `saveMonitorPref` llama a **`saveDisplayConfigNow()`**, escritura síncrona, y no al debounce de 2 s que usa el resto — con la espera de por medio, un `hyprctl reload` justo después de tocar la resolución releería el fichero viejo y desharía el cambio. Detalle en el `CLAUDE.md` raíz.
  - **Franjas horarias (`schedule.ts`, puro y testeado) — dos canales independientes, no uno.** Las reglas
    de `global.nightRules` (Ajustes > Pantalla > "Programar por franjas horarias") son **franjas**
    `{ start, end, temp, brightness }` que programan **luz nocturna Y brillo**, cada uno con `null` =
    "esta franja no toca ese canal" (`activeSetpoint` resuelve canal a canal). Ese `null` es la pieza clave:
    sin él, una franja de solo brillo tendría que traer `temp` y apagaría la luz nocturna, que es lo
    contrario de "por separado". Solapes: gana la franja que **empezó más tarde** (y a igualdad, la última
    de la lista), así una franja corta puede meterse dentro de otra larga y devolverle el mando al salir.
  - **Una regla vale SOLO dentro de su franja — y esto es una corrección, no un detalle.** El modelo
    original eran *puntos de cambio* encadenados (`{time, temp}`: cada regla regía "hasta que otra
    cambiara ese canal", envolviendo a ayer). Consecuencia real y reportada: con una sola regla
    "22:00 → encender", a las **19:00** la luz se encendía — a esa hora la última regla que había pasado
    era la de las 22:00 *del día anterior*, así que estaba vigente. Exigía una regla-terminador ("07:00 →
    apagar") que nadie deduce solo. Hoy `isWithinWindow(now, start, end)` (fin exclusivo, cruza medianoche)
    manda: fuera de la franja la regla no existe, la luz nocturna vuelve al interruptor manual y el brillo,
    al valor previo. `normalizeRules` **migra** el formato viejo (encadena cada `time` hasta el siguiente y
    tira los terminadores), así que `22:00 on + 07:00 off` se convierte en la franja `22:00 → 07:00`.
  - **El brillo se aplica AL ENTRAR en la franja y se RESTAURA al salir.** Las dos mitades son necesarias:
    (1) el tick de 60 s de `applyRules()` re-aplica la temperatura (estado que hyprsunset debe sostener)
    pero **no** el brillo — reescribirlo cada minuto dejaría sin efecto el slider y las teclas
    `XF86MonBrightness*` dentro de la franja; `lastBrightnessKey` (`franja|valor`) distingue "he entrado en
    otra franja" de "sigo en la misma", e incluye el valor para que editar la franja vigente se vea al
    momento. (2) al salir se devuelve `brightnessBeforeWindow` (el brillo de justo antes de entrar, guardado
    solo en la transición de entrada), porque el brillo es un ajuste **físico que no vuelve solo**: sin eso,
    una franja de 10 a 11 se seguiría notando a la 1 de la tarde. La luz nocturna no necesita restauración
    —basta con dejar de forzarla— y por eso su canal no tiene estado "Apagar".
    Al arrancar dentro de una franja sí se aplica su brillo, pero **esperando a que haya backend**: en un
    sobremesa el sondeo DDC tarda ~1 s, así que `applyScheduledBrightness()` no marca la franja como
    aplicada mientras `brightnessSupported` sea falso, y `initDisplayService` reintenta al confirmarse (si
    no, el primer intento se perdería en el vacío). En la UI las filas de brillo se ocultan con
    `brightnessSupported`, como el slider.
  - **(3) Las dos mitades se PERSISTEN (`brightnessWindow` en `display.json`), porque la transición cruza
    apagados.** `lastBrightnessKey`/`brightnessBeforeWindow` eran solo-RAM, y el brillo es lo único aquí que
    deja **residuo físico**: la franja lo graba en la firmware del monitor por DDC y ahí se queda. Una franja
    nocturna (el caso real: `00:00→07:00`, brillo 80) **se sale casi siempre con el PC apagado** —estás
    durmiendo—, así que la restauración del punto (2) no llegaba a ejecutarse **nunca**: el 80 se quedaba
    grabado en el monitor y, al arrancar, `detectDdc()` lo leía de vuelta y lo publicaba como si fuera la
    elección del usuario; `brightness.subscribe(saveDisplayConfig)` lo escribía en `display.json` y el brillo
    real quedaba **borrado**. Reproducido con un A/B: brillo 73 → la franja aplica 80 → apagar dentro →
    arrancar fuera = monitor a 80 y `"brightness":0.8` en disco, cada vez ("el brillo vuelve obligatoriamente
    a 80"). Es el mismo patrón que el bug de Bluetooth de arriba: **estado que debe sobrevivir al proceso
    viviendo en RAM, y un valor impuesto por el sistema adoptado como si lo hubiera elegido el usuario.**
    Con el apunte en disco la restauración pendiente **se cobra en el siguiente arranque**, y de paso se cae
    la limitación conocida (reiniciar AGS *dentro* de una franja ya no pierde el brillo previo ni re-aplica
    la franja encima de un ajuste manual: la `key` ya coincide). Ojo al tocar la rama de salida: va **detrás
    de `brightnessSupported`**, porque sin backend la restauración se perdería en el vacío *y* borraría el
    apunte, que es lo único que recuerda el brillo real.
  - **La luz nocturna NO comparte este fallo, y no es casualidad**: no deja residuo. Es un proceso
    (`hyprsunset`) que al apagar el PC simplemente deja de existir, así que "restaurar" es no arrancarlo —
    por eso su canal no tiene estado "Apagar" ni necesita apunte. La franja tampoco pisa `nightLightTemp`
    (son canales separados en `baseTemp()`). Si algún día se persiste algo suyo, el candidato sería
    `nightDismissed`, que hoy es por sesión a propósito.
  - **La UI enseña qué franja rige ahora** (`sp-rule-active-chip` + tarjeta `.active` + la línea
    `Ahora (HH:MM) · luz nocturna: … · brillo: …`), movida por un reloj de 30 s ref-contado que solo vive
    mientras la sección está montada. No es adorno: "¿por qué se ha encendido?" no se respondía en ningún
    sitio, y fue justo así como se destapó lo de las 19:00.
  - **La fila de una franja NO puede reconstruirse al editarla — editarla mataba TODO AGS.** `patch`
    reemplaza el objeto de la regla (el estado es inmutable) y `<For>` indexa por **identidad de objeto**:
    objeto nuevo = clave nueva = tira la fila y construye otra. O sea que cada edición destruía **el editor
    que estabas usando**. Y como `commit` cuelga del `leave` del campo (así es como se edita de verdad:
    tecleas la hora y pasas al minuto), eso destruía el `Gtk.Entry` con el foco **desde dentro de su propio
    handler de foco**, con GTK a mitad del cambio: el método de entrada de Wayland se quedaba apuntando al
    widget ya liberado y el siguiente evento reventaba en `wl_proxy_get_version` → **SIGSEGV, se cae el
    shell entero**. Reproducido y arreglado montando la sección real con los binarios stubbeados. Es una
    **carrera** con el evento de text-input del compositor, así que no es determinista y por eso parecía
    caprichoso — el modo de fallo era "se cierra solo al tocar las franjas". Medido sobre el código viejo:
    salir del campo petaba 2 de cada 3 veces, y pulsar Enter 1 de cada 3 (menos, pero petaba: no hay ruta
    "segura", el fallo es destruir la fila al editarla). Hoy `<For>` lleva
    `id={ruleKey}`, una identidad **de sesión en un `Symbol`**: el spread de `patch` lo copia (la fila
    sobrevive a la edición) pero `JSON.stringify` lo ignora, así que no ensucia `display.json` ni obliga a
    tocar la lógica pura de `schedule.ts`. Consecuencia obligatoria: si la fila ya no se reconstruye, **no
    puede leer sus valores del `rule` capturado** — ese se queda en el pasado en la primera edición. Todo lo
    que se enseña cuelga de `cur` (`nightRules()[index()]`), `activeChannels` compara identidad contra el
    objeto **vivo**, y `NumberField` es reactivo: sin eso, poner 4000 K → "No cambiar" → "Encender a" deja la
    regla en 3500 con el campo enseñando 4000 (A/B). De paso se arregló que editar te tirara el foco del
    campo en cada cambio. **Los derivados de la fila van por `createMemo`, no por `cur((r) => …)`**, y no es
    optimización: `createComputed` no compara valores y `cur` produce un objeto nuevo en cada edición, así
    que tocar la hora reemitía `nightMode` con el mismo `"on"` → se reconstruían las opciones del
    desplegable (su `<For>` también va por identidad) → volvía a haber destrucción de widgets en cada
    tecleo, y con ella el segfault (medido: ~1 de cada 4 ediciones con Enter; 0/8 con memo).
- `modulos/notificaciones/` — notification daemon integration. `store.ts` is the public facade; `estado/` holds shared state and persistence; `NotificationPopup` (transient) and `NotificationPanel` (history) are separate windows. `settings/SettingsWindow.tsx` is the in-shell settings UI. Sub-packages: `panel/` (panel composition and notification items), `popup/` (popup presentation, stack, layout and burst control), `procesamiento/` (single ingestion path), `daemon/` (D-Bus ownership checks), `rules/` (pure rule engine — match, dedup, template, validate, tested by Node), `history/` (persistence logic, tested), `cleanup/` (rule-driven background cleanup engine, tested), `autoDnd/` (auto "No molestar": a single in-shell watcher — `watcher.ts`, started once via `initAutoDnd()` in `app.ts` — that flips `notifd.dontDisturb` while a game runs or a user-configured app is fullscreen; `detect.ts` is the pure predicate, tested — el watcher le **inyecta** `isGameClient` por el parámetro `isGameFn` de `shouldSilence`, para que el detector con evidencia no rompa la pureza del módulo; y "fullscreen" aquí significa el modo 2, no maximizado). **Skin dunst para las notificaciones del sistema — lo aplica una REGLA, no el hint.** Los `notify-send` de `hypr/scripts/` llevan `-h string:x-gigios-source:system`; `procesamiento/ingesta.ts` lo lee (con `hints.lookup_value()` de esa clave suelta — **no** con `extractHints()`, que hace `recursiveUnpack()` de todo el `a{sv}` y con un `image-data` materializaría los píxeles en crudo por cada notificación) y lo mete **en `NotifInput.source`, antes de evaluar**, además de guardarlo en `StoredNotification.source`. El motor sabe casar por él (`match.source`, `MatchSpec`), y la builtin **`builtin.system-dunst`** (`defaults.ts`: `source equals "system"` → `style: "dunst"`, prioridad 10, **sin `stopOnMatch`** para no tapar a `builtin.low-battery` y compañía, que también casan con notificaciones de scripts) es la que pide el skin. El efecto es `style: "default" | "dunst"` (`PopupStyle`), plegado en `engine.ts` con el mismo `setOnce` que `color` y horneado en `meta.style`; en el editor es el segmento "Estilo del popup" (— / shell / dunst), donde `—` = "la regla no opina", que **no** es lo mismo que `shell`. `ElementoPopup` (`popup/ElementoPopup.tsx`) hace `meta.style === "dunst"` y punto: **no mira el hint como fallback, a propósito** — si lo hiciera, desactivar la builtin desde la UI no quitaría el skin y el interruptor sería mentira (hay test). Por eso `"default"` tampoco puede colapsarse a `undefined` en el fold: es lo que permite a una regla de usuario **sacar** del skin a algo del sistema (y `"dunst"`, metérselo a una app normal). El skin reproduce el `/etc/dunst/dunstrc` **por defecto**: esquinas rectas, marco 3 px, monoespaciada, fondo sólido por urgencia (`#285577` / `#900000`+marco `#ff0000` / `#222222`) y **sin nombre de app ni icono** (el `format` de dunst es `"<b>%s</b>\n%b"`). El `css` inline del popup normal (borde izquierdo, tinte del icono) **se anula** ahí: inline gana al stylesheet y rompería el marco. Solo afecta al **popup**.

**En la vista AGRUPADA, cualquier notificación reconstruía TODOS los grupos — y con ellos el plegado.** `agruparNotificaciones()` (`panel/ListaAgrupada.tsx`) fabrica objetos `{appName, notificaciones}` **nuevos** en cada emisión del almacén, así que con el `<For>` sin `id` (indexa por identidad de objeto) una notificación de Discord tiraba y rehacía también el grupo de Firefox con todas sus filas. Lo caro era lo de menos: `plegado` es un `createState` **local del grupo**, de modo que cualquier notificación reabría los grupos que hubieras plegado. Va indexado por `appName`, y `GrupoAplicacion` recibe sus notificaciones como **`Accessor`**, no como array fijo — junto con el contador, la insignia de no leídas (ranura fija con `visible`, antes un `noLeidas > 0 && …`) y la lista interna. Medido con el panel abierto: **3 notificaciones = 18 construcciones de grupo antes, 0 después**; y verificado que la insignia sube y la fila nueva aparece sin reconstruir nada.

**Lo que NO se ha tocado del mismo patrón, y no es un olvido**: en `ListaPlana` (y en el `<For>` interno de un grupo) el cambio de identidad **es el mecanismo de refresco** — `markRead()` sustituye el objeto de esa notificación en el almacén, y eso es justo lo que hace que su fila se vuelva a pintar como leída; ponerle `id` la congelaría. Las pestañas de ajustes (`RulesTab`, `HistoryTab`, `AppsTab`, `AppFilterBar`) reciben strings o objetos que solo cambian al editarlos. Los popups no usan `<For>`: la pila los añade y quita a mano.

**Acciones D-Bus en el popup (`notify-send -A`) — el clic derecho las ejecuta.** `ElementoPopup` no las pintaba: en `NotificationPopup.tsx` la palabra `action` solo aparecía en un `actions: []`. O sea que **todo `-A` era invisible e impulsable**, y llevaba años así — el botón "🛡️ Lanzar aislado" de las alertas de ejecutable nuevo (`oom-monitor.sh`) nunca se pudo pulsar. Y no había escapatoria por el historial: lo que sale de `hypr/scripts/` casa con `builtin.system-dunst`, y `shouldIndex()` no indexa lo que ya gestiona una regla (ver el peaje, abajo) → la acción estaba muerta en los dos sitios a la vez. Hoy: el popup **se engancha al gesto que ya existía**, el `Gtk.GestureClick` de `button: 3`, que hacía `focusAppWindow()` — inútil para un script, cuyo "app" no es una ventana, así que ese gesto estaba libre justo donde hacía falta. Ahora, **si hay acción la invoca; si no, sigue enfocando la ventana** (no se pisan: son excluyentes en la práctica). Tres detalles que no son adorno: (1) se **invoca antes de `dismiss()`** — `dismiss` cierra la notificación en el daemon y luego `get_notification(id)` ya no la encuentra; (2) hay una **pista visible** (`▸ clic derecho · <label>`, clase `.notif-popup-action-hint`, con override en el skin dunst porque su fondo sólido se come el violeta del tema): un botón que funciona pero que nadie sabe que existe es el mismo bug otra vez, y por eso se aparta a sabiendas del `format` por defecto del dunstrc; (3) **el popup ES la acción** — `_removeImmediate` no cierra la notificación en el daemon, pero se lleva el widget, y sin historial no queda dónde pulsar, así que los 5,5 s fijos de `POPUP_TIMEOUT_MS` no daban ni para leer «¿reparo el pendrive?». `popupLifetime()` respeta el `-t` de quien la mandó **solo si trae acciones**, con suelo (`POPUP_TIMEOUT_ACTION_MS`, 20 s) y techo (`…MAX_MS`, 60 s: en el spec `-t 0` es "no expira nunca", y un popup clavado para siempre no es opción). Las notificaciones sin acción conservan sus 5,5 s intactos. Requiere `expireTimeout` en `StoredNotification` (lo rellena `procesamiento/ingesta.ts` desde `n.expire_timeout`).

**El pestañeo al apilar popups lo causaba HYPRLAND, no un re-render de GTK.** Síntoma: al llegar un aviso nuevo, los que ya estaban en pantalla parecían desaparecer y volver a dibujarse. La pila es imperativa a propósito (`popup/pila.ts`: mapas por id, `drenarCola()` solo hace `append` y no toca los widgets vivos), así que el sospechoso obvio —reconstruir la lista— estaba descartado desde el principio. La causa real es que los N popups son **una sola superficie layer-shell**, que crece al apilar (medido: 51 px → 110 px), y Hyprland **anima ese cambio de tamaño**: mientras dura, el buffer nuevo se escala dentro de una caja que todavía está creciendo, así que los avisos ya visibles se encogen y vuelven. Medido con `grim` sobre el rectángulo del popup de arriba mientras llega el siguiente: con la animación de capas activa la media del recorte se mueve ~150 ms; con `animation = layers, 0` es constante bit a bit. Se arregla con un `hl.layer_rule{ no_anim = true }` en `hypr/gigios/reglas.lua` — **no** tocando este código.

**Eso obligó a darle `namespace` a la ventana**, y es la parte reutilizable: una `<window>` de AGS sin `namespace` explícito se anuncia al compositor como **`gtk4-layer-shell`**, el genérico, y ahí no hay `layerrule` que valga (la casarían todas a la vez, incluida la barra). `name` **no** vale para esto: es el identificador de `app.get_window()`, no el del protocolo. `Orion`, `QuickSettings`, `NotificationPanel` y `OSD` ya lo ponían — sus reglas de blur dependen de ello —; `NotificationPopup` no, y por eso era inalcanzable. Se comprueba con `hyprctl layers`: si sale `ns=gtk4-layer-shell`, la ventana no tiene namespace propio y ninguna regla suya funcionará **en silencio**.

**Peaje conocido y aceptado**: al ser una regla, todo lo que sale de `hypr/scripts/` **queda fuera del historial** — `shouldIndex()` solo indexa lo que no casa con ninguna regla (la pestaña es "Tipos sin regla"). Se eligió así para tener la regla visible y desactivable desde la UI. La alternativa, si algún día molesta, es refinar `shouldIndex` para que una regla **puramente cosmética** (solo `style`/`color`) no cuente como "gestionada".

`procesamiento/ingesta.ts` is the single ingestion point that runs rules on every incoming notification — lo llama **solo** el handler de `notifd.connect("notified")` en `NotificationPopup.tsx`, así que si AGS no es el servidor de notificaciones de la sesión, **nada** se almacena: ni historial ni lista activa. Es el fallo que hay que descartar *primero* cuando `notif-history.json` sale vacío, porque desde dentro del código parece que falta una pieza: el sospechoso es un `dunst`/`mako` instalado que **D-Bus autoactiva** y le roba `org.freedesktop.Notifications` a `AstalNotifd` antes de que el shell arranque (`busctl --user list | grep org.freedesktop.Notifications` debe dar el PID de `gjs`). Se arregla enmascarando el otro daemon, no tocando este código — ver `docs/SETUP.md` §2. **`daemon/comprobacion.ts` lo detecta solo** (`initNotifDaemonCheck()` en `app.ts`, tras `NotificationPopup`, que es quien construye el `AstalNotifd`): compara el dueño del nombre contra el nombre único de nuestra conexión, y si no somos nosotros publica `notifDaemonConflict` `{pid, comm}` → `daemon/BannerConflicto.tsx` reemplaza el "Historial vacío" (`HistoryTab`) y el "Sin notificaciones" (`NotificationPanel`) por el culpable + el comando de arreglo, más un `notify-send` crítico **que pinta el propio intruso** (es el único canal que el usuario mira: el `CRITICAL` que Astal ya emite —`cannot get proxy: dunst is already running`— sale por el stdout de `ags`, que bajo el autostart no llega ni a `hyprland.log` ni al journal). Va suscrito a `NameOwnerChanged`, así que el aviso **se apaga solo** cuando el rival suelta el nombre: `AstalNotifd` queda *en cola* por él y lo toma sin reiniciar AGS (comprobado). **Persistence stays on JSON deliberately** (SQLite was evaluated and rejected: both stores are capped — 200 active / `HISTORY_CAP` 500 — the UI needs them fully in memory anyway, parse+stringify measures ~0.3 ms, and GJS has no SQLite binding, so the only cheap route would be forking the `sqlite3` CLI per write, which costs *more* than the file write). Both stores debounce 1.5 s and then go through `estado/persistencia.ts` → `saveJsonAsync()`, which writes off the main loop with `replace_contents_bytes_async` (**not** `replace_contents_async` — that one doesn't retain the buffer, so GJS's GC can free it mid-write). The 200 cap is applied **in memory in `procesamiento/ingesta.ts`**, not just when serializing: capping only at save time bounded the file but let the in-memory array grow all session; evicted entries get `disposeConditions()`d like the dedup path does.
- `modulos/orion/` — **the "Jarvis" launcher** (the user calls it "jarvis"; the code dir is `orion`). Bottom-slide panel with tabs, search, and sections. Toggle: `SUPER+ALT+Space`. `state.ts` holds its `SectionId` union and reactive state; `components/sections/` holds each section; `search/` is the fuzzy-search engine; `ProfileManager.ts` persists sessions.
  **Todo lanzamiento de app pasa por `data/launch.ts` (`launchApp`), no por `sh -c` a pelo.** Los
  cuatro sitios que abren apps (Apps, Inicio, buscador y el panel derecho, que reciben el `launch`
  como closure) hacían cada uno su propio `execAsync(["sh","-c",exec])`, y por eso las apps abiertas
  desde Orion aparecían en el escritorio donde estuvieras al terminar de cargar y no en el que las
  lanzaste — al revés que rofi, que sí ancla desde hace tiempo. `launchApp` delega en
  `hypr/scripts/lanzar-anclado.py`, que lanza con `hyprctl dispatch exec [workspace N silent] …`
  —la ventana **nace** en su escritorio, no se mueve después— y además observa el socket de eventos
  de Hyprland con el motor compartido `hypr/scripts/anclaje.py` (el mismo de `rofi-launch.py`:
  identidad por la primera ventana nueva, 15 s de observación, rama `urgent` para single-instance).
  La regla cubre **solo la primera ventana** (medido), así que el observador sigue siendo la red de
  los splash y los multiventana. Detalle en el `CLAUDE.md` raíz.
  **El panel derecho (`components/shell/RightPanel.tsx`) puede DESINSTALAR la app**, además de
  abrirla, editar su config y fijarla. Lo que decide y ejecuta es
  `hypr/scripts/desinstalar-app.sh` (pacman/AUR, Flatpak, Steam o borrado de ficheros, con `pkexec`
  para el diálogo gráfico de contraseña); aquí solo hay E/S (`data/uninstall.ts`) y la lectura del
  desenlace (`data/uninstall.parse.ts`, **puro y con test**). Detalle del script en el `CLAUDE.md` raíz.
  - **Es de UN CLIC: no hay pantalla de confirmación.** Hubo una (método, paquete y lista completa de
    lo que `-Rs` se llevaría) y se quitó a petición del usuario; se acepta porque la confirmación
    real es el **diálogo de contraseña de polkit**, que no se puede saltar. Si vuelve a hacer falta,
    el verbo `detectar` del script sigue devolviendo todos esos datos — hoy nadie lo llama desde la UI.
  - **`desinstalar()` APARTA ORION ANTES DE LANZAR NADA, y no es cortesía.** El diálogo de polkit es
    una ventana normal y Orion es una layer-shell **`OVERLAY`**, capa que va por encima de todas las
    ventanas normales por definición del protocolo (y con keymode `ON_DEMAND`, peleando además por el
    teclado): con Orion en pantalla el diálogo salía **debajo** y había que cerrarlo a mano para
    escribir. Cerrarlo antes **no basta** — la salida son ~280 ms de animación más un par de frames
    hasta que la superficie se desmapea —, así que `esperarOrionOculto()` (`data/uninstall.ts`)
    **sondea el estado real de la ventana** (`app.get_windows()`, nombre `orion` + `visible`) en vez
    de dormir una constante copiada de `Orion.tsx`, que se desincronizaría en silencio en cuanto
    alguien la retocara. Techo de ~1 s: si la animación se atasca se sigue adelante, porque lo peor
    que pasa entonces es el comportamiento de antes.
  - **Se aparta con `suspenderPanel()`, NO con `hidePanel()`, y al terminar vuelve donde estaba.**
    Cerrar de verdad es una salida: `finalizarCierrePanel` vacía búsqueda, resultados y panel
    derecho, y la sección regresa a Inicio salvo que el usuario tenga `orionRecordarUltimaSeccion`.
    Correcto cuando cierras tú, **incorrecto cuando Orion se aparta por obligación** — ahí nadie
    pidió salir de ningún sitio. `suspenderPanel()` guarda una foto (sección, origen, consulta,
    resultados, ficha del panel derecho), cierra **sin** `recordarSeccionAlCerrar()` —apuntar la
    sección aquí ensuciaría el "volver a la última" de la próxima apertura de verdad— y
    `finalizarCierrePanel` **corta al principio mientras haya foto**, que es lo que salta la
    limpieza. Tres reglas que no se deducen del código:
    1. **Si el usuario reabre Orion por su cuenta mientras tanto, la foto se descarta sin tocar
       nada**: lo que él acaba de hacer manda sobre lo que había.
    2. **La ficha del panel derecho solo se suelta con `soltarApp`** (tras un `ok`): reponer una app
       recién desinstalada dejaría una ficha fantasma con un «Abrir» que no abre nada. Y si había una
       búsqueda escrita, **se repite la consulta** en vez de reponer los resultados congelados — con
       el catálogo ya invalidado devuelve la lista sin ella, el mismo fantasma que evita
       `data/catalogo.ts` en la rejilla. Tras `cancelado`/`error` se repone todo tal cual.
    3. **`externo` llama a `descartarSuspension()`, no se limita a no reanudar.** Una foto olvidada
       deja `finalizarCierrePanel` cortocircuitado **para siempre** y Orion no volvería a limpiar su
       estado en ningún cierre posterior. `descartarSuspension()` la tira y aplica la limpieza que se
       había saltado, porque a esas alturas sí es un cierre normal.
  - **El fail-safe es al revés que el resto del shell**: `interpretarSalida` trata como `error` todo
    lo que no sea una palabra conocida (`ok`/`externo`/`cancelado`). Dar por buena una salida que no
    se entiende borraría el favorito de una app que quizá sigue instalada. **`externo` (Steam) no
    puede colapsarse a `ok`**: ahí no se ha desinstalado nada todavía —lo decide el usuario en la
    ventana de Steam y no vamos a enterarnos—, así que ni se toca el favorito ni se repone Orion,
    que taparía justo ese diálogo.
  - **El script es el único que notifica el resultado** (`pkexec` tarda lo que tarde el usuario en
    teclear, y para entonces Orion lleva rato cerrado). La excepción es "falta el script": ahí
    notifica AGS, porque si no el usuario se queda mirando un escritorio donde no ha pasado nada.
  - **`AppContextItem` lleva `desktopFile`** porque `pacman -Qoq` sobre el `.desktop` identifica el
    paquete mucho mejor que sobre el binario: un `Exec` con `sh -c`/`env` resuelve al intérprete. Lo
    rellenan los cuatro sitios que abren el panel; los favoritos lo resuelven con
    `Gio.DesktopAppInfo.new(id)` porque guardan el id, no la ruta.
  - **`data/catalogo.ts` existe porque había DOS cachés de `.desktop` que no caducaban**: `_appCache`
    en `AppsSection.tsx` y `_cache` en `search/handlers/apps.ts`. Se poblaron pensando en un catálogo
    que solo cambia entre sesiones, cosa que dejó de ser cierta al poder desinstalar: sin
    invalidarlas, la app recién borrada seguía en la rejilla y en la búsqueda hasta reiniciar el
    shell y, al pulsarla, no se abría nada **sin dar ningún error**. Es solo el punto de encuentro (y
    no importa GTK a propósito): así `RightPanel` avisa sin depender de la sección ni del buscador,
    que es lo que habría creado un ciclo de imports entre los tres. La sección **no fuerza su carga
    perezosa** al invalidar: repintar una sección que el usuario aún no ha abierto pagaría el parseo
    de los ~161 `.desktop` para nada. Un consumidor nuevo del catálogo debe registrarse aquí.
  - **«Desinstalar» va la última y separada por `.rp-action-sep`, sin rojo en reposo**: es la única
    acción del panel sin vuelta atrás y quedaba a un píxel de «Fijar en inicio», que es trivial y
    reversible. El rojo entra al apuntarla — teñirla siempre convertiría el panel en una alarma
    permanente y, a fuerza de verla, dejaría de significar nada.
  - Tras un `ok` se quita el favorito si lo había: `appResolver` no lo salvaría (buscaría una
    variante del binario y ya no hay ninguna) y quedaría un tile que no abre nada.

  **La sección Temas (`components/sections/RiceSection.tsx` + `sections/rice/`) gestiona franjas
  horarias y grupos de fondos.** Cuatro vistas en un `Gtk.Stack` (rejilla, franjas, grupo, fondo).
  Puntos que no se deducen del código:
  - **La rejilla lista ENTIDADES, no ficheros**: un grupo ocupa **una** tarjeta y sus imágenes no
    aparecen además sueltas, igual que en el sorteo — lo que ves es lo que puede tocarte.
  - **Lo que no sale a esta hora se ATENÚA, no se oculta.** Esconderlo dejaría media biblioteca
    invisible de noche sin nada que explicara la ausencia; atenuado se sigue pudiendo aplicar a mano,
    porque el filtro es para el **sorteo**, no una prohibición.
  - **El modo edición es un botón visible (lápiz), no un clic derecho**: un menú contextual salía
    gratis, pero es la lección del cronómetro que vivía en el clic derecho del reloj de la barra.
  - **Ninguna de estas vistas usa `<For>`, y no es un olvido**: son listas que se reconstruyen
    enteras al editarlas y `<For>` indexa por identidad de objeto. **Editar una hora o un nombre NO
    reconstruye la lista**: los campos confirman al perder el foco, y reconstruir ahí destruiría el
    `Gtk.Entry` enfocado desde su propio manejador de foco — el SIGSEGV documentado en
    `servicios/pantalla/`. Solo reconstruyen los botones.
  - **`data/wallpaperSchedule.ts` (puro, con test) NO decide qué fondo se aplica**: eso es
    `hypr/scripts/lib/seleccion_fondos.py`, y tiene que seguir siendo el único dueño porque la
    elección también la dispara el arranque de la sesión, en bash y antes de que AGS exista. Aquí se
    reimplementa solo la aritmética cíclica **para pintar** (qué franja rige, qué variante está
    vigente, qué se atenúa) — el peor fallo posible por esa duplicación es una etiqueta equivocada,
    nunca un fondo equivocado. Si tocas la regla de vigencia, tócala en los dos sitios; los casos
    límite están probados en ambos ficheros a propósito.
  - **`wallpapers.json` se escribe SÍNCRONO**, no con el guardado diferido del resto del shell: en
    cuanto se edita, la UI dispara `wallpaper.sh` para enseñar el resultado y ese script relee el
    JSON **desde otro proceso**. Es la misma razón que `saveMonitorPref` → `saveDisplayConfigNow()`.
  - **`loadThumbnails` PODA la caché de todo lo que no esté en la lista que le pasas.** La rejilla le
    pasa la lista completa a propósito; pedir un subconjunto (un chip del editor) sin `podar: false`
    borraría las 41 miniaturas restantes en silencio.
  - El reparto de escritura de `wallpaper.json` sigue igual (bash es dueño de `current`/`currentGroup`,
    AGS de `randomOnStart`), y ahora se **observa con un `Gio.FileMonitor`**: el planificador cambia
    el fondo por su cuenta al cruzar una franja, y sin eso la rejilla seguiría resaltando el anterior.

  Un `execAsync` nuevo con `sh -c` para abrir una app es el modo de fallo aquí: no da error, solo
  deja de anclar. El interruptor es `anclarVentanasRofi` y lo lee el script, no este lado — dos
  lecturas del mismo ajuste podrían discrepar. Si el script falta, `launchApp` cae al `sh -c` de
  siempre: degradar a "se abre sin anclar" es preferible a "no se abre".
- `modulos/calendario/` + `PanelCalendario.tsx` — **panel lateral con dos secciones, `Calendario | Reloj`.** Sustituyó por completo al panel viejo (`CalendarPanel`/`MonthView`/`AgendaView`/`EventDialog`/`store.ts`, borrados), que concentraba dominio, persistencia y widgets en un único `store.ts`. Reparto actual: `dominio/` (tipos, fechas, agenda, validación — **puro y probado con node**), `persistencia/` (esquema versionado, migración y el único fichero que toca GLib), `calendario/` y `reloj/` (widgets), `google/` (OAuth, cliente, mapeo, fusión), y `estado.ts` como la ÚNICA pieza que une dominio con UI.
  - **Las fechas son cadenas `YYYY-MM-DD` y toda la aritmética va por `Date.UTC`.** `new Date("2026-07-21")` parsea como UTC y en Madrid devuelve el día 20 a las 22:00 —así comparaba mal la agenda el store viejo—, y `new Date(y,m,d)` + sumar días salta una hora en los cambios de horario de verano, lo que a las 00:00 es saltarse un día. La excepción son las **alarmas** (`reloj/planificadorAlarmas.ts`), que sí usan fechas locales a propósito: una alarma es hora de pared y «las 7:00» tienen que ser las 7:00 también la noche que dura 23 horas.
  - **`fin` es INCLUSIVO** (`inicio == fin` = un día). Google usa fin **exclusivo** para los eventos de día completo, y la conversión vive solo en `google/mapeo.ts`. Sin ella todos los eventos de varios días se pintan un día de más y, al subirlos, encogen uno en cada ida y vuelta (hay test de ida y vuelta).
  - **Ni la rejilla, ni la agenda, ni las listas de alarmas usan `<For>`: se reconstruyen enteras.** Son widgets sin estado, y `<For>` indexa por identidad de objeto — el patrón que ya provocó destrucción de widgets en pleno evento de foco y el SIGSEGV de las franjas horarias (ver la sección de `servicios/pantalla/`). Por lo mismo, **los dos formularios (evento y alarma) NO son reactivos**: se construyen con una copia local del borrador y solo escriben en el estado al guardar. Si cada tecla actualizara `edicion`, el overlay que los monta los destruiría con el foco dentro.
  - **Los overlays se sincronizan también AL CONSTRUIR**, no solo en `subscribe`: `subscribe` avisa de los cambios, así que un panel montado con una edición ya abierta se quedaba sin editor y sin ninguna señal de por qué.
  - **La cuadrícula del mes tiene SIEMPRE 42 celdas** (6×7) y **no se estira al alto del panel**. Lo primero evita que el panel cambie de alto al pasar de mes (un mes ocupa 4, 5 o 6 semanas); lo segundo, que en una pantalla de 1440 px cada celda pase de 50 a 240 px y el día seleccionado se convierta en una columna gigante.
  - **Un solo temporizador para la próxima alarma, troceado a 15 min.** No hay bucle que repase la lista: al cambiar cualquier alarma se recalcula el próximo vencimiento y se rearma. El troceo existe porque `GLib.timeout_add` **no corre mientras el equipo está suspendido**, así que una espera de ocho horas armada de una tacada sonaría ocho horas de *actividad* después; cada salto recalcula contra el reloj de pared. Al cargar, las **puntuales vencidas se desactivan en silencio** —no se emite la alarma atrasada— y las semanales se recalculan solas: la «próxima activación» es derivada y **nunca se persiste**, porque sería una segunda fuente de verdad que se contradice al cambiar la hora del sistema.
  - **Temporizador y cronómetro miden por marcas de tiempo, no contando ticks.** El tick es solo presentación y **cuelga de la visibilidad**: con el panel cerrado o en la pestaña Calendario no queda ni un temporizador de repintado vivo, y al volver la cifra es exacta por muchos frames que se hayan saltado. Son estado de **sesión**; solo las alarmas se guardan.
  - **El reloj de la barra ya NO tiene cronómetro en el clic derecho.** Era una función invisible: nada la insinuaba, y pulsar donde uno espera un menú contextual sustituía la hora por un contador sin explicación. Vive en la pestaña Reloj, con botones y estado visible.
  - **Las alertas del reloj son notificaciones normales**, con hint `sound-name` y origen `x-gigios-source:alarm`. No hay popup ni reproductor propios: deciden el motor de reglas, el No molestar y `modulos/notificaciones/sonido/`. El origen es `alarm` y **no `system`** a propósito — `system` activaría la builtin del skin dunst, que es para los avisos de `hypr/scripts/`.
  - **Google: la fusión es aditiva por calendario y un fallo suyo NUNCA cuesta datos locales** (`google/fusion.ts`, puro y probado). Lo local no se toca jamás; una respuesta vacía no puede vaciar la lista; una **mutación local pendiente gana** a la versión remota (es posterior a lo que Google tiene) y se marca `conflicto` solo si el etag remoto cambió; un **borrado remoto no se aplica sobre una edición local pendiente**. Solo `owner`/`writer` conceden escritura, y las **instancias recurrentes se degradan a lectura** porque esta versión no sabe escribir recurrencias. No hay sondeo: se sincroniza al conectar, al abrir el panel, al pulsar actualizar y tras una mutación. El 410 (`syncToken` invalidado) reconstruye con una pasada completa **antes** de borrar nada.
  - **El consentimiento OAuth NO vive en el shell**: lo hace una vez `scripts/google-calendar-auth.sh` (PKCE, estado anti-CSRF, loopback en puerto que pide al kernel), igual que Spotify. `access_type=offline` + `prompt=consent` no son opcionales: sin ellos una segunda autorización devuelve código pero **no** refresh token, y el script terminaría «bien» dejando credenciales inservibles. Con el proyecto OAuth en modo *Testing*, Google caduca los refresh tokens a los **7 días**.
- `modulos/notificaciones/sonido/` — **la reproducción de sonido de las notificaciones**, que hasta ahora no existía (el motor calculaba `muteAudio` y nadie lo consumía). `decision.ts` es puro y probado; `reproductor.ts` ejecuta. **No hay sonido por defecto**: si nadie pide `sound-name`/`sound-file`, silencio — sin esa guarda, activar el audio habría vuelto sonora *toda* notificación del sistema. Orden de las guardas: `suppress-sound` (lo pone quien emite, que sabe si ya sonó por otro canal) → No molestar → reglas. Una **crítica tampoco se salta el No molestar**: quien lo activa pide silencio, y la notificación se sigue viendo. El comando es un **array de argumentos, nunca `sh -c`**: un `sound-file` llega por D-Bus desde cualquier proceso de la sesión. Falla en silencio a propósito — una notificación de error sobre una notificación que no suena es un bucle de ruido. Requiere `canberra-gtk-play` (paquete `libcanberra`), declarado en `install.sh` y `bin/preflight.sh`.
- `servicios/almacenamiento/json.ts` — **el único sitio con la escritura JSON atómica y asíncrona** (`replace_contents_bytes_async`, y por qué no `replace_contents_async`). Nació dentro de notificaciones; se movió aquí al necesitarlo el calendario, y `modulos/notificaciones/estado/persistencia.ts` quedó como fachada que reenvía conservando el prefijo `[notif]` de sus logs. Un tercer módulo que necesite escribir estado **debe usar este**, no copiar la función.
- `modulos/osd/` — `OSD.tsx` y `MicOSD.tsx`, los flotantes de volumen, brillo y micrófono.
  **El recorte de entrada debe quedar vacío síncronamente desde `realize` y durante el primer `map`.** La superficie
  OSD nace transitoriamente como `200×200` antes de que GTK asigne la tarjeta real (`232×40`);
  esperar al tick/idle de `clipWindowInputToContent()` deja durante ese primer frame la región
  rectangular predeterminada y reaparece el cuadrado de la sombra. Por eso este llamador usa
  `vaciarAlMapear: true`: después del layout el helper sustituye la región vacía por la suma de las
  siluetas redondeadas de las tarjetas visibles. Las tarjetas mantienen además
  `overflow={Gtk.Overflow.HIDDEN}` para que ningún hijo pinte fuera del mismo límite visual.
- `servicios/pantalla/brightness.ts` — **el brillo, con DOS backends: son dos hardwares distintos, no uno
  con dos rutas.** El estado (`brightness`), el OSD y las escrituras viven aquí; `state.tsx` solo los
  **reexporta** (es el hub, y así `OSD.tsx`/`app.ts` no cambian). `brightnessBackend()` decide una vez
  al arrancar:
  - **`backlight`** (portátil): la GPU maneja la retroiluminación del panel interno y el kernel la
    publica en `/sys/class/backlight` → `brightnessctl`. Barato, y **udev avisa** de los cambios los
    haga quien los haga. La ruta ya **no está hardcodeada** a `intel_backlight`: se enumera el
    directorio.
  - **`ddc`** (sobremesa): un monitor externo **no aparece en esa clase**. Su brillo vive en el
    firmware del monitor y se habla con él por **DDC/CI** — I2C sobre el propio cable de vídeo →
    `ddcutil setvcp 10`. Detección asíncrona al arrancar (`ddcutil detect --terse` → bus, luego
    `getvcp 10 --terse` para confirmar que el monitor **soporta** el VCP 10 y de paso leer su valor
    real, que pasa a ser el que enseña el slider). Requiere el módulo **`i2c-dev`** cargado (ver
    `system/modules-load.d/i2c-dev.conf`); el acceso a `/dev/i2c-*` ya lo da la regla udev del propio
    ddcutil (`TAG+="uaccess"`), **sin** tocar el grupo `i2c`.
  - **`none`**: ni una cosa ni la otra → los sliders (QuickSettings > Pantalla y Ajustes > Pantalla) se
    **ocultan** con `visible={brightnessSupported}` y el OSD no sale. Ojo: `brightnessSupported` es
    **estado reactivo, no una constante**, precisamente porque el sondeo DDC tarda ~1 s y termina
    *después* de construirse la UI.

  **El slider tiene DOS TRAMOS, porque el hardware tiene un SUELO.** `setvcp 10 0` es el mínimo
  que acepta la electrónica del panel, y en el OLED de esta máquina eso sigue siendo claramente
  luminoso: el slider llegaba a 0 y la pantalla no se oscurecía más. No era un recorte del código
  (`applyBrightness` ya dejaba llegar a 0), era el hardware. `atenuacion.ts` (**puro y probado**)
  parte el valor compuesto —lo que ve el usuario— en dos canales con `repartirBrillo()`: por encima
  de `DIM_FLOOR` (0.35) manda el hardware y el gamma queda intacto; por debajo, el hardware se
  queda en 0 y sigue oscureciendo el **gamma** hasta `GAMMA_MIN` (0.15). El reparto es **continuo**
  en el suelo (hay test), así que arrastrar el slider no da ningún salto. Medido en vivo: DDC
  80→65→49→34→18→3 con gamma 100, y al tocar el suelo gamma 88→64→39→15 con DDC clavado en 0.
  - **El gamma solo entra en el tramo bajo, no en todo el rango**: reducirlo recorta niveles
    útiles y puede dar banding. Arriba el hardware hace el trabajo sin ese peaje, así que el
    software solo entra donde el hardware ya no puede.
  - **`GAMMA_MIN` no es 0** a propósito: un gamma 0 deja la pantalla en negro absoluto,
    indistinguible de "se ha apagado el monitor" y sin nada visible con lo que volver a subirlo.
  - **Lo aplica `service.ts`, no este módulo.** `brightness.ts` solo publica `softwareDim` (0..1)
    y `service.ts` lo reconcilia: el gamma vive en la **CTM del KMS**, cuyo único dueño es
    `hyprsunset` — el mismo proceso que sostiene la luz nocturna. Dos escritores se pisarían, así
    que se reconcilian juntos en `applyNight()`, que ahora mantiene `hyprsunset` vivo si lo pide
    **cualquiera** de los dos canales (antes solo lo pedía la luz nocturna, así que atenuar con
    ella apagada no habría tenido dónde aplicarse) y arranca con `-t` y `-g` a la vez para no
    pintar un fogonazo. Cuando el proceso hace falta solo para el gamma se pide `TEMP_NEUTRA`
    (6000 K): sin eso, bajar el brillo encendería de paso la luz nocturna. `nightOn` sigue
    colgando **solo** de la temperatura. La suscripción lleva debounce de 120 ms — arrastrar por
    la zona baja emite un cambio por píxel y cada uno es un `hyprctl`.
  - **El tramo software SE RESTAURA DESDE DISCO al arrancar, y es obligatorio**: es el reverso
    exacto del residuo físico que documenta `applyScheduledBrightness`. Allí el hardware recuerda
    **de más** (graba el valor DDC en su firmware); aquí el software **no recuerda nada** —
    `hyprsunset` muere con la sesión—, así que al arrancar por debajo del suelo `detectDdc()` lee
    el mínimo del panel y publica el **suelo** (0.35): la atenuación se perdía y el slider saltaba
    hacia arriba en cada arranque. Medido: gamma 39 → reiniciar → gamma 100.
  - **La guarda de esa restauración pregunta si la franja es NUEVA, no si hay franja.** Una franja
    de brillo solo aplica **al entrar**; si al arrancar ya estábamos dentro de la misma (su clave
    coincide con `franjaAlArrancar`, congelada al cargar porque `lastBrightnessKey` muta al
    reconciliarse), no va a re-aplicar nada y lo que el usuario dejó a mano dentro de ella es el
    valor bueno. Ceder el mando sin esa distinción dejaba el brillo **sin restaurar nunca** con la
    franja 00:00-07:00 vigente — que es justo la franja en la que se usa el tramo oscuro.
  - **`componerBrillo()` es la inversa PARCIAL**: reconstruye el compuesto desde una lectura del
    hardware (`detectDdc`, watcher de udev), pero solo conoce su tramo — el gamma no se lee del
    panel. Por eso `adoptarLecturaHardware()` devuelve `null` ante un 0 con atenuación activa: ese
    0 lo pusimos nosotros, no es información nueva, y componerlo devolvería el slider al suelo en
    cada evento de udev.

  **Las escrituras DDC se coalescen, y no es opcional**: cuestan ~0,3 s (medido, con `--bus N
  --noverify`; sin esos flags, 0,66 s), o sea que un arrastre del slider genera muchísimas más
  peticiones de las que el bus I2C traga. Se mantiene **una escritura en vuelo como mucho** y al
  terminar se lanza el último valor pendiente: ~3 actualizaciones/s mientras arrastras y siempre el
  valor exacto al soltar. Todo `ddcutil` va bajo `timeout 10` — un bus mudo lo cuelga indefinidamente.

  **El modo de fallo original era silencioso y peor que "no hace nada":** `brightnessctl` sin
  dispositivos de clase `backlight` **no falla** — cae al primer dispositivo de clase `leds` y sale con
  0, así que cada arrastre del slider en el sobremesa encendía el **LED de scroll-lock del teclado**
  mientras el `.catch(() => {})` no veía error alguno y la UI seguía tan campante (el valor lo fijaba
  `setBrightness(v)` en local y el watcher de udev que lo habría desmentido consultaba una ruta
  inexistente). Por eso la llamada lleva `-c backlight` explícito y **nadie invoca `brightnessctl`
  fuera de este módulo**: las teclas `XF86MonBrightness*` de `hypr/gigios/keybinds.lua` ya no lo llaman, van
  por `ags request brightness-up|down` → `stepBrightness()`, que aplica al backend que toque y enseña
  el OSD. `inicializador/init.sh` **no restaura brillo en un sobremesa** (sale si `/sys/class/backlight`
  está vacío) y tampoco hace falta: el monitor guarda su brillo en su propia firmware.
- `modulos/ajustes/SettingsPanel.tsx` — ventana general de ajustes abierta desde el engranaje de Quick Settings (`settingsPanelVisible` en `estado/shell.tsx`). La navegación lateral es una lista continua de destinos concretos, sin encabezados de categoría ni buscador. `PersonalizationSection` y el antiguo `AppsSection` ya no existen: sus preferencias se reparten entre `modulos/ajustes/barra/SeccionBarraEscritorios.tsx`, `modulos/ajustes/personalizacion/SeccionFuncionesShell.tsx`, Energía, Juegos, Sistema y Notificaciones. La bandeja del sistema forma parte de Barra; la suspensión se edita desde Energía mediante `modulos/ajustes/pantalla/Inactividad.tsx`; `modulos/ajustes/juegos/SeccionJuegos.tsx` contiene las preferencias generales activadas al jugar; `modulos/ajustes/pantalla/SeccionPantalla.tsx` reúne en Pantallas la disposición, el color y brillo, la automatización y los ajustes gráficos de fluidez. `modulos/ajustes/seguridad/SeccionSeguridad.tsx` ofrece «Vigilancia del sistema» y «Antivirus»; esta última reúne el escáner automático de Descargas, el análisis manual y el lanzador aislado. No confundir esa sección con `modulos/menu-energia/`, que contiene la ventana independiente de apagado, reinicio y cierre de sesión.
  - **El coste con Ajustes cerrado es 0, y eso lo sostiene un `<With>` sobre `vistaActiva`** (`= settingsPanelVisible() ? section() : null`), **no sobre `section` a secas**. Con el gate solo por sección, `panel` se evalúa en el cuerpo de `SettingsPanel()` —que `app.ts` invoca con `.map()` **por monitor** al arrancar— y `<With>` renderiza con `immediate: true`, así que **la sección por defecto (Cuenta) se construía al arrancar el shell y seguía montada toda la sesión sin haber abierto Ajustes nunca**; cerrar el panel solo cambiaba `visible` de la ventana y no desmontaba nada. Hoy abrir construye, cerrar desmonta y corren los `onCleanup` de la sección viva. La nav lateral queda **fuera** del `<With>` a propósito: es estática, barata, y reconstruirla perdería el scroll. `section` sobrevive entre aperturas; lo que se tira es el árbol de widgets.
  - **Tiene que ser UN solo `<With>`; dos anidados (visibilidad → sección) NO funcionan**, y es lo primero que se intenta. `<With>` devuelve un `Fragment` y `Fragment.append` lanza `nesting Fragments are not yet supported`. **El error se traga dentro del efecto**, así que no explota nada: el panel se queda **sin contenido** y, además, el fragment externo nunca llega a tener hijos → su scope **no se dispone jamás** y no corre ni un `onCleanup`, o sea que pierdes justo lo que venías a arreglar y en silencio. Medido (dos `JS ERROR: nesting Fragments` en el log y `CONSTRUIDA` sin `LIMPIADA` en cada ciclo). Por lo mismo el caso cerrado devuelve **`<box />` y no `null`**: `<With>` no añade nada al fragment ante `null`/`undefined`/`false`/`""`, y el ciclo de disposición cuelga de **iterar los hijos del fragment** — sin hijo no hay `dispose`.
  - **La limpieza de una sección va SIEMPRE por `onCleanup`, nunca por `connect("destroy")`** — mismo bug que documenta `ReproduccionSpotify.tsx`, y que tenían `modulos/ajustes/barra/SeccionBarraEscritorios.tsx` y `modulos/ajustes/dispositivos/SeccionDispositivos.tsx`: en GTK4 `destroy` sale de `dispose`, y al desmontar con `<With>` el widget solo se **desparenta** (los cierres de JS lo siguen referenciando), así que el manejador no llegaba a correr y cada visita a Barra/Escritorios/Ratón/Touchpad/Teclado/Impresoras dejaba un suscriptor vivo para siempre. `<With>` sí hace `scope.dispose()`, que es lo que ejecuta los `onCleanup`.
  - **Lo que gatea por VISIBILIDAD y no por montaje**: en `modulos/ajustes/pantalla/SeccionPantalla.tsx` el poller (`hyprctl` cada 2 s) **y el reloj de 30 s** se adquieren/liberan juntos contra `settingsPanelVisible`. El reloj colgaba del montaje, así que dejar Ajustes en Pantalla y cerrar el panel lo dejaba tickeando el resto de la sesión, recomputando el resumen y actualizando etiquetas de una ventana oculta. Con el gate de visibilidad del primer punto esto es cinturón y tirantes, pero mantiene el invariante **local a la sección** en vez de depender de la estructura del panel.
- `servicios/energia/powerState.ts` — deriva un estado de ahorro desde la batería real mediante `AstalBattery`. La configuración vive en `~/.config/power-save/config.json`. Expone `powerSaveActive` y estados optativos que pausan trabajo de fondo. **`spotifyBarSuspended`** lo consume `Barra.tsx` para **desmontar** `ReproduccionSpotify` con `<With>`: ocultarlo no bastaría porque conservaría el temporizador y el reloj de frames. En un sobremesa no se activa: `AstalBattery` usa el `DisplayDevice` de UPower y no confunde la pila de un periférico con la del equipo. **`backgroundJobsSuspended`** lo publica `gamingState.ts` en `runtime-state.json` para que `lib/gaming-gate.sh` congele sondeos prescindibles.
- `servicios/fondos/planificador.ts` — **el reloj que hace que las franjas horarias de fondos sirvan
  de algo**: duerme hasta el próximo límite y entonces pide `wallpaper.sh --auto`. No decide nada (ni
  qué fondo toca ni cuándo es el próximo límite: las dos cosas se las pregunta a
  `wallpaper-select.py`), y va con el resto de `init*` de fondo del `setTimeout` de 4 s porque lee el
  reloj de pared y no siembra de eventos.
  - **Un solo temporizador, armado exacto y sin sondeo**: entre dos cambios de franja no hay ni un
    despertar. El tiempo que se duerme es el del próximo límite **relevante**, que depende del estado
    — con un grupo puesto solo cuentan **sus** tramos (sus variantes no miran las franjas globales),
    y con un fondo suelto solo las franjas globales. Sin límites relevantes no se arma nada.
  - **Se rearma con el fichero de ESTADO, no solo con el de config**: aplicar un grupo cambia por
    completo qué límites importan, así que `wallpaper.json` se vigila igual que `wallpapers.json`.
  - **⚠️ La suspensión se cubre con `PrepareForSleep` de logind, no troceando el temporizador.**
    `GLib.timeout_add` cuenta sobre el reloj monotónico, que no avanza dormido: una espera de ocho
    horas sonaría ocho horas de *actividad* después (suspendes de día, despiertas de noche). La
    primera versión troceaba a 15 min — 96 despertares diarios para no hacer nada casi ninguno — y la
    señal lo resuelve mejor y sin coste. Si algún día se quita, hay que devolver el troceo.
  - Fail-open hacia "las franjas no cambian el fondo". Detalle completo en el `CLAUDE.md` raíz.
- `servicios/energia/botonEncendido.ts` — **qué hace el botón de encendido físico** (Ajustes > Energía). El shell **solo persiste la elección** (`botonApagado` en `preferences.json`); quien la ejecuta es `GiGiOS.boton_apagado()` (`hypr/gigios/boton-apagado.lua`) desde el bind de `XF86PowerOff` con `{locked = true}`, releyéndola en cada pulsación — así el botón responde con AGS caído y con la sesión bloqueada, y el setter no tiene que relanzar ni recargar nada. La única acción que vuelve al shell es `menu`, por el `request` **`toggle-power-menu`** (`alternarMenuEnergia()`), añadido con ella.
  - **`teclaCedidaAHyprland` pregunta a logind por D-Bus, no mira si existe el fichero de `/etc`.** `systemd-logind` maneja esa tecla a nivel de asiento (`HandlePowerKey`, `poweroff` de fábrica) sin pasar por el compositor: si no está en `ignore`, el bind se ejecuta igual pero el apagado de logind lo tapa y el ajuste parece roto **sin dar ningún error**. `busctl get-property … HandlePowerKey` (sin privilegios) es la única respuesta que no puede mentir — el fichero puede estar en otro sitio o el valor cambiado a mano. El estado es `boolean | null` a propósito: `null` = no se pudo comprobar, y **no** saca el aviso; saber que está mal no es lo mismo que no saberlo. El aviso tampoco sale con la acción `apagar`, donde el resultado es el mismo venga de quien venga. La cesión la instala `install.sh` (paso 9) desde `system/logind.conf.d/`; detalle completo en el `CLAUDE.md` raíz.
- `servicios/energia/gamemode.ts` — **interruptor manual de Feral GameMode** (paquete `gamemode`), el botón de mando de la cabecera de Quick Settings, al lado de la campana (gris apagado, violeta encendido; glifo `GAME_GLYPH`, el mismo que la pastilla de juegos). **No lo confundas con `gamingState.ts`**: aquel detecta que hay un juego y congela el mantenimiento *del shell*; este le pide al **sistema** que se ponga a rendir (gobernador de CPU a `performance`, prioridades/ioprio, tweaks de GPU). Son complementarios y no se hablan.
  - **El encendido es un proceso hijo, y tiene que serlo.** GameMode no tiene "modo global": el demonio está activo mientras haya un cliente **registrado** y libera en cuanto ese cliente muere. `gamemoded -r` sin PID es exactamente eso (se registra y se pausa), así que **el hijo ES el registro** — vive = activo, `SIGTERM` = apagado, sin estado que sincronizar. Registrar el pid de AGS por D-Bus se descartó: GameMode **renicia a quien registra**, y renicear el shell es un efecto colateral gratuito.
  - **Que el hijo muera es el camino seguro**: si AGS se cae, el registro se va con él y el sistema vuelve solo. Lo que sí hay que limpiar es lo contrario — un hijo **huérfano** de un AGS muerto dejaría el gobernador clavado en `performance` **sin UI donde apagarlo** (mismo razonamiento que `initWakeUp()`), y de ahí `initGamemode()`, que va a **t=0** en `app.ts` y no en el `setTimeout` de los `init*` de fondo, por lo mismo. El hijo lleva **argv0 propio** (`exec -a gigios-gamemode`, el truco del coproceso de `screencast-monitor.sh`) para que ese `pkill -f` sea inequívoco y no pueda llevarse por delante un `gamemoded` ajeno.
  - Estado **solo en RAM y por sesión**: sin proceso no hay registro, así que persistirlo solo podría mentir. El apagado lo confirma el callback de salida del hijo, no el clic — y una muerte **inesperada** (el demonio rechaza, se lo cargan por fuera) apaga el icono *y* notifica con el stderr, porque el usuario había pedido lo contrario. Sin el paquete instalado el botón **no se pinta** (`gamemodeAvailable`, `GLib.find_program_in_path`), igual que los sliders de brillo sin backend. `gamemode` está declarado en `install.sh` y en `bin/preflight.sh`.
- `servicios/energia/gamingState.ts` — publica en disco la señal de juego activo para los scripts. Reutiliza el registro de `servicios/juegos/`, compartido con `IndicadorJuegos` y auto-DND, y escribe `~/.config/gigios/runtime-state.json` `{ "gaming": bool, "gameFocused": bool, "lastGameFocus": <epoch s>, "powerSaveFreeze": bool, "pid": <pid de AGS> }` al cambiar. **`powerSaveFreeze` viaja aquí y no en un fichero propio** porque dos escritores se pisarían. Lo leen `hypr/scripts/oom-monitor.sh` y `hypr/scripts/lib/gaming-gate.sh`. **`pid` es una guarda** contra estado huérfano; `gameFocused`/`lastGameFocus` distinguen juego abierto de juego atendido y mantienen cinco minutos de gracia tras perder foco.
- `modulos/barra/indicadores/sistema/Actualizaciones.tsx` — renderiza dos iconos independientes: núcleo (Tux naranja) y controladores de GPU (verde). Cada uno solo aparece cuando su categoría tiene pendientes; el resto figura como contexto dentro del popover. No sondea: `hypr/scripts/updates-monitor.sh` escribe `~/.config/gigios/updates.json` y un `Gio.FileMonitor` compartido alimenta ambos iconos. Cada popover retiene únicamente la barra de su monitor mediante `ControlVisibilidadBarra`. `Barra.tsx` lo condiciona con `updatesMonitorEnabled`.
- `modulos/barra/indicadores/sistema/CapturaPantalla.tsx` — icono rojo pulsante (glifo `󰑊`, clase CSS `recording`
  compartida con `Microfono`) **entre `Actualizaciones` y `BotonNotificaciones`** dentro de
  `.bar-status-pair`, visible solo mientras algo captura la pantalla. Va envuelto en su **propio
  `<box>`**: un `<With>` que se remonta en caliente (aquí lo hace el ajuste de Barra y escritorios) se
  inserta al **final** de su contenedor, no en su sitio — el icono acababa junto a Power. El box
  fija el hueco. Mismo remedio que ya lleva `Recursos` ahí al lado; si añades otro widget de barra
  conmutable, hazlo igual. Sin polling ni subprocesos:
  `hypr/scripts/screencast-monitor.sh` escribe `~/.config/gigios/screencast.json` y esto lo
  observa con un `Gio.FileMonitor` (patrón `Actualizaciones`). Tooltip: «Compartiendo pantalla ·
  Discord» / «Grabando pantalla · wf-recorder», una línea por tipo. **Sustituyó a `Recording.tsx`**,
  que hacía `pgrep -x wf-recorder` cada 2 s *por monitor* y no veía los screencasts por portal
  (Discord, OBS, navegador). Condicionado en `Barra.tsx` por `screencastIndicatorEnabled`, cuyo setter
  en `preferences.ts` es **maestro y en caliente**: lanza o mata el script.
- `modulos/ajustes/preferences.ts` — preferencias globales del shell que persisten en `~/.config/gigios/preferences.json`, a diferencia del estado solo en RAM de `modulos/barra/funciones/estado.ts`. Incluye los toggles `startupVolumeMuted` y `startupMicMuted`: `inicializador/init.sh` los lee al arrancar, espera a que WirePlumber publique cada endpoint predeterminado y fuerza su mute según el valor. Para añadir una preferencia: crea un `createState`, léela en `load()`, escríbela en `save()` y expón un setter que llame a `save()`.
  **`absorberSuperSinAtajo`** es de las que se aplican en caliente: su setter escribe la preferencia
  (`save()` es síncrono, así que el fichero ya está en disco) y dispara `hyprctl reload`. Lo demás lo
  hace el config: `hypr/gigios/nop-binds.lua` relee la clave y recalcula con un bucle los binds
  sordos que absorben SUPER + tecla sin atajo, para que no se escriba en la aplicación. Antes esto
  llamaba a un generador (`generar-nop-binds.sh`) que reescribía un fichero de 335 líneas y había
  que **regenerar** al añadir un atajo; con el config en Lua ya no hay nada que regenerar ni que
  pueda desincronizarse. Detalle completo en el `CLAUDE.md` raíz.
- `modulos/ajustes/seguridad/preferencias.ts` + `modulos/ajustes/seguridad/SeccionSeguridad.tsx` — dos destinos de sistema en `SettingsPanel.tsx`: «Vigilancia del sistema» y «Antivirus». Los eventos vigilados por `hypr/scripts/oom-monitor.sh` se persisten en `~/.config/gigios/security.json`; al añadir uno hay que declararlo en `SecurityKey`/`SECURITY_ITEMS` **y asignarlo a un grupo de `GRUPOS_VIGILANCIA`** si pertenece a Vigilancia. El monitor bash lee los toggles de eventos una sola vez al arrancar, por lo que se aplican en la próxima sesión. Las tres pausas del escáner de descargas y `dlMaxScanGB` se releen en cada barrido y se aplican en vivo; `dlPauseWhileGaming` es la única pausa activada por defecto. Antivirus reúne el escáner automático, el lanzador aislado y el análisis manual con ClamAV.
- `servicios/seguridad/clamav.ts` — la tarjeta **Base de firmas** de esa vista (la primera, porque sin firmas `clamscan` sale con código 2 y el barrido de descargas **no da nada por analizado**). Actualiza con `sudo -n /usr/local/bin/gigios-clamav-update update`, un helper root-owned que instala `install.sh`; el interruptor "Actualizar las firmas automáticamente" usa `auto-on`/`auto-off` sobre `clamav-freshclam.service` y **no persiste nada** (el estado es de systemd y se relee tras cada orden, también si falla). El botón de actualizar usa `update` y **no** `update-enable` a propósito: con el interruptor al lado, reencender el servicio desde ahí cambiaría un ajuste que el usuario no ha tocado — `update-enable` queda para el botón "Activar y actualizar" de las notificaciones. **leer** el estado no pasa por él ni por sudo (mtime de `/var/lib/clamav/daily.*` + `systemctl is-enabled`), porque preguntarle al sistema es lo único que no puede mentir. `clamavAutoUpdate` es `boolean | null` — `null` = no se pudo consultar y la línea no se pinta, mismo criterio que `teclaCedidaAHyprland`. Sin el helper la tarjeta **se sigue pintando** (el botón cede el sitio a la orden de instalación) — al revés que el selector TLP, porque aquí "falta el helper" es *te falta un paso*, no *esto no aplica a tu máquina*, y ocultarlo dejaba la función indescubrible. Solo desaparece sin ClamAV instalado. Detalle en el `CLAUDE.md` raíz.
- `modulos/ajustes/sistema/informacion.ts` + `modulos/ajustes/sistema/SeccionSistema.tsx` — Ajustes > Sistema («Información del sistema»). La sección **se pinta llena en el primer frame**; el spinner de «Detectando componentes…» ya no se ve nunca en la práctica. Tres piezas encajadas:
  - **La recolección está partida en dos, y esa partición es todo el invento.** `leerSincrono()` no lanza **ni un proceso**: OS, kernel, CPU (modelo, núcleos/hilos, frecuencia máx, caché, gobernador), RAM/swap, DMI (placa, BIOS, modelo) y UEFI/BIOS salen de `/proc`, `/sys` y el entorno en **~1,5 ms** (medido), así que caben dentro del propio render. `sondear()` es lo único que obliga a forkear (lspci, glxinfo, vulkaninfo, hyprctl, lsblk, nvidia-smi, recuento de paquetes) y va **en paralelo**: 323 ms, dominado por `vulkaninfo` (~250 ms).
  - **El sondeo se cachea en `~/.cache/gigios/sysinfo.json`**, y esa caché de disco es la **única**: al abrir se construye con el sondeo **anterior** y el nuevo se aplica por detrás. Hubo además un memo en RAM de módulo (`sondeoMemo`) que ahorraba el sondeo al reabrir la sección; **se quitó a propósito** — retenía ~8 KB toda la sesión para ahorrar 323 ms que ocurren de fondo y que nadie ve, mientras que lo que hace el pintado instantáneo es la caché de disco, cuya relectura son 8 KB ya en la caché de páginas. Si lo reintroduces, el coste que pagas es memoria retenida, no latencia percibida. La caché guarda la **salida cruda** de cada comando, no los grupos ya montados, para que el parseo siga teniendo un solo dueño. Es un `Record<string,string>` plano con `__version` a propósito: añadir o quitar un sondeo no invalida nada que no deba (clave ausente = `""` = fila que no sale), y `CACHE_VERSION` está para cuando sí haga falta tirarla.
  - **Monitores reutiliza ese mismo `hyprctl monitors -j`**: `sistema/monitores.ts` extrae fabricante/modelo, conector, modo activo, milímetros físicos, escala y formato de color sin lanzar otra consulta ni leer el EDID por separado. La diagonal se calcula desde los milímetros que Hyprland ya obtuvo del EDID y la profundidad por canal se deriva solo de formatos DRM conocidos; si falta una clave o aparece un formato nuevo, se omite esa fila o la profundidad, pero se conserva el resto de la ficha. El número de serie no se muestra.
  - **`lshw -class memory` se quitó porque costaba 857 ms para devolver cadena vacía** — era el grueso de la espera al abrir la sección, gastado en nada. Sin root no puede leer el DMI, así que en esta máquina el `sed` de `clock:` no casaba jamás. La velocidad de RAM se saca ahora solo de **EDAC** (`/sys/devices/system/edac/mc/*/dimm*/dimm_speed`, lecturas de sysfs, ~1 ms); donde EDAC no exista la fila simplemente no aparece, que es mejor que un segundo de espera por lo mismo. **No lo reintroduzcas** sin comprobar antes que devuelve algo *sin* privilegios.
  - Detalles que ya mordieron una vez: los marcadores del DMI (`System Product Name`, `Default string`, `To Be Filled By O.E.M.`…) se filtran **por campo y antes de unir** — concatenar `sys_vendor` + `product_name` primero daba `"ASUS System Product Name"`, que ya no casa con ningún marcador y se colaba entera. `lsblk` va con **`-P` (`KEY="value"`) y `-b`**: con columnas sueltas un disco sin `MODEL` o sin `TRAN` corría los valores una posición (el tamaño se leía como modelo), y el tamaño ya formateado sale según el locale (`447,1G`), en otra unidad que el resto de la sección. `zram`/`loop`/`sr`/`dm-` se excluyen: zram es RAM y ya figura como intercambio.
- `modulos/barra/multimedia/spotify/ReproduccionSpotify.tsx` — carátula + título + **onda**. **Clic izquierdo = "que suene aquí"**, no un play/pausa a secas: el widget también refleja lo que reproduces en el **móvil** y en ese caso el clic trae la reproducción a este PC. Dos piezas:
  - **Saber dónde suena el audio**: MPRIS **no** lo dice. Lo dice **PipeWire**: el nodo `Stream/Output/Audio` de Spotify solo está `running` mientras el cliente *rinde* audio (medido en esta máquina: `running` sonando, `idle` en pausa, inexistente si nunca sonó). `audioIsLocal()` hace `pw-dump` y lo comprueba; ante cualquier fallo devuelve `true` (= "suena aquí"), degradando al play/pausa de siempre en vez de a una transferencia sorpresa. Solo se consulta si MPRIS dice `Playing` (en pausa el clic es siempre play). Lleva un **segundo sondeo a 350 ms** en el camino dudoso: el nodo tarda un instante en pasar a `running` tras darle a play, y sin eso un play + pause rápido se confundiría con "suena en el móvil" y transferiría.
  - **Traer el audio**: `transferToThisDevice()` (`SpotifyService.ts`) = `GET /me/player/devices` → busca este equipo (por hostname, si no el primer `type == "Computer"`) → `PUT /me/player {device_ids, play:true}`. **Exige Premium**: en cuentas free todo `/me/player/*` responde **403**, por eso devuelve `denied`/`unavailable`/`no-device` en vez de un booleano. Ante `denied` cae al **plan B por MPRIS**: `open_uri("spotify:track:<id>")` sobre el cliente local, que al reproducir la pista se adueña del audio — pero **la reabre desde el principio** (no hay forma de conservar la posición por ahí) y su eficacia depende del cliente. Si todo falla, `notify-send`.
  - Los scopes de playback (`user-read-playback-state`, `user-modify-playback-state`) se añadieron a `scripts/spotify-auth.sh`. **Un refresh_token conserva para siempre los scopes con los que se emitió**: si el token es anterior a este cambio, hay que reejecutar el script o la API responderá 403 aunque la cuenta sea Premium.
  **Anuncios**: `servicios/multimedia/mpris.ts` mantiene una sola fuente MPRIS para la barra y Quick Settings, y `estadoPista.ts` comparte el contador por `trackid`. `OndaSpotify.tsx` conserva únicamente el estado visual de cada monitor: usa `add_tick_callback`, se limita a 60 fps (24 en ahorro) y se detiene cuando su barra local está oculta o la reproducción queda en reposo.
  **La onda es AUDIO REAL, con el algoritmo de siempre como repliegue** (`servicios/multimedia/espectro.ts`). Las 13 barras eran puramente procedimentales: tres senoides por banda más un "bombo" simulado a **112 BPM fijos**, o sea que no seguían la música — un tema lento y uno rápido se veían igual. Hoy la FFT la hace **`cava`** (C + fftw) en modo `raw`/`ascii`, una línea de 13 valores por frame por stdout; aquí solo se parsea. **La FFT no puede hacerse en TypeScript**: serían ~2,6 M multiplicaciones por segundo dentro del bucle principal de GTK. Medido: cava en régimen permanente cuesta **0,50 % de un core** y 14 MB de RSS (el ~11 % que sale de un `ps %cpu` corto es el arranque, los planes de fftw; no es el coste real).
  - **`channels = mono` en el config NO es opcional**, y su ausencia no degrada: rompe. El default de cava es `stereo`, que **exige un número PAR de barras**, y `BANDAS` es 13 — cava se niega a arrancar (`must have even number of bars with stereo output` por stderr) y además escupe basura **por stdout**, que es justo el flujo de datos. Sin esa clave no sale ni una línea parseable (medido). El config se escribe en `$XDG_RUNTIME_DIR/ags/cava.conf` desde una constante del módulo en vez de versionarse, para que no pueda divergir de `BANDAS`/`FPS`, que son el contrato con el widget.
  - **Un solo proceso para todos los monitores**: `OndaSpotify` se instancia por monitor, así que `adquirirEspectro()` va por **refcount** y devuelve su liberación. Sin eso, dos pantallas = dos procesos capturando el mismo audio.
  - **Es el monitor del SINK, no Spotify aislado — y NO se puede arreglar apuntando cava a Spotify.** Es lo primero que se intenta y falla **en silencio**: con `source = <nodo de spotify>` cava arranca sin un solo error por stderr y emite **todo ceros** para siempre (medido con Spotify sonando *y* un tono de prueba a la vez; el mismo config con `source = auto` captaba ambos). El motivo es que la entrada pipewire de cava solo sabe capturar de una **fuente** (o del monitor de un sink), y el stream de una aplicación es un `Stream/Output/Audio` — un nodo de salida, no una fuente. Aislarla de verdad exigiría un null-sink dedicado más `pw-link` rehecho en cada arranque de Spotify (su id de nodo cambia por sesión), desproporcionado para una onda de 54 px. Peaje aceptado: si suena un vídeo a la vez, entra en la onda. Como la onda solo se pinta mientras Spotify reproduce, en la práctica es su audio.
  - **El repliegue al algoritmo procedimental es obligatorio, y hay tres caminos que lo usan**: sin `cava` instalado (es **opcional** en `install.sh`/`bin/preflight.sh`, nunca un `fail`), con el proceso muerto, y —el caso que de verdad ocurre— con **Spotify Connect reproduciendo en el MÓVIL**, donde el sink local está mudo y cava emite ceros. Un fallo aquí debe degradar a "la onda no sigue la música", nunca a **una onda congelada**, que se lee como "el reproductor está roto".
  - **El cambio de fuente se CRUZA, no se conmuta** (`CRUCE`, 0,28 s): traer la reproducción del móvil a este PC, o entrar en modo ahorro, daría si no un salto visible en la altura de las 13 barras. Y la caducidad de la señal tiene su propio reloj de 500 ms contra `GRACIA_SENAL_MS` (1,5 s): con el audio parado cava sigue emitiendo líneas de ceros, y ninguna puede apagar la señal por sí sola sin convertir cada silencio entre estrofas en un salto de fuente.
  - **En modo AHORRO no se captura**: se cede al algoritmo procedimental, que no cuesta ni un proceso. Es un escalón **antes** que `spotifyBarSuspended` (que desmonta la pastilla entera): aquí la pastilla se sigue viendo, solo deja de analizar. Se suscribe a `powerSaveActive`, así que entra y sale en caliente.
  - **Con un JUEGO EN FOCO tampoco se captura, y lo que esa guarda cubre de verdad es el juego EN VENTANA.** Con `barAutoHide` en `false` —el caso de este equipo— la barra no se esconde nunca al apartar el ratón, así que `barraVisible` es cierto casi siempre y no sirve de gate. La excepción es la **pantalla completa real**, que sí pone `barTapada` en `Barra.tsx` y baja la barra: ahí la condición de visibilidad ya cortaba sola, y para ese caso `clienteJuegoEnFoco` (de `servicios/juegos/registro.ts`) es redundante. Lo que añade es el juego sin fullscreen real —ventana o borderless— y los instantes en que la barra reaparece a mitad de partida (se abre un panel). Se mira el **foco** y no la mera existencia del juego: la distinción "juego abierto ≠ estás jugando" que documenta `lib/gaming-gate.sh`, con el juego en otro escritorio la barra se ve y la onda vuelve a tener sentido.
  - **Verificado en vivo que oculto NO consume**, que es la pregunta que uno se hace al leer todo esto. Muestreo de 20 puntos con Spotify reproduciendo todo el rato: con la barra oculta (juego a pantalla completa, `y = -38, alpha = 0`) **cava parado y AGS entre 0 % y 0,66 %** de un core; con la barra visible y sin juego en foco, cava vivo y AGS entre 8,7 % y 13,3 %. O sea que al ocultarse se sueltan **las dos** cosas: el proceso de captura y el reloj de frames. Las transiciones son inmediatas y en ambos sentidos (juego → parado, alt-tab a Discord → vivo, vuelta al juego → parado).
  - Al valor de cava **no se le aplica `banda.ganancia`**: esa curva existe para dar forma a un espectro *inventado*, no para corregir uno medido — cava ya normaliza con su `autosens`. Lo que sí se conserva es el suavizado `ATAQUE`/`CAIDA`, que es lo que mantiene el mismo carácter visual con las dos fuentes.

  **Tope de 60 fps en modo normal (`WAVE_FPS_MAX`)**: el umbral era literalmente `0`, o sea "no te saltes ningún frame", así que en un panel de **240 Hz** esto se dibujaba 240 veces por segundo. Medido aquí: la animación entera cuesta ~2,7 puntos de un core y el tope se lleva ~0,6 — **no** los ~2 que sugeriría dividir los frames entre cuatro, porque GTK sigue **invocando** el callback a 240 Hz aunque salga temprano; lo que se ahorra es el dibujo, no la llamada. A 1 fps solo se llegaba a ~1,5. Está puesto porque es gratis y no se nota, no porque arregle nada gordo (AGS entero ronda el 7 % de UN core ≈ 0,6 % del CPU total; el ruido entre medidas es de ~1 punto).
  **Limpieza con `onCleanup`, nunca con `connect("destroy")`**: desmontar una rama reactiva en GTK4 puede limitarse a desparentarla. `ReproduccionSpotify`, su onda y Quick Settings cancelan explícitamente sus ticks, temporizadores, suscripciones y callbacks asíncronos.
- `servicios/spotify/` — `SpotifyService.ts` talks to the Spotify Web API; `parse.ts` is the pure parsing logic (tested). Credentials (client id/secret/refresh token) live in plaintext at `~/.config/gigios/spotify-creds.json` (chmod 600, outside the repo), set up once via `scripts/spotify-auth.sh` (interactive OAuth flow, not run automatically). This deliberately replaced an earlier Secret Service / KWallet setup that prompted for a wallet password on every boot under Hyprland.

## User-editable config

Runtime JSON lives **outside the repo** in `~/.config/gigios/` (`notifications.json`, `display.json`, `audioPresets.json`, `system_state.json`, `preferences.json`, `security.json`, `runtime-state.json`, `notif-*.json`, `calendario.json`, `reloj.json`, …)

El mapa versionado de glifos de aplicaciones vive en `config/app_icons.json`; se importa desde el propio módulo y no depende de la ubicación del checkout. No es estado runtime y `bin/link.sh` lo excluye de la migración a `~/.config/gigios/`. Orion guarda sus perfiles en `~/.local/share/orion/`.

`security.json` is written by `modulos/ajustes/seguridad/preferencias.ts` and read once at startup by `hypr/scripts/oom-monitor.sh` — see the "Seguridad" bullet above and `hypr/scripts/oom-monitor.sh` itself for the full list of scanned events and the sandboxed-launch flow.

`~/.config/gigios/spotify-creds.json` y `~/.config/gigios/google-calendar-creds.json` son **secretos** (client id/secret/refresh token en texto plano, chmod 600) en ese mismo directorio — fuera del repo, y no pueden commitearse ni copiarse dentro. El access token de Google es efímero y vive en `$XDG_RUNTIME_DIR/ags/google-calendar-token.json`, que es tmpfs y desaparece al cerrar sesión: un token de una hora no tiene por qué sobrevivir a un apagado, y así no hay que caducarlo a mano.

`calendario.json` (eventos + configuración) y `reloj.json` (alarmas) los escribe el panel de calendario. **Sustituyen a `~/.config/ags/calendar-events.json`, que caía dentro del repositorio** porque `~/.config/ags` es un symlink a `~/GiGiOS/ags`; `modulos/calendario/persistencia/repositorio.ts` lo migra una vez y borra el original.
