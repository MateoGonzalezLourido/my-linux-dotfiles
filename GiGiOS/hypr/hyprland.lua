-- Config de GiGiOS para Hyprland. ESTE es el config vivo: desde 0.55, si existe
-- `hyprland.lua` Hyprland lo carga y NO mira ningún `hyprland.conf` (la
-- comprobación es una sola vez, al arrancar). Los `.conf` de hyprlang ya no
-- existen en el repo — se borraron tras la migración; `git` los conserva si
-- hiciera falta consultarlos.
--
-- Los `.conf` que SIGUEN aquí (hypridle, hyprlock, hyprpaper) no son de este
-- programa: son binarios `hypr*` aparte, que mantienen hyprlang a propósito.
--
-- Estructura: cada bloque vive en gigios/*.lua y se carga con util.carga()
-- (require + pcall). Un módulo roto avisa en pantalla y NO tumba el resto —
-- importa porque un error de Lua sin capturar deja la sesión SIN ATAJOS (solo
-- el SUPER+Q de emergencia), y `--verify-config` solo detecta errores de
-- parseo, no de ejecución.
--
-- EL ORDEN DE CARGA ES SIGNIFICATIVO, no estético: monitor-settings pisa al
-- comodín de monitores, input-settings pisa a userprefs, y los binds sordos van
-- después de TODOS los binds reales (si no, no sabrían cuáles ya están usados).
--
-- `hyprctl keyword` no existe bajo Lua: los cambios en caliente llegan por
-- `hyprctl eval` (así los aplica AGS) o llamando a las funciones del global
-- GiGiOS que definen los módulos — GiGiOS.toggle_gaps(), GiGiOS.daltonismo(modo),
-- GiGiOS.compactar(), GiGiOS.boton_apagado() —, visibles desde `eval` porque
-- comparte el estado Lua del config (medido).

GiGiOS = {}  -- espacio de funciones invocables desde `hyprctl eval`

local util = require("gigios.util")

-- Render: la gestión de color del compositor SIGUE apagada — hyprsunset es el
-- único dueño del CTM del KMS (luz nocturna + atenuación); con las dos activas
-- la imagen se lava. Ver CLAUDE.md.
hl.config({ render = { cm_enabled = false } })

util.carga("gigios.env")            -- variables de entorno (Qt, toolkits, idioma)
util.carga("gigios.monitores")      -- regla comodín de monitores (el fallback)
util.carga_opcional("monitor-settings")  -- generado por AGS · Ajustes > Pantalla; pisa al comodín
util.carga("gigios.input")          -- teclado, ratón, touchpad y gestos
util.carga("gigios.ventanas")       -- aspecto: gaps, bordes, sombras, blur, layout
util.carga("gigios.animaciones")    -- curvas y animaciones
util.carga("gigios.reglas")         -- reglas de ventana y de capa
-- Funciones GiGiOS.* que los binds invocan con enlace tardío (closures): se
-- cargan antes de keybinds solo por claridad — el orden real no las ata.
util.carga("gigios.compactar")      -- GiGiOS.compactar()
util.carga("gigios.boton-apagado")  -- GiGiOS.boton_apagado()
util.carga("gigios.daltonismo")     -- GiGiOS.daltonismo(modo)
util.carga("gigios.keybinds")       -- los atajos reales (+ GiGiOS.toggle_gaps)
util.carga("gigios.autostart")      -- arranque escalonado (hl.on "hyprland.start")
util.carga("gigios.escaner-apps")   -- salto al escritorio de las apps de autostart
util.carga("gigios.permisos")       -- permisos del ecosistema (screencopy, plugins)
util.carga("gigios.gpu")            -- perfil por máquina (~/.config/gigios/gpu-perfil)
util.carga("gigios.gaming")         -- ajustes para juegos (tearing, VRR)
util.carga("gigios.userprefs")      -- preferencias personales (pisan a lo anterior)
util.carga_opcional("input-settings")    -- generado por AGS · Ajustes > Dispositivos; pisa a userprefs
util.carga("gigios.env-firefox")    -- variables de Firefox/Wayland

-- Binds sordos (absorber SUPER+tecla sin atajo): SIEMPRE al final, cuando ya
-- está registrado todo atajo real de los módulos anteriores.
util.carga("gigios.nop-binds")      -- absorbe SUPER+tecla sin atajo (bucle, no fichero)

-- Filtro de daltonismo: semántica del `exec =` original — se (re)aplica también
-- en cada `hyprctl reload`, restaurando el modo guardado en preferences.json.
if GiGiOS.daltonismo then GiGiOS.daltonismo() end
