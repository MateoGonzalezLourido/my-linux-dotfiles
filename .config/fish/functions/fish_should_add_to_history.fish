# Decide qué NO entra en el historial de Fish.
#
# Fish no tiene HISTIGNORE: este gancho es el único punto donde se puede filtrar
# (desde Fish 3.7). OJO CON UN DETALLE QUE NO DA NINGÚN ERROR: en cuanto esta
# función existe, Fish le cede TODAS las decisiones, incluida la regla de fábrica
# de no guardar lo que empieza por espacio. Si no se reimplementa aquí, escribir
# un comando con un espacio delante deja de ocultarlo y se guarda como cualquier
# otro. Por eso el primer bloque es esa regla.
#
# Devolver 0 = guardar, cualquier otra cosa = no guardar (la línea sigue
# recuperable con la flecha arriba durante ese mismo comando, nada más).
function fish_should_add_to_history --description 'Deja fuera del historial los comandos triviales'
    set -l cruda (string join ' ' -- $argv)

    # Lo escrito con espacio delante: fuera, a propósito.
    string match -qr '^[[:space:]]' -- $cruda; and return 1

    set -l linea (string trim -- $cruda)
    test -z "$linea"; and return 1

    set -l ignorar \
        clear c cls reset 'tput reset' \
        bash zsh fish sh dash \
        exit logout \
        pwd cd 'cd -' 'cd ..' .. ... \
        history \
        ls la ll lt l. \
        fastfetch neofetch

    contains -- $linea $ignorar; and return 1
    return 0
end
