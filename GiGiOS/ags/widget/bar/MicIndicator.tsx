import { Gtk, Gdk } from "ags/gtk4"
import { createComputed, createState } from "ags"
import AstalWp from "gi://AstalWp"

export default function MicIndicator() {
    const [isRecording, setIsRecording] = createState(false)
    const [isMuted, setIsMuted] = createState(false)
    const [hasMic, setHasMic] = createState(false)
    // Visible siempre que haya un micro conectado Y alguna app lo esté usando.
    // El mute ya NO oculta el icono: solo cambia su apariencia (ver más abajo),
    // para que se vea que una app tiene el micro abierto aunque esté silenciado.
    const visible = createComputed(() => hasMic() && isRecording())

    // El micro se considera "activo" si CUALQUIER app tiene una captura abierta.
    // AstalWp ya expone esas capturas como `audio.recorders` y emite
    // `recorder-added`/`recorder-removed` al instante, así que en vez de sondear
    // `pactl` cada 2 s (un subproceso por monitor) reaccionamos a las señales:
    // cero subprocesos, cero timers y sin coste cuando no hay nada capturando.
    const audio = AstalWp.get_default()?.audio
    let mic = audio?.defaultMicrophone ?? null

    const syncMute = () => setIsMuted(!!mic?.mute)
    const toggleMute = () => {
        if (!mic) return
        const next = !mic.mute
        mic.mute = next
        setIsMuted(next)
    }

    if (audio) {
        // PipeWire puede mantener fuentes virtuales incluso en equipos sin una
        // entrada física. Solo cuentan endpoints asociados a un Device real y
        // cuya ruta no esté marcada explícitamente como no disponible.
        const syncHardware = () => {
            const microphones = audio.microphones ?? []
            setHasMic(microphones.some((endpoint) => {
                if (!endpoint.device) return false
                const route = endpoint.route
                return !route || route.available !== AstalWp.Available.NO
            }))
        }
        const sync = () => setIsRecording((audio.recorders?.length ?? 0) > 0)
        sync()
        syncHardware()
        audio.connect("recorder-added", sync)
        audio.connect("recorder-removed", sync)
        audio.connect("microphone-added", syncHardware)
        audio.connect("microphone-removed", syncHardware)
        // Cubre el caso de que ya hubiera una captura al arrancar/recargar AGS
        // (el recorder-added pudo emitirse antes de conectar los handlers).
        audio.connect("notify::recorders", sync)

        let muteId = 0
        const bindMic = (next: AstalWp.Endpoint | null) => {
            if (mic && muteId) mic.disconnect(muteId)
            mic = next
            muteId = mic ? mic.connect("notify::mute", syncMute) : 0
            syncMute()
        }
        bindMic(mic)
        audio.connect("notify::default-microphone", () => bindMic(audio.defaultMicrophone))
    }

    return (
        <box
            visible={visible}
            valign={Gtk.Align.CENTER}
            cssClasses={isMuted((m) =>
                m ? ["recording", "mic-indicator", "muted"] : ["recording", "mic-indicator"],
            )}
            tooltipText={isMuted((m) =>
                m
                    ? "Micrófono silenciado (app usándolo) · clic derecho para reactivar"
                    : "Micrófono activo · clic derecho para silenciar",
            )}
        >
            <Gtk.GestureClick
                button={Gdk.BUTTON_SECONDARY}
                onPressed={(self) => {
                    toggleMute()
                    self.set_state(Gtk.EventSequenceState.CLAIMED)
                }}
            />
            <label
                cssClasses={["icon"]}
                label={isMuted((m) => (m ? "󰍭" : "󰍬"))}
            />
        </box>
    )
}
