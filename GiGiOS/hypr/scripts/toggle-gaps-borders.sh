#!/usr/bin/env bash
set -euo pipefail

state_file="${XDG_RUNTIME_DIR:-/tmp}/gigios-gaps-disabled"
if [[ -e "$state_file" ]]; then
  hyprctl keyword general:gaps_in 2.5
  hyprctl keyword general:gaps_out 8
  hyprctl keyword decoration:rounding 6
  rm -f "$state_file"
else
  hyprctl keyword general:gaps_in 0
  hyprctl keyword general:gaps_out 0
  hyprctl keyword decoration:rounding 0
  touch "$state_file"
fi
