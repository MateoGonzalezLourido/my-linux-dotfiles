-- ============================================================
--  GPU — SOBREMESA  (NVIDIA única, sin iGPU al mando)
--  Elegido por ~/.config/gigios/gpu-perfil (ver gigios/gpu.lua).
--
--  Aquí el compositor renderiza y escanea por la NVIDIA directamente.
--  Ver: https://wiki.hypr.land/Nvidia/
-- ============================================================

-- Backend GBM/GLX sobre NVIDIA (necesario cuando NVIDIA es la GPU principal)
hl.env("GBM_BACKEND", "nvidia-drm")
hl.env("__GLX_VENDOR_LIBRARY_NAME", "nvidia") -- desactívalo si falla el screensharing

-- Aceleración de vídeo por hardware (VA-API) con la NVIDIA.
-- Requiere el paquete 'libva-nvidia-driver'.
hl.env("LIBVA_DRIVER_NAME", "nvidia")
hl.env("NVD_BACKEND", "direct")

-- Optimización de hilos del driver NVIDIA
hl.env("__GL_THREADED_OPTIMIZATIONS", "1")

hl.config({
  cursor = {
    -- Cursores por hardware en NVIDIA suelen causar tirones -> mejor por software.
    no_hardware_cursors = true,
    -- Si quisieras activar HW cursors necesitarías también use_cpu_buffer =
    -- true — pero OJO: la API Lua descarta 0/false en esta clave (queda el
    -- auto; medido, ver gpu/laptop-hibrida.lua).
  },
})

-- Si tuvieras VARIAS tarjetas también en el sobremesa, aquí fijarías la primaria.
-- Por defecto NO se fija: aquamarine ya elige la GPU que maneja la pantalla, y
-- cualquier valor mal puesto deja a Hyprland sin GPU -> ABORTA al arrancar
-- (SIGABRT en initServer) y te devuelve a SDDM.
--
-- Si aun así necesitas fijarla, DOS trampas:
--   1. La lista se separa por DOS PUNTOS, y una ruta by-path lleva ':' dentro
--      (pci-0000:01:00.0-card): aquamarine la parte en dispositivos inventados,
--      no encuentra ninguna GPU y Hyprland aborta. NUNCA uses by-path aquí.
--   2. /dev/dri/cardN sí vale, pero la numeración puede bailar entre reinicios,
--      así que comprueba cuál es la tuya: ls -l /dev/dri/by-path/
-- hl.env("AQ_DRM_DEVICES", "/dev/dri/card1")
