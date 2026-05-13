import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import AstalWp from "gi://AstalWp"
import { barVisible, osdVisible, setOsdVisible, micOsdVisible } from "./state"

let osdTimeout: number | null = null

export function showOSD() {
    setOsdVisible(true)
    if (osdTimeout) {
        clearTimeout(osdTimeout)
    }
    osdTimeout = setTimeout(() => {
        setOsdVisible(false)
        osdTimeout = null
    }, 2000)
}

function getOsdIcon(v: number, muted: boolean) {
    if (muted || v === 0) return "󰝟"
    if (v < 0.20) return "󰕿"
    if (v < 0.40) return "󰖀"
    if (v < 0.60) return "󰕾"
    if (v < 0.80) return ""
    return "" // Max volume
}

export default function OSD(gdkmonitor: Gdk.Monitor) {
    const wp = AstalWp.get_default()
    const speaker = wp?.audio?.defaultSpeaker
    if (!speaker) return <window visible={false} />

    const [icon, setIcon] = createState(getOsdIcon(speaker.volume, speaker.mute))
    const [vol, setVol] = createState(speaker.volume)
    const [percent, setPercent] = createState(`${Math.round(speaker.volume * 100)}`)

    const updateVars = () => {
        setIcon(getOsdIcon(speaker.volume, speaker.mute))
        setVol(speaker.volume)
        setPercent(`${Math.round(speaker.volume * 100)}`)
    }

    speaker.connect("notify::volume", () => {
        updateVars()
        showOSD()
    })
    speaker.connect("notify::mute", () => {
        updateVars()
        showOSD()
    })

    return (
        <window
            name="osd"
            visible={osdVisible}
            gdkmonitor={gdkmonitor}
            layer={Astal.Layer.OVERLAY}
            anchor={Astal.WindowAnchor.TOP}
            application={app}
            cssClasses={["osd-window"]}
            marginTop={barVisible((v) => v ? 60 : 15)}
        >
            <box orientation={Gtk.Orientation.HORIZONTAL} halign={Gtk.Align.CENTER}>
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
                <revealer
                    revealChild={micOsdVisible}
                    transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
                    transitionDuration={300}
                >
                    <box css="min-width: 220px;" />
                </revealer>
            </box>
        </window>
    )
}
