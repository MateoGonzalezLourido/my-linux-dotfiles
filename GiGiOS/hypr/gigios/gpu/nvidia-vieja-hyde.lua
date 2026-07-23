-- █▄░█ █░█ █ █▀▄ █ ▄▀█
-- █░▀█ ▀▄▀ █ █▄▀ █ █▀█
--
-- Elegido por ~/.config/gigios/gpu-perfil (ver gigios/gpu.lua).
-- Para equipos multi-GPU: prueba a mano qué entorno te funciona mejor.
--
-- Configuración NVIDIA de Hyprland. Ver https://wiki.hypr.land/Nvidia/

hl.env("LIBVA_DRIVER_NAME", "nvidia")
hl.env("__GLX_VENDOR_LIBRARY_NAME", "nvidia") -- desactívalo si tienes problemas con el screensharing

hl.config({
  cursor = {
    -- Si quieres probar cursores por hardware necesitarías use_cpu_buffer =
    -- true — pero OJO: la API Lua descarta 0/false en esta clave (queda el
    -- auto; medido, ver gpu/laptop-hibrida.lua).
    no_hardware_cursors = true, -- true evita tirones
    -- use_cpu_buffer = true,
  },
})

-- https://wiki.hypr.land/Nvidia/#va-api-hardware-video-acceleration
-- La aceleración de vídeo por hardware en NVIDIA + Wayland es posible con
-- nvidia-vaapi-driver. Puede resolver problemas concretos en apps Electron.
hl.env("NVD_BACKEND", "direct") -- Requiere el paquete 'libva-nvidia-driver'

-- https://wiki.hypr.land/Nvidia/#regarding-environment-variables
-- Si Firefox se te cuelga, quita esta línea.
hl.env("GBM_BACKEND", "nvidia-drm")
hl.env("__NV_PRIME_RENDER_OFFLOAD", "1")
-- Si tienes multi-GPU y notas lag en el monitor externo:
-- https://wiki.hypr.land/Configuring/Multi-GPU/
hl.env("__GL_THREADED_OPTIMIZATIONS", "1")
