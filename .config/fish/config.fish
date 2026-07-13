source /usr/share/cachyos-fish-config/cachyos-config.fish

# overwrite greeting
# potentially disabling fastfetch
#function fish_greeting
#    # smth smth
#end
alias dotfiles='git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'

# Fish 4 no siempre vuelve a ejecutar esta función después de que el perfil de
# CachyOS instala sus bindings; aplicarla aquí hace efectivos Alt+1..Alt+9.
if status is-interactive
    fish_user_key_bindings
end
