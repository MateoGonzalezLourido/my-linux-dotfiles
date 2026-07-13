command_not_found_handler() {
    print -u2 -- "zsh: comando no encontrado: $1"

    if command -v pkgfile >/dev/null 2>&1; then
        local matches
        matches="$(command pkgfile -b -- "$1" 2>/dev/null | head -10)"
        if [[ -n "$matches" ]]; then
            print -u2 -- 'Puede estar incluido en:'
            print -u2 -- "$matches"
        fi
    fi
    return 127
}

no_such_file_or_directory_handler() {
    print -u2 -- "zsh: no existe el archivo o directorio: $1"
    return 127
}
