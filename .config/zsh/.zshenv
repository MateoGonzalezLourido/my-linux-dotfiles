#!/usr/bin/env zsh

# Entorno común para shells interactivos y no interactivos.
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export XDG_DATA_DIRS="${XDG_DATA_DIRS:-$XDG_DATA_HOME:/usr/local/share:/usr/share}"

typeset -U path PATH
path=("$HOME/.local/bin" "${path[@]}")
export PATH

export LESSHISTFILE="${LESSHISTFILE:-/tmp/less-hist}"
export PARALLEL_HOME="$XDG_CONFIG_HOME/parallel"
export SCREENRC="$XDG_CONFIG_HOME/screen/screenrc"
export TERMINFO="$XDG_DATA_HOME/terminfo"
export TERMINFO_DIRS="$XDG_DATA_HOME/terminfo:/usr/share/terminfo"
export WGETRC="$XDG_CONFIG_HOME/wgetrc"
export PYTHON_HISTORY="$XDG_STATE_HOME/python_history"
