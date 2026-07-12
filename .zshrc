source /usr/share/cachyos-zsh-config/cachyos-config.zsh

# __long-cmd-notify__ — notificar comandos largos (>10s) si la terminal no tiene foco
_lc_start=0
_lc_cmd=""
_LC_THRESHOLD=10
_LC_SKIP=(cd ls ll la clear pwd exit history source . eval builtin)

_lc_terminal_focused() {
    command -v hyprctl &>/dev/null || return 1
    local class
    class=$(hyprctl activewindow -j 2>/dev/null | jq -r '.class // ""' 2>/dev/null)
    class="${class:l}"
    [[ "$class" == "kitty"     || "$class" == "foot"      ||
       "$class" == "alacritty" || "$class" == "wezterm"   ||
       "$class" == "ghostty"   || "$class" == *"terminal"* ]]
}

_lc_format() {
    local s=$1
    if (( s >= 3600 )); then printf "%dh %dm %ds" $((s/3600)) $(((s%3600)/60)) $((s%60))
    elif (( s >= 60 )); then printf "%dm %ds" $((s/60)) $((s%60))
    else printf "%ds" $s
    fi
}

_lc_preexec() {
    _lc_start=$(date +%s)
    _lc_cmd="$1"
}

_lc_precmd() {
    local exit_code=$?
    (( _lc_start == 0 )) && return

    local now duration
    now=$(date +%s)
    duration=$(( now - _lc_start ))
    _lc_start=0

    (( duration < _LC_THRESHOLD )) && return

    local base="${_lc_cmd%% *}"
    local skip=0
    for s in "${_LC_SKIP[@]}"; do [[ "$base" == "$s" ]] && skip=1 && break; done
    (( skip )) && return

    _lc_terminal_focused && return

    local icon
    (( exit_code == 0 )) && icon="OK" || icon="FAIL"
    notify-send "${icon}: Comando terminado" \
        "${_lc_cmd} — $(_lc_format "$duration")" -t 8000 2>/dev/null
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _lc_preexec
add-zsh-hook precmd  _lc_precmd

alias dotfiles='git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
