#!/usr/bin/env fish

set current_ws (hyprctl activeworkspace -j | jq '.id')

# Workspaces con ventanas, excluir especiales (IDs negativos), ordenados
set occupied_ws (hyprctl workspaces -j | jq -r '[.[] | select(.windows > 0 and .id > 0)] | sort_by(.id) | .[].id')

if test (count $occupied_ws) -eq 0
    exit 0
end

set new_current -1
set new_id 1

for ws in $occupied_ws
    if test "$ws" -eq "$current_ws"
        set new_current $new_id
    end

    if test "$ws" -ne "$new_id"
        set windows (hyprctl clients -j | jq -r --argjson ws $ws '[.[] | select(.workspace.id == $ws)] | .[].address')
        for win in $windows
            hyprctl dispatch movetoworkspacesilent $new_id,address:$win
        end
    end

    set new_id (math $new_id + 1)
end

# Si el workspace actual estaba vacío, ir al último ocupado
if test $new_current -eq -1
    set new_current (math $new_id - 1)
end

hyprctl dispatch workspace $new_current
