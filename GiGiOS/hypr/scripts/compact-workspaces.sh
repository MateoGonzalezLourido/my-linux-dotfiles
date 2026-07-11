#!/usr/bin/env bash
set -euo pipefail

current_ws=$(hyprctl activeworkspace -j | jq -r '.id')
mapfile -t occupied < <(hyprctl workspaces -j | jq -r '[.[] | select(.windows > 0 and .id > 0)] | sort_by(.id) | .[].id')
((${#occupied[@]})) || exit 0

new_current=-1
new_id=1
for workspace in "${occupied[@]}"; do
  [[ "$workspace" == "$current_ws" ]] && new_current=$new_id
  if [[ "$workspace" != "$new_id" ]]; then
    while IFS= read -r address; do
      [[ -n "$address" ]] && hyprctl dispatch movetoworkspacesilent "$new_id,address:$address"
    done < <(hyprctl clients -j | jq -r --argjson ws "$workspace" '.[] | select(.workspace.id == $ws) | .address')
  fi
  ((new_id += 1))
done

((new_current >= 0)) || new_current=$((new_id - 1))
hyprctl dispatch workspace "$new_current"
