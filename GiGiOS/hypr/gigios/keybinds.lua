-- Los atajos de teclado. Los nombres de app y las rutas salen de
-- gigios/variables.lua (lo que en hyprlang eran las $variables).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  TODO ATAJO DE ESTE MÓDULO PASA POR EL ENVOLTORIO bind(), NUNCA POR
--     hl.bind DIRECTO.
-- ═══════════════════════════════════════════════════════════════════════════
-- El envoltorio anota cada combinación en `usados` (normalizada), y esa tabla
-- es la que gigios/nop-binds.lua consulta para NO poner un bind sordo encima
-- de un atajo real. Un atajo nuevo registrado con hl.bind directo NO da ningún
-- error: simplemente nop-binds no se entera y la combinación queda con DOS
-- binds — el tuyo y un no_op sordo de más. Hyprland ejecuta ambos, así que es
-- inofensivo, pero deja los sordos sin reflejar la realidad. Usa el
-- envoltorio.
--
-- Mapeo de tipos de bind de hyprlang a opts de hl.bind:
--   bind   → sin opts          bindl  → { locked = true }
--   bindel → { repeating = true, locked = true }
--   bindm  → SIN OPTS. Ni { mouse = true } (la clave no existe en el parser de
--     opts de hl.bind — medido en 0.56: Keybind.mouse queda false con ella; el
--     ejemplo oficial de /usr/share/hypr/hyprland.lua la lleva de adorno sin
--     que nadie la lea) ni { drag = true }, que ROMPE el primer arrastre. Ver
--     el porqué junto a los binds del ratón, más abajo.

local util = require("gigios.util")
local vars = require("gigios.variables")

local mod = vars.mainMod

-- Forma canónica de una combinación: mods ordenados + tecla, todo en
-- mayúsculas — así "SUPER SHIFT + E", "SUPER + SHIFT + E" y "shift+super+e"
-- casan igual aunque cambien el orden, el separador o la caja. La comparte
-- nop-binds (se exporta abajo) para que ambos lados normalicen idéntico.
local function normalizar(keys)
  local partes = {}
  for token in keys:upper():gmatch("[^%s+]+") do
    partes[#partes + 1] = token
  end
  local tecla = table.remove(partes) -- el último token es la tecla; el resto, mods
  table.sort(partes)
  return table.concat(partes, " ") .. "+" .. (tecla or "")
end

local usados = {}

local function bind(keys, dsp, opts)
  usados[normalizar(keys)] = true
  return hl.bind(keys, dsp, opts)
end

--------------------------------------------------------------------- ventanas
bind(mod .. " + SHIFT + F", hl.dsp.window.fullscreen())
-- compactar workspaces (elimina huecos, te sigue al nuevo ID). Enlace TARDÍO a
-- propósito: GiGiOS.compactar la define gigios/compactar.lua y el orden de
-- carga no debe importar aquí — si ese módulo no cargó, el atajo calla (el
-- fallo de carga ya avisó por util.carga).
bind(mod .. " + SHIFT + N", function()
  if GiGiOS.compactar then GiGiOS.compactar() end
end)

------------------------------------------------------------------ herramientas
-- capturas de pantalla
bind("CTRL + F", hl.dsp.exec_cmd("mkdir -p " .. vars.ruta_captura_pantalla
  .. " && hyprshot -m output -m active -o " .. vars.ruta_captura_pantalla))
bind("CTRL + S", hl.dsp.exec_cmd("mkdir -p " .. vars.ruta_captura_pantalla
  .. " && hyprshot -m region -o " .. vars.ruta_captura_pantalla))

-- portapapeles
bind(mod .. " + V", hl.dsp.exec_cmd("~/.config/hypr/scripts/clipboard-history.sh picker"))
-- selector de emojis al estilo Windows; `period` es la tecla física "."
bind(mod .. " + period", hl.dsp.exec_cmd("~/.config/hypr/scripts/emoji-picker.sh"))
-- panel de notificaciones (toggle)
bind(mod .. " + N", hl.dsp.exec_cmd("ags request toggle-notifications"))
-- menú desplegable apps (con traer-instancia-única al workspace actual)
bind(mod .. " + SPACE", hl.dsp.exec_cmd("~/.config/hypr/scripts/rofi-launch.py"))
-- maximizar ventana (el `fullscreen, 1` de hyprlang)
bind(mod .. " + SHIFT + W", hl.dsp.window.fullscreen({ mode = "maximized" }))
-- pegar ventanas (modo compacto) — inline, ver GiGiOS.toggle_gaps abajo
bind(mod .. " + SHIFT + E", function() GiGiOS.toggle_gaps() end)

-- grabación con región (requiere slurp)
bind(mod .. " + SHIFT + P", hl.dsp.exec_cmd('wf-recorder -g "$(slurp)" -f '
  .. vars.ruta_grabacion_pantalla .. "/$(date +%Y%m%d_%H%M%S).mp4"))
-- monitor activo con audio del sistema (toggle: iniciar/detener)
bind("CTRL + SHIFT + F", hl.dsp.exec_cmd("~/.config/hypr/scripts/grabar-pantalla.sh"))
-- ventana seleccionada con audio del sistema (toggle: iniciar/detener)
bind("CTRL + SHIFT + S", hl.dsp.exec_cmd("~/.config/hypr/scripts/grabar-pantalla.sh ventana"))

-- otros
bind(mod .. " + Q", hl.dsp.exec_cmd(vars.terminal))
bind(mod .. " + SHIFT + C", hl.dsp.window.close()) -- killactive
-- Cierra una instantánea de las ventanas del workspace activo. Cada cierre se
-- dirige a su ventana original para que el cambio de foco entre cierres no
-- afecte al siguiente; un cliente que falle tampoco impide cerrar los demás.
bind(mod .. " + CTRL + SHIFT + C", function()
  local workspace = hl.get_active_workspace()
  if not workspace then return end

  local ok, ventanas = pcall(hl.get_workspace_windows, workspace)
  if not ok then return end

  for _, ventana in ipairs(ventanas) do
    pcall(function()
      hl.dispatch(hl.dsp.window.close({ window = ventana }))
    end)
  end
end)
bind(mod .. " + M", hl.dsp.exec_cmd("ags request toggle-quicksettings"))
bind(mod .. " + E", hl.dsp.exec_cmd(vars.fileManager))
bind(mod .. " + SHIFT + Q", hl.dsp.window.float({ action = "toggle" }))

-- mover ventanas con teclado / mover el foco
--
-- El SHIFT + flecha va con un `preselect` DELANTE, y no es adorno: sin él el
-- lado en el que aterriza la ventana no lo decide la tecla que has pulsado.
-- dwindle resuelve `movewindow <dir>` sacando la ventana del árbol y volviendo
-- a insertarla junto a un "punto focal" = 1 px más allá del borde de tu ventana
-- en esa dirección, a la mitad de ese borde (focalPointForDir). El lado y el eje
-- del corte salen entonces de en qué CUADRANTE del vecino cae ese punto — un
-- ángulo, no la dirección. Con dos ventanas coincide; con tres o más deja de
-- coincidir según las proporciones del vecino, y de ahí que "la misma acción
-- unas veces haga una cosa y otras otra". Medido: lab1 a la izquierda y lab2/lab3
-- partiendo la derecha, mover lab3 a la izquierda la dejaba EN MEDIO (a la
-- derecha de lab1, x=518), no a la izquierda.
--
-- `preselect` fija `m_overrideDirection`, que en dwindle tiene prioridad sobre
-- ese cálculo por cuadrante (y sobre smart_split y force_split): el eje sale de
-- la dirección — izq/dcha parten en vertical, arriba/abajo apilan — y la ventana
-- cae en el lado que has pedido. Con el mismo caso: x=8, a la izquierda del todo.
--
-- El `preselect none` de después limpia el override. Hyprland ya lo consume al
-- reinsertar, pero un `movewindow` que no mueve nada (ventana sola, o el borde
-- del monitor con binds:window_direction_monitor_fallback apagado) sale antes de
-- tocar el árbol y lo dejaría puesto: la SIGUIENTE ventana que abrieras nacería
-- en esa dirección sin que nadie la haya pedido.
for _, d in ipairs({ "left", "right", "up", "down" }) do
  bind(mod .. " + SHIFT + " .. d, function()
    hl.dispatch(hl.dsp.layout("preselect " .. d))
    hl.dispatch(hl.dsp.window.move({ direction = d }))
    hl.dispatch(hl.dsp.layout("preselect none"))
  end)
  bind(mod .. " + " .. d, hl.dsp.focus({ direction = d }))
end

-- cambiar de workspace (mod+[0-9]) y llevarse la ventana (mod+SHIFT+[0-9])
for i = 1, 10 do
  local tecla = tostring(i % 10) -- la tecla 0 es el workspace 10
  bind(mod .. " + " .. tecla, hl.dsp.focus({ workspace = i }))
  bind(mod .. " + SHIFT + " .. tecla, hl.dsp.window.move({ workspace = i }))
end

-- workspace especial (scratchpad)
bind(mod .. " + S", hl.dsp.workspace.toggle_special("magic"))
bind(mod .. " + SHIFT + S", hl.dsp.window.move({ workspace = "special:magic" }))

-- recorrer workspaces existentes con mod + rueda
bind(mod .. " + mouse_down", hl.dsp.focus({ workspace = "e+1" }))
bind(mod .. " + mouse_up", hl.dsp.focus({ workspace = "e-1" }))

-- mover/redimensionar con mod + botón izq/dcho arrastrando (los bindm)
--
-- ⚠️ SIN OPTS, y NO con { drag = true }: esa opción se comía el PRIMER arrastre
-- de cada sesión (el segundo y siguientes sí iban), tanto al mover como al
-- redimensionar. `drag` fuerza `release = true` (LuaBindingsToplevel.cpp), y en
-- handleKeybinds la pulsación de un bind con release solo llega al dispatcher
-- si es un SPECIALDISPATCHER — que para un handler `__lua` significa tener ya
-- puesto `releasePending`. Ese flag lo pone el propio dispatcher del ratón al
-- ejecutarse, así que en el primer clic aún es falso: la pulsación se traga sin
-- iniciar nada, y solo el soltar (que llega como "terminar arrastre", o sea
-- nada) deja el flag listo para la siguiente vez. El ciclo entero se retrasa un
-- clic. Sin opts la pulsación entra directa, arranca el arrastre y de paso pone
-- `releasePending`, que es lo que hace que el soltar también entre — el camino
-- que el compositor tiene pensado para los dispatchers de ratón en Lua.
--
-- El { mouse = true } del ejemplo oficial no vale como alternativa: hl.bind no
-- lee esa clave (ver la cabecera del módulo).
bind(mod .. " + mouse:272", hl.dsp.window.drag())
bind(mod .. " + mouse:273", hl.dsp.window.resize())

-------------------------------------------------------- teclas multimedia (bindel)
bind("XF86AudioRaiseVolume",
  hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+; ags request volume-osd"),
  { repeating = true, locked = true })
bind("XF86AudioLowerVolume",
  hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-; ags request volume-osd"),
  { repeating = true, locked = true })
bind("XF86AudioMute",
  hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle; ags request volume-osd"),
  { repeating = true, locked = true })
bind("XF86AudioMicMute",
  hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle; ags request mic-osd"),
  { repeating = true, locked = true })
-- El brillo lo aplica AGS (servicios/pantalla/brightness.ts), no brightnessctl
-- desde aquí: el hardware depende de la máquina — panel interno (sysfs) en el
-- portátil, DDC/CI sobre el cable de vídeo en el sobremesa — y solo el shell
-- sabe cuál hay. Llamar a `brightnessctl` a pelo era además activamente dañino
-- en un sobremesa: sin dispositivos de clase `backlight` no falla, cae al
-- primer dispositivo `leds` y enciende el LED de scroll-lock.
bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("ags request brightness-up"),
  { repeating = true, locked = true })
bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("ags request brightness-down"),
  { repeating = true, locked = true })
bind("XF86Calculator", hl.dsp.exec_cmd("qalculate-gtk"))

-- Botón de encendido físico. La acción la decide `botonApagado` de
-- preferences.json (Ajustes > Energía), leída EN CADA PULSACIÓN por
-- GiGiOS.boton_apagado (gigios/boton-apagado.lua — enlace tardío, este módulo
-- NO lo requiere: lo carga el entry point).
-- `locked = true` (el `bindl` de antes): tiene que funcionar también con la
-- sesión bloqueada, que es justo cuando más se pulsa.
-- Requiere HandlePowerKey=ignore en logind, o logind apagará el PC igualmente
-- (system/logind.conf.d/99-gigios-powerkey.conf).
-- Si el módulo no cargó, cae a la acción de fábrica: el botón físico no puede
-- quedar muerto por un error de Lua (misma asimetría fail-open que el módulo).
bind("XF86PowerOff", function()
  if GiGiOS.boton_apagado then
    GiGiOS.boton_apagado()
  else
    hl.exec_cmd("systemctl poweroff")
  end
end, { locked = true })

-- Requiere playerctl (los bindl de multimedia)
bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"), { locked = true })
bind("XF86AudioPause", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"), { locked = true })

------------------------------------------------------------------------ paneles
-- panel de ajustes (toggle)
bind(mod .. " + J", hl.dsp.exec_cmd("ags request toggle-settings"))
bind(mod .. " + SHIFT + J", hl.dsp.layout("togglesplit")) -- dwindle
-- Orion. Enlace TARDÍO como los demás GiGiOS.*: lo define gigios/orion.lua, que
-- comprueba la preferencia `orion` antes de mandar el toggle a AGS.
bind(mod .. " + ALT + SPACE", function()
  if GiGiOS.toggle_orion then GiGiOS.toggle_orion() end
end)
-- toggle de la barra (muestra/oculta; se auto-oculta al pasar el mouse)
bind(mod .. " + B", hl.dsp.exec_cmd("ags request toggle-bar"))

---------------------------------------------------------------------------------
-- GiGiOS.toggle_gaps() — inline de scripts/toggle-gaps-borders.sh.
--
-- El estado "modo compacto" vive en una local de Lua, no en un fichero de
-- $XDG_RUNTIME_DIR como hacía el script: la misma semántica efímera (muere con
-- la sesión), aceptada a propósito. Diferencia menor y ASUMIDA con un
-- `hyprctl reload`: el reload re-ejecuta el config, así que resetea a la vez
-- los gaps (a los valores de ventanas.lua) y este flag — quedan coherentes. El
-- esquema viejo era peor: el reload restauraba los gaps pero el fichero de
-- estado sobrevivía, y el siguiente toggle "restauraba" un estado en el que ya
-- estabas.
--
-- Los valores de vuelta (2.5 / 8 / 6) están escritos aquí, no leídos de
-- ventanas.lua — si algún día cambias los gaps por defecto allí, replícalo
-- aquí o el toggle "restaurará" un valor obsoleto (misma advertencia que
-- llevaba el script).
local compacto = false
function GiGiOS.toggle_gaps()
  compacto = not compacto
  if compacto then
    hl.config({ general = { gaps_in = 0, gaps_out = 0 }, decoration = { rounding = 0 } })
  else
    hl.config({ general = { gaps_in = 2.5, gaps_out = 8 }, decoration = { rounding = 6 } })
  end
end

-- `usados`/`normalizar` los consume gigios/nop-binds.lua (require cachea: es
-- la misma tabla que acabamos de llenar, no una copia).
return { usados = usados, normalizar = normalizar }
