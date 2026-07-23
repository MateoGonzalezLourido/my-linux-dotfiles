-- gigios/compactar.lua — renumera los escritorios ocupados a IDs consecutivos.
--
-- GiGiOS.compactar() renumera los escritorios OCUPADOS a IDs consecutivos desde
-- 1, moviendo ventanas en silencio y siguiendo al escritorio activo hasta su
-- nuevo número. Sin ventanas en ningún escritorio no hace nada. Los especiales
-- (id < 0) se ignoran.
--
-- Frente al script, todo ocurre SÍNCRONO dentro de la llamada (cero forks: el
-- .sh lanzaba un hyprctl+jq por escritorio a mover) — por eso
-- gigios/escaner-apps.lua puede re-resolver escritorios justo después de
-- llamarlo, sin timers de por medio. Medido en la anidada: 3 ventanas en 3
-- escritorios ≈ 0,2 ms.
--
-- Firma verificada en instancia anidada (no supuesta — las dos formas obvias
-- fallan EN SILENCIO): `window` tiene que ser el OBJETO HL.Window, no su
-- address en string (con string el selector no casa y el dispatcher mueve la
-- ventana activa), y el "silent" se dice `follow = false` (un `silent = true`
-- se ignora y el foco se va detrás de la ventana):
--   hl.dsp.window.move({ workspace = N, window = <HL.Window>, follow = false })
local util = require("gigios.util")

function GiGiOS.compactar()
  local ok, err = pcall(function()
    local activo = hl.get_active_workspace()
    local activo_id = activo and activo.id or nil

    -- Ocupados = con ventanas y de id positivo (fuera especiales), ordenados.
    local ocupados = {}
    for _, ws in ipairs(hl.get_workspaces()) do
      if ws.id > 0 and ws.windows > 0 then
        ocupados[#ocupados + 1] = ws.id
      end
    end
    if #ocupados == 0 then return end
    table.sort(ocupados)

    -- Mismo recorrido que el script: al i-ésimo ocupado le toca el id i. Las
    -- ventanas se leen POR escritorio y en el momento de moverlo — como los ids
    -- destino siempre van por detrás del recorrido, ningún movimiento pisa un
    -- escritorio aún pendiente.
    local nuevo_activo = -1
    local nuevo_id = 1
    for _, ws_id in ipairs(ocupados) do
      if ws_id == activo_id then nuevo_activo = nuevo_id end
      if ws_id ~= nuevo_id then
        for _, ventana in ipairs(hl.get_workspace_windows(ws_id)) do
          hl.dispatch(hl.dsp.window.move({
            workspace = nuevo_id,
            window = ventana,
            follow = false,
          }))
        end
      end
      nuevo_id = nuevo_id + 1
    end

    -- Seguir al activo: si estaba en un ocupado, a su nuevo número; si estaba
    -- en uno vacío, al último ocupado (igual que el script).
    if nuevo_activo < 0 then nuevo_activo = nuevo_id - 1 end
    hl.dispatch(hl.dsp.focus({ workspace = nuevo_activo }))
  end)
  if not ok then
    util.notificar("compactar: " .. tostring(err):sub(1, 200))
  end
end
