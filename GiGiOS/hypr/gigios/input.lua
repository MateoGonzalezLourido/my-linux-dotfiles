-- Entrada: teclado, ratón, touchpad y gestos.
-- https://wiki.hypr.land/Configuring/Variables/#input

hl.config({
  input = {
    kb_layout  = "es",
    kb_variant = "",
    kb_model   = "",
    kb_options = "",
    kb_rules   = "",
    -- Bloq numérico activo automáticamente, incluso en el lock.
    numlock_by_default = true,
    follow_mouse = 1,

    sensitivity = 0, -- -1.0 - 1.0, 0 = sin modificación.

    touchpad = {
      natural_scroll = true,
      scroll_factor  = 0.4, -- ajusta entre 0.1 y 1.0
    },
  },
})

-- Cambiar de workspace deslizando horizontalmente con tres dedos.
-- Se mantiene aquí (y no en input-settings) para no registrarlo dos veces.
hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })

-- Ejemplo de config por dispositivo.
-- https://wiki.hypr.land/Configuring/Keywords/#per-device-input-configs
hl.device({
  name        = "epic-mouse-v1",
  sensitivity = -0.5,
})
