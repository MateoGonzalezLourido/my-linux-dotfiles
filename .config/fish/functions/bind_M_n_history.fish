function bind_M_n_history
    for i in (seq 9)
        set -l command
        if test (count $history) -ge $i
            set command "commandline -r \$history[$i]"
        else
            set command "echo \"No history found for number $i\""
        end

        if contains fish_vi_key_bindings $fish_key_bindings
            bind -M default alt-$i "$command"
            bind -M insert alt-$i "$command"
        else
            bind alt-$i "$command"
        end
    end
end
