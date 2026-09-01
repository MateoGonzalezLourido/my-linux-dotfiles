# Configuración interactiva autónoma de Zsh.
[[ -o interactive ]] || return 0

# Prompt instantáneo de Powerlevel10k. Tiene que quedarse arriba del todo: pinta
# el prompt desde una cache antes de que carguen Oh My Zsh, compinit, p10k y
# fastfetch, que es lo que hacia esperar al abrir cada terminal. Cualquier cosa
# que pida entrada por consola (contraseñas, [y/n]) va POR ENCIMA de este bloque.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
    source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

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

# Oh My Zsh solo carga los plugins que trae EL PROPIO Oh My Zsh. Los de Arch
# (autosuggestions, syntax-highlighting, history-substring-search) NO viven en
# $ZSH/plugins ni en $ZSH_CUSTOM/plugins sino en /usr/share/zsh/plugins, asi que
# buscarlos aqui no encuentra nada y OMZ los ignora SIN DAR NINGUN ERROR. Se
# cargan a mano mas abajo, donde el orden entre ellos importa.
plugins=(git sudo)

if [[ -r "$ZSH/oh-my-zsh.sh" ]]; then
    source "$ZSH/oh-my-zsh.sh"
else
    autoload -Uz compinit
    compinit -d "$ZDOTDIR/.zcompdump"
fi

# Tab completa tambien ficheros y directorios ocultos (.config, .zshrc...), como
# hace Fish. compinit crea $_comp_options, asi que esto va DESPUES de cargarlo.
_comp_options+=(globdots)

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

# Bun.
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Plugins de Arch, en el unico orden que documentan sus autores:
#   syntax-highlighting -> history-substring-search -> autosuggestions
# history-substring-search lo carga fish-parity.zsh por dentro, de ahi que el
# resaltado vaya antes del source y las sugerencias despues.
_zsh_plugins=/usr/share/zsh/plugins
[[ -r "$_zsh_plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]] &&
    source "$_zsh_plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"

[[ -r "$ZDOTDIR/functions/fish-parity.zsh" ]] && source "$ZDOTDIR/functions/fish-parity.zsh"

[[ -r "$_zsh_plugins/zsh-autosuggestions/zsh-autosuggestions.zsh" ]] &&
    source "$_zsh_plugins/zsh-autosuggestions/zsh-autosuggestions.zsh"
unset _zsh_plugins

# Equivalente al greeting del perfil Fish. Solo en terminales que saben pintar el
# logo por el protocolo de imagenes: con --logo-type kitty en cualquier otra
# (VS Code, ssh, tty) sale basura o un retardo que no compensa.
if [[ -t 1 ]] && command -v fastfetch >/dev/null 2>&1; then
    case "${TERM_PROGRAM:-$TERM}" in
        kitty | xterm-kitty | ghostty | xterm-ghostty | WezTerm | konsole)
            fastfetch --logo-type kitty
            ;;
    esac
fi

# bun completions
[ -s "/home/paraguayo33/.bun/_bun" ] && source "/home/paraguayo33/.bun/_bun"
