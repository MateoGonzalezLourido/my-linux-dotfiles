-- Aspecto y comportamiento de ventanas: general, decoration, layouts y misc.
-- Aspecto de las ventanas: gaps, bordes, sombras, blur y layout.

-- FUENTE ÚNICA del "modo normal" del espaciado. GiGiOS.toggle_gaps()
-- (gigios/keybinds.lua, SUPER+SHIFT+E) restaura EXACTAMENTE esta tabla al salir
-- del modo compacto, en vez de los literales que llevaba copiados: cambiar un
-- gap aquí ya no deja el toggle restaurando un valor obsoleto. Es la única
-- escritura de estas cuatro claves en todo el config (verificado: reglas.lua
-- solo las nombra en ejemplos comentados), así que no hay otro escritor con el
-- que desincronizarse.
local aspecto = {
  -- El tipo gap es entero: el 2.5 se trunca a 2 igual que hacía hyprlang
  -- (medido: ambas sesiones reportan "2 2 2 2"). Se conserva el 2.5 del
  -- original por fidelidad.
  gaps_in  = 2.5,
  gaps_out = 8,
  border_size = 0,
  rounding    = 6,
}

hl.config({
  general = {
    gaps_in  = aspecto.gaps_in,
    gaps_out = aspecto.gaps_out,

    border_size = aspecto.border_size,

    -- https://wiki.hypr.land/Configuring/Variables/#variable-types (colores)
    col = {
      active_border   = { colors = { "rgba(ccccccee)", "rgba(888888ee)" }, angle = 45 },
      inactive_border = "rgba(595959aa)",
    },

    -- true = redimensionar ventanas arrastrando desde bordes y huecos.
    resize_on_border = false,

    -- Ver https://wiki.hypr.land/Configuring/Tearing/ antes de activarlo.
    -- (gaming.lua lo pone a true después; ver allí.)
    allow_tearing = false,

    layout = "dwindle",
  },

  decoration = {
    rounding       = aspecto.rounding,
    rounding_power = 4,
    active_opacity   = 1.0,
    inactive_opacity = 0.92,

    shadow = {
      enabled      = true,
      range        = 10,
      render_power = 4,
      offset       = { 0, 2 },
      color        = "rgba(00000088)",
    },

    blur = {
      enabled = true,
      size    = 3,
      passes  = 1,
    },
  },

  -- https://wiki.hypr.land/Configuring/Dwindle-Layout/
  dwindle = {
    -- preserve_split = true CONGELA la orientación del nodo padre: al arrastrar
    -- (SUPER + clic izq) la ventana solo INTERCAMBIA posición, nunca cambia de
    -- horizontal a vertical — había que pasar antes por SUPER + SHIFT + J
    -- (togglesplit). En false, dwindle recalcula la orientación al reinsertar la
    -- ventana en el árbol, que es justo lo que hace un drop.
    preserve_split = false,

    -- Y smart_split es lo que da el control fino al soltar: la orientación sale
    -- del CUADRANTE de la ventana destino sobre el que sueltas (mitad izq/dcha →
    -- se parten en vertical, lado a lado; mitad sup/inf → se apilan). Ignora
    -- preserve_split y force_split por diseño; también aplica al abrir ventana
    -- nueva, que pasa a nacer partiendo por donde tengas el cursor.
    smart_split = true,
  },

  -- https://wiki.hypr.land/Configuring/Master-Layout/
  master = {
    new_status = "master",
  },

  -- https://wiki.hypr.land/Configuring/Variables/#misc
  misc = {
    force_default_wallpaper = 0,   -- 0 o 1 desactiva los fondos con mascota anime.
    disable_hyprland_logo   = true, -- true quita el logo/anime girl aleatorio. :(

    focus_on_activate       = false, -- no roba el foco al abrirse apps
    mouse_move_enables_dpms = false, -- no despierta pantalla al mover ratón
    key_press_enables_dpms  = true,  -- sí la despierta al pulsar tecla
    disable_autoreload      = false, -- recarga conf automáticamente al guardar

    -- Una ventana maximizada NO pierde el maximizado porque se abra otra en su
    -- workspace: la nueva se coloca detrás, ya tileada al hueco que le toca.
    -- 0 = ignore (esto), 1 = take_over (la nueva hereda el maximizado y la
    -- vieja lo pierde), 2 = exit_fullscreen (el DEFAULT de Hyprland: la
    -- maximizada sale del estado y las dos se reparten el workspace).
    -- OJO: la opción que citan las guías, misc:new_window_takes_over_fullscreen,
    -- NO existe desde 0.5x — la sustituye esta, y ponerla no da ningún error.
    -- Peaje aceptado: la ventana nueva nace tapada y sin foco, así que abrir
    -- una app sobre una maximizada parece "que no ha hecho nada" hasta que
    -- sales del maximizado (SUPER+SHIFT+W) o cambias de foco.
    on_focus_under_fullscreen = 0,
  },
})

-- Lo consume gigios/keybinds.lua (require cachea: es la misma tabla que acaba de
-- aplicarse, no una copia). hyprland.lua carga este módulo con util.carga() e
-- ignora el retorno; el valor solo importa para quien lo pida.
return { aspecto = aspecto }
