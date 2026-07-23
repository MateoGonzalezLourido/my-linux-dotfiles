-- Aspecto y comportamiento de ventanas: general, decoration, layouts y misc.
-- Aspecto de las ventanas: gaps, bordes, sombras, blur y layout.

hl.config({
  general = {
    -- El tipo gap es entero: el 2.5 se trunca a 2 igual que hacía hyprlang
    -- (medido: ambas sesiones reportan "2 2 2 2"). Se conserva el 2.5 del
    -- original por fidelidad. Si cambias los gaps, replica el cambio en
    -- scripts/toggle-gaps-borders.sh, que restaura estos valores escritos
    -- allí a mano, no leídos de aquí.
    gaps_in  = 2.5,
    gaps_out = 8,

    border_size = 0,

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
    rounding       = 6,
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
    preserve_split = true, -- Probablemente lo quieres.
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
