# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.config/zsh/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Add user configurations here
# For HyDE to not touch your beloved configurations,
# we added a config file for you to customize HyDE before loading zshrc
# Edit $ZDOTDIR/.user.zsh to customize HyDE before loading zshrc

#  Plugins 
# oh-my-zsh plugins are loaded  in $ZDOTDIR/.user.zsh file, see the file for more information

#  Aliases 
# Override aliases here in '$ZDOTDIR/.zshrc' (already set in .zshenv)

alias dotfiles='git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'

# # Helpful aliases
# alias c='clear'                                                        # clear terminal
# alias l='eza -lh --icons=auto'                                         # long list
# alias ls='eza -1 --icons=auto'                                         # short list
# alias ll='eza -lha --icons=auto --sort=name --group-directories-first' # long list all
# alias ld='eza -lhD --icons=auto'                                       # long list dirs
# alias lt='eza --icons=auto --tree'                                     # list folder as tree
# alias un='$aurhelper -Rns'                                             # uninstall package
# alias up='$aurhelper -Syu'                                             # update system/package/aur
# alias pl='$aurhelper -Qs'                                              # list installed package
# alias pa='$aurhelper -Ss'                                              # list available package
# alias pc='$aurhelper -Sc'                                              # remove unused cache
# alias po='$aurhelper -Qtdq | $aurhelper -Rns -'                        # remove unused packages, also try > $aurhelper -Qqd | $aurhelper -Rsu --print -
# alias vc='code'                                                        # gui code editor
# alias fastfetch='fastfetch --logo-type kitty'

# # Directory navigation shortcuts
# alias ..='cd ..'
# alias ...='cd ../..'
# alias .3='cd ../../..'
# alias .4='cd ../../../..'
# alias .5='cd ../../../../..'

# # Always mkdir a path (this doesn't inhibit functionality to make a single dir)
# alias mkdir='mkdir -p'

#  This is your file 
# Add your configurations here
# export EDITOR=nvim
export EDITOR=code

# unset -f command_not_found_handler # Uncomment to prevent searching for commands not found in package manager

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

# To customize prompt, run `p10k configure` or edit ~/.config/zsh/.p10k.zsh.
[[ ! -f ~/.config/zsh/.p10k.zsh ]] || source ~/.config/zsh/.p10k.zsh

# fnm
FNM_PATH="/home/paraguayo33/.local/share/fnm"
if [ -d "$FNM_PATH" ]; then
  export PATH="$FNM_PATH:$PATH"
  eval "$(fnm env --shell zsh)"
fi
