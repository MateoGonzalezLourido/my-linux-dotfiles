-- Selector del perfil de GPU por máquina.
--
-- En hyprlang esto era "descomenta la línea de tu equipo" en hyprland.conf. Aquí
-- la elección es ESTADO LOCAL, no código versionado (mismo criterio que
-- docs/anadir-perfiles-por-equipo.md: la elección de cada máquina no viaja en
-- git): un fichero de texto plano con el nombre del perfil, fuera del repo.
--
--   echo sobremesa-nvidia > ~/.config/gigios/gpu-perfil
--
-- Perfiles válidos = los módulos de gigios/gpu/. Sin fichero o con un nombre
-- inválido NO se aplica ningún perfil y se avisa en pantalla: el compositor
-- arranca igualmente (fail-open, como la puerta del Wake Up), solo que sin las
-- variables de entorno/opciones de su GPU.
local util = require("gigios.util")

local VALIDOS = {
  ["laptop-hibrida"] = true,
  ["sobremesa-nvidia"] = true,
  ["nvidia-vieja-hyde"] = true,
}

local ruta = util.HOGAR .. "/.config/gigios/gpu-perfil"
local nombre = (util.leer_fichero(ruta) or ""):gsub("%s+", "")

if nombre == "" then
  util.notificar("sin perfil de GPU: escribe uno en ~/.config/gigios/gpu-perfil "
    .. "(laptop-hibrida | sobremesa-nvidia | nvidia-vieja-hyde)")
elseif not VALIDOS[nombre] then
  util.notificar("perfil de GPU desconocido: '" .. nombre .. "' (gpu-perfil)")
else
  util.carga("gigios.gpu." .. nombre)
end
