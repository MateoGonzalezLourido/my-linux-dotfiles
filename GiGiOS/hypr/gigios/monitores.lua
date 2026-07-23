-- Monitores: la regla comodín, el fallback para cualquier salida sin
-- preferencia guardada (las concretas las genera AGS en monitor-settings.lua).
--
-- Configuración genérica: usa la resolución preferida del monitor a escala 1.
-- Es solo el fallback: monitor-settings.lua (generado por AGS · Ajustes >
-- Pantalla) se carga DESPUÉS y sus reglas por `desc:` pisan a esta comodín —
-- sin él, un `hyprctl reload` devolvería la pantalla a modo preferido/escala 1.
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = "1" })

-- Mejora la nitidez en apps XWayland.
hl.config({
  xwayland = {
    force_zero_scaling = true,
  },
})
