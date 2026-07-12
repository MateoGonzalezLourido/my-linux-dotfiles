import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createComputed, createState } from "ags"
import AstalWp from "gi://AstalWp"
import { barVisible, osdVisible, micOsdVisible, setMicOsdVisible } from "./state"
import { barAutoHideEnabled, micOsdEnabled } from "./settings/preferences"

let micOsdTimeout: number | null = null
let micOsdReady = false
setTimeout(() => { micOsdReady = true }, 3000)

function hideMicOSD() {
    setMicOsdVisible(false)
    if (micOsdTimeout) clearTimeout(micOsdTimeout)
    micOsdTimeout = null
}

export function showMicOSD() {
    // Algunos dispositivos publican un cambio de mute al inicializar PipeWire.
    // No tiene valor mostrarlo durante el arranque de la sesión.
    if (!micOsdReady || !micOsdEnabled.get()) {
        hideMicOSD()
        return
    }
    setMicOsdVisible(true)
    if (micOsdTimeout) {
        clearTimeout(micOsdTimeout)
    }
    micOsdTimeout = setTimeout(() => {
        setMicOsdVisible(false)
        micOsdTimeout = null
    }, 2000)
}

micOsdEnabled.subscribe(() => {
    if (!micOsdEnabled.get()) hideMicOSD()
})

function getMicOsdIcon(v: number, muted: boolean) {
    if (muted || v === 0) return "󰍭" // Muted mic icon
    return "󰍬" // Unmuted mic icon
}

export default function MicOSD(gdkmonitor: Gdk.Monitor) {
    const wp = AstalWp.get_default()
    const audio = wp?.audio
    let microphone: AstalWp.Endpoint | null = audio?.defaultMicrophone ?? null

    const [icon, setIcon] = createState(microphone ? getMicOsdIcon(microphone.volume, microphone.mute) : "󰍭")
    const [vol, setVol] = createState(microphone?.volume ?? 0)
    const [percent, setPercent] = createState(microphone ? `${Math.round(microphone.volume * 100)}` : "—")
    const [muted, setMuted] = createState(microphone?.mute ?? true)

    const updateVars = () => {
        if (!microphone) {
            setIcon("󰍭")
            setVol(0)
            setPercent("—")
            setMuted(true)
            return
        }
        setIcon(getMicOsdIcon(microphone.volume, microphone.mute))
        setVol(microphone.volume)
        setPercent(`${Math.round(microphone.volume * 100)}`)
        setMuted(microphone.mute || microphone.volume === 0)
    }

    let volumeId = 0
    let muteId = 0
    const bindMicrophone = (next: AstalWp.Endpoint | null) => {
        if (microphone && volumeId) microphone.disconnect(volumeId)
        if (microphone && muteId) microphone.disconnect(muteId)
        microphone = next
        volumeId = muteId = 0
        if (microphone) {
            volumeId = microphone.connect("notify::volume", () => {
                updateVars()
            })
            muteId = microphone.connect("notify::mute", () => {
                updateVars()
            })
        }
        updateVars()
    }
    bindMicrophone(microphone)
    audio?.connect("notify::default-microphone", () => bindMicrophone(audio.defaultMicrophone ?? null))

    return (
        <window
            name="mic-osd"
            visible={micOsdVisible}
            gdkmonitor={gdkmonitor}
            layer={Astal.Layer.OVERLAY}
            anchor={Astal.WindowAnchor.TOP}
            application={app}
            cssClasses={["osd-window"]}
            // Ver OSD.tsx: sin auto-ocultado la zona exclusiva del bar ya nos baja.
            marginTop={createComputed(() => barAutoHideEnabled() && barVisible() ? 46 : 8)}
        >
            <box orientation={Gtk.Orientation.HORIZONTAL} halign={Gtk.Align.CENTER}>
                <revealer
                    revealChild={osdVisible}
                    transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
                    transitionDuration={180}
                >
                    <box cssClasses={["osd-mic-spacer"]} />
                </revealer>
                <box
                    cssClasses={muted((isMuted) => [
                        "osd-container",
                        "osd-microphone",
                        isMuted ? "osd-muted" : "osd-active",
                    ])}
                orientation={Gtk.Orientation.HORIZONTAL}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.START}
                spacing={15}
            >
                <label 
                    cssClasses={["osd-icon"]} 
                    label={icon} 
                />
                <box cssClasses={["osd-progress-container"]} valign={Gtk.Align.CENTER} hexpand>
                    <Gtk.ProgressBar
                        cssClasses={["osd-progress"]}
                        fraction={vol}
                        valign={Gtk.Align.CENTER}
                        hexpand
                    />
                </box>
                <label 
                    cssClasses={["osd-percentage"]} 
                    label={percent} 
                />
                </box>
            </box>
        </window>
    )
}
