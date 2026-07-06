import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import AstalWp from "gi://AstalWp"
import { barVisible, osdVisible, micOsdVisible, setMicOsdVisible } from "./state"

let micOsdTimeout: number | null = null

export function showMicOSD() {
    setMicOsdVisible(true)
    if (micOsdTimeout) {
        clearTimeout(micOsdTimeout)
    }
    micOsdTimeout = setTimeout(() => {
        setMicOsdVisible(false)
        micOsdTimeout = null
    }, 2000)
}

function getMicOsdIcon(v: number, muted: boolean) {
    if (muted || v === 0) return "󰍭" // Muted mic icon
    return "󰍬" // Unmuted mic icon
}

export default function MicOSD(gdkmonitor: Gdk.Monitor) {
    const wp = AstalWp.get_default()
    const microphone = wp?.audio?.defaultMicrophone
    if (!microphone) return <window visible={false} />

    const [icon, setIcon] = createState(getMicOsdIcon(microphone.volume, microphone.mute))
    const [vol, setVol] = createState(microphone.volume)
    const [percent, setPercent] = createState(`${Math.round(microphone.volume * 100)}`)

    const updateVars = () => {
        setIcon(getMicOsdIcon(microphone.volume, microphone.mute))
        setVol(microphone.volume)
        setPercent(`${Math.round(microphone.volume * 100)}`)
    }

    microphone.connect("notify::volume", () => {
        updateVars()
        showMicOSD()
    })
    microphone.connect("notify::mute", () => {
        updateVars()
        showMicOSD()
    })

    return (
        <window
            name="mic-osd"
            visible={micOsdVisible}
            gdkmonitor={gdkmonitor}
            layer={Astal.Layer.OVERLAY}
            anchor={Astal.WindowAnchor.TOP}
            application={app}
            cssClasses={["osd-window"]}
            marginTop={barVisible((v) => v ? 60 : 15)}
        >
            <box orientation={Gtk.Orientation.HORIZONTAL} halign={Gtk.Align.CENTER}>
                <revealer
                    revealChild={osdVisible}
                    transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
                    transitionDuration={300}
                >
                    <box css="min-width: 220px;" />
                </revealer>
                <box
                    cssClasses={["osd-container"]}
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
