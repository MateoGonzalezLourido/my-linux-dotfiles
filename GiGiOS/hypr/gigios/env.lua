-- Variables de entorno del sistema: las lee el SO y las apps.
--
-- OJO: el bloque de idioma de abajo lo reescribe AGS (fechaHora.ts) ENTRE los
-- marcadores «GiGiOS idioma» — no edites ese tramo a mano. Los marcadores se
-- conservan con el texto exacto que el escritor busca (aquí como comentario
-- Lua); cambiarlos deja el bloque huérfano y AGS añadiría uno nuevo debajo.

hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")
hl.env("LC_TIME", "es_ES.UTF-8")

hl.env("XDG_CURRENT_DESKTOP", "Hyprland")
hl.env("XDG_SESSION_TYPE", "wayland")
hl.env("XDG_SESSION_DESKTOP", "Hyprland")

-- Integra las aplicaciones Qt con la paleta oscura de qt6ct. Sin un tema de
-- plataforma, Dolphin ignora el esquema oscuro de kdeglobals bajo Hyprland.
hl.env("QT_QPA_PLATFORMTHEME", "qt6ct")
-- Reduce la densidad de Breeze en pantallas con escalado fraccional sin cambiar
-- la escala del resto del escritorio.
hl.env("QT_SCALE_FACTOR", "0.9")

-- >>> GiGiOS idioma (no editar a mano) >>>
hl.env("LANG", "es_ES.UTF-8")
hl.env("LC_ALL", "es_ES.UTF-8")
-- <<< GiGiOS idioma <<<
