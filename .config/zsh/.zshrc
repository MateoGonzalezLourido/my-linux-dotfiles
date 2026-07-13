# Configuración interactiva autónoma de Zsh.
[[ -o interactive ]] || return 0

export EDITOR=code
export VISUAL="$EDITOR"

# Historial compartido y sin duplicados triviales.
HISTFILE="$ZDOTDIR/.zsh_history"
HISTSIZE=10000
SAVEHIST=10000
setopt append_history extended_history hist_expire_dups_first
setopt hist_ignore_dups hist_ignore_space share_history interactive_comments

# Oh My Zsh aporta completado y plugins; Powerlevel10k se carga por separado.
export ZSH=/usr/share/oh-my-zsh
export ZSH_CUSTOM="${ZSH_CUSTOM:-$ZSH/custom}"
ZSH_THEME=''
DISABLE_MAGIC_FUNCTIONS=true
COMPLETION_WAITING_DOTS=true
ZSH_AUTOSUGGEST_STRATEGY=(history completion)

plugins=(git sudo)
typeset _plugin
for _plugin in zsh-256color zsh-autosuggestions zsh-syntax-highlighting; do
    if [[ -d "$ZSH_CUSTOM/plugins/$_plugin" || -d "$ZSH/plugins/$_plugin" ]]; then
        plugins+=("$_plugin")
    fi
done
unset _plugin

if [[ -r "$ZSH/oh-my-zsh.sh" ]]; then
    source "$ZSH/oh-my-zsh.sh"
else
    autoload -Uz compinit
    compinit -d "$ZDOTDIR/.zcompdump"
fi

if [[ -r /usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme ]]; then
    source /usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme
fi
[[ -r "$ZDOTDIR/.p10k.zsh" ]] && source "$ZDOTDIR/.p10k.zsh"

# Funciones y completados locales. fish-parity se carga al final para que sus
# bindings y alias sean los definitivos.
typeset _config_file
for _config_file in "$ZDOTDIR/functions/"*.zsh(N); do
    [[ "${_config_file:t}" == fish-parity.zsh ]] || source "$_config_file"
done
for _config_file in "$ZDOTDIR/completions/"*.zsh(N); do
    source "$_config_file"
done
unset _config_file

alias dotfiles='git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
alias c='clear'
alias vc='code'
alias mkdir='mkdir -p'
alias fastfetch='fastfetch --logo-type kitty'

# Gestor de paquetes real de la máquina, sin envoltorios externos.
typeset _pkg_helper
if command -v paru >/dev/null 2>&1; then
    _pkg_helper=paru
elif command -v yay >/dev/null 2>&1; then
    _pkg_helper=yay
else
    _pkg_helper='sudo pacman'
fi
alias in="$_pkg_helper -S"
alias un="$_pkg_helper -Rns"
alias up="$_pkg_helper -Syu"
alias pl="$_pkg_helper -Qs"
alias pa="$_pkg_helper -Ss"
alias pc="$_pkg_helper -Sc"
unset _pkg_helper

# Notifica los comandos largos cuando la terminal no tiene el foco.
typeset -g _lc_start=0 _lc_cmd=''
typeset -gi _LC_THRESHOLD=10
typeset -ga _LC_SKIP=(cd ls ll la clear pwd exit history source . eval builtin)

_lc_terminal_focused() {
    command -v hyprctl >/dev/null 2>&1 || return 1
    local class
    class=$(hyprctl activewindow -j 2>/dev/null | jq -r '.class // ""' 2>/dev/null)
    class="${class:l}"
    [[ "$class" == (kitty|foot|alacritty|wezterm|ghostty) || "$class" == *terminal* ]]
}

_lc_format() {
    local seconds=$1
    if (( seconds >= 3600 )); then
        printf '%dh %dm %ds' $((seconds / 3600)) $(((seconds % 3600) / 60)) $((seconds % 60))
    elif (( seconds >= 60 )); then
        printf '%dm %ds' $((seconds / 60)) $((seconds % 60))
    else
        printf '%ds' "$seconds"
    fi
}

_lc_preexec() {
    _lc_start=$(date +%s)
    _lc_cmd="$1"
}

_lc_precmd() {
    local exit_code=$?
    (( _lc_start == 0 )) && return

    local now duration base item
    now=$(date +%s)
    duration=$((now - _lc_start))
    _lc_start=0
    (( duration < _LC_THRESHOLD )) && return

    base="${_lc_cmd%% *}"
    for item in "${_LC_SKIP[@]}"; do
        [[ "$base" == "$item" ]] && return
    done
    _lc_terminal_focused && return

    local icon=FAIL
    (( exit_code == 0 )) && icon=OK
    notify-send "$icon: Comando terminado" \
        "${_lc_cmd} — $(_lc_format "$duration")" -t 8000 2>/dev/null
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _lc_preexec
add-zsh-hook precmd _lc_precmd

# Node.js mediante fnm.
FNM_PATH="$HOME/.local/share/fnm"
if [[ -d "$FNM_PATH" ]]; then
    export PATH="$FNM_PATH:$PATH"
    eval "$(fnm env --shell zsh)"
fi
unset FNM_PATH

[[ -r "$ZDOTDIR/functions/fish-parity.zsh" ]] && source "$ZDOTDIR/functions/fish-parity.zsh"

# Equivalente al greeting del perfil Fish, solo en una terminal real.
if [[ -t 1 ]] && command -v fastfetch >/dev/null 2>&1; then
    fastfetch --logo-type kitty
fi
