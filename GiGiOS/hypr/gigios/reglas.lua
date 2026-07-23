-- gigios/reglas.lua — reglas de ventana y de capa.
--
-- Los nombres de campo vienen verificados contra los stubs
-- (/usr/share/hypr/stubs/hl.meta.lua: HL.LayerRuleSpec) y la documentación de
-- la API Lua; el ejemplo oficial /usr/share/hypr/hyprland.lua confirma
-- suppress_event / no_focus / float / move. Una regla con un campo mal escrito
-- NO da error: simplemente no casa — de ahí tanta verificación.
--
-- Los regex con backslash van en [[...]]: en un string con comillas, Lua
-- rechaza escapes desconocidos como `\.` en tiempo de compilación.

-- Tearing en juegos (requiere general.allow_tearing = true, en gaming.lua).
-- Ajusta el match a tus juegos; steam_app_* cubre casi todo lo de Steam.
hl.window_rule({
    name  = "tearing-games",
    match = { class = [[^(steam_app_.*|gamescope|.*\.exe)$]] },
    immediate = true,
})

-- Firefox & Kitty: opacidad forzada a 1.0 (activa e inactiva).
hl.window_rule({
    name  = "firefox-opacity",
    match = { class = "firefox" },
    opacity = "1.0 override 1.0 override",
})

hl.window_rule({
    name  = "kitty-opacity",
    match = { class = "kitty" },
    opacity = "1.0 override 1.0 override",
})

-- Calculadora
hl.window_rule({
    name  = "qalculate",
    match = { class = "qalculate-gtk" },
    float = true,
})

-- Selector de archivos del portal (Abrir/Guardar de navegadores y apps GTK).
-- Nace tiled y por tanto reordena el tiling del workspace entero para un
-- diálogo que cierras en dos segundos. Clase verificada en el socket de
-- eventos: `openwindow>>…,xdg-desktop-portal-gtk,…`.
--
-- OJO: aquí NO vale un `size = "60% 60%"`. Bajo Lua, size/move
-- van al motor de expresiones (muParser: Window.cpp calculateSingleExpr), que
-- NO tiene operador `%`: la expresión falla y el tamaño simplemente no se
-- aplica, sin error en el log (medido en anidada: la ventana quedaba con su
-- tamaño propio). El equivalente es multiplicar las variables monitor_w/h.
hl.window_rule({
    name  = "portal-file-chooser",
    match = { class = "xdg-desktop-portal-gtk" },
    float  = true,
    size   = "monitor_w*0.6 monitor_h*0.6",
    center = true,
})

-- --- Utilidades de sistema: ventanas de usar y tirar ---
-- Abres el control de volumen, tocas un slider y cierras. Naciendo tiled te
-- reordenan el workspace entero para eso. Clases verificadas lanzando cada app
-- y leyendo `initialClass` de hyprctl clients, no supuestas: varias NO
-- coinciden con el nombre del binario (pavucontrol -> org.pulseaudio.pavucontrol,
-- gnome-disks -> org.gnome.DiskUtility), y adivinarlas deja reglas que no disparan.

hl.window_rule({
    name  = "pavucontrol",
    match = { class = "org.pulseaudio.pavucontrol" },
    float  = true,
    center = true,
})

hl.window_rule({
    name  = "blueman",
    match = { class = "blueman-manager" },
    float  = true,
    center = true,
})

hl.window_rule({
    name  = "nm-connection-editor",
    match = { class = "nm-connection-editor" },
    float  = true,
    center = true,
})

hl.window_rule({
    name  = "gnome-disks",
    match = { class = "org.gnome.DiskUtility" },
    float  = true,
    center = true,
})

-- Picture-in-Picture de Firefox: flotante y SIEMPRE encima, que es su razón de
-- ser (la ves mientras haces otra cosa). `pin` la mantiene además al cambiar de
-- workspace. Ojo: título sin verificar aquí — si Firefox lo traduce en tu
-- idioma, esta regla no dispara y hay que ajustar el match.
hl.window_rule({
    name  = "firefox-pip",
    match = { class = "firefox", title = "Picture-in-Picture" },
    float = true,
    pin   = true,
})

-- Panel de wifi
hl.window_rule({
    name  = "wifi-panel",
    match = { class = "wifi-panel" },
    float = true,
    move  = "1540 44",
    size  = "340 600",
    pin   = true,
})

hl.layer_rule({
    name  = "waybar-layer",
    match = { namespace = "waybar" },
    blur  = true,
})

hl.layer_rule({
    name  = "orion-acrilico",
    match = { namespace = "orion" },
    blur  = true,
    ignore_alpha = 0.1,
})

hl.layer_rule({
    name  = "quick-settings-acrilico",
    match = { namespace = "quick-settings" },
    blur  = true,
    ignore_alpha = 0.1,
})

hl.layer_rule({
    name  = "notificaciones-acrilico",
    match = { namespace = "notification-panel" },
    blur  = true,
    ignore_alpha = 0.1,
})

hl.layer_rule({
    name  = "calendario-acrilico",
    match = { namespace = "calendar-panel" },
    blur  = true,
    ignore_alpha = 0.1,
})

-- La pila de popups es UNA sola superficie que crece al apilar avisos, y
-- Hyprland anima ese cambio de tamaño: mientras dura, el buffer nuevo (más
-- alto) se escala dentro de la caja que aún está creciendo, así que los popups
-- que YA estaban en pantalla se encogen y vuelven — se ve como un pestañeo en
-- el que desaparecen y se vuelven a dibujar. Medido con grim: con la animación
-- activa el rectángulo del popup de arriba cambia durante ~150 ms al llegar el
-- siguiente; sin ella es constante bit a bit. No se anima nada que el usuario
-- quiera ver: la entrada y la salida de cada aviso las hace GTK con sus
-- keyframes (notif-slide-in / notif-slide-out en estilos/style.scss), no el
-- compositor.
hl.layer_rule({
    name  = "notificaciones-popup-sin-anim",
    match = { namespace = "notification-popups" },
    animation = "none",
})

hl.layer_rule({
    name  = "osd-acrilico",
    match = { namespace = "osd" },
    blur  = true,
    ignore_alpha = 0.1,
})

-- Ref https://wiki.hypr.land/Configuring/Workspace-Rules/
-- "Smart gaps" / "No gaps when only" — descomenta todo si lo quieres usar.
-- hl.workspace_rule({ workspace = "w[tv1]", gaps_out = 0, gaps_in = 0 })
-- hl.workspace_rule({ workspace = "f[1]",   gaps_out = 0, gaps_in = 0 })
-- hl.window_rule({
--     name  = "no-gaps-wtv1",
--     match = { float = false, workspace = "w[tv1]" },
--     border_size = 0,
--     rounding    = 0,
-- })
-- hl.window_rule({
--     name  = "no-gaps-f1",
--     match = { float = false, workspace = "f[1]" },
--     border_size = 0,
--     rounding    = 0,
-- })

--------------------------------
---- WINDOWS AND WORKSPACES ----
--------------------------------

-- See https://wiki.hypr.land/Configuring/Window-Rules/ for more
-- See https://wiki.hypr.land/Configuring/Workspace-Rules/ for workspace rules

hl.window_rule({
    -- Ignore maximize requests from all apps. You'll probably like this.
    name  = "suppress-maximize-events",
    match = { class = ".*" },
    suppress_event = "maximize",
})

hl.window_rule({
    -- Fix some dragging issues with XWayland
    name  = "fix-xwayland-drags",
    match = {
        class      = "^$",
        title      = "^$",
        xwayland   = true,
        float      = true,
        fullscreen = false,
        pin        = false,
    },
    no_focus = true,
})

-- Hyprland-run windowrule
hl.window_rule({
    name  = "move-hyprland-run",
    match = { class = "hyprland-run" },
    move  = "20 monitor_h-120",
    float = true,
})
