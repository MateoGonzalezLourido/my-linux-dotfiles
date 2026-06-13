#!/usr/bin/fish
set state_file /tmp/hypr-gaps-state

if test -f $state_file
    hyprctl keyword general:gaps_in 2.5
    hyprctl keyword general:gaps_out 8
    hyprctl keyword decoration:rounding 6
    rm $state_file
else
    hyprctl keyword general:gaps_in 0
    hyprctl keyword general:gaps_out 0
    hyprctl keyword decoration:rounding 0
    touch $state_file
end
