import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import AstalWp from "gi://AstalWp"
import { barVisible, osdVisible, setOsdVisible, micOsdVisible, brightness, brightnessOsdVisible } from "./state"

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
    if (v < 0.80) return ""
    return ""
}

function getBrightnessIcon(v: number) {
    if (v < 0.25) return "󰃞"
    if (v < 0.50) return "󰃝"
    if (v < 0.75) return "󰃟"
    return "󰃠"
}

export default function OSD(gdkmonitor: Gdk.Monitor) {
    const wp = AstalWp.get_default()
    const speaker = wp?.audio?.defaultSpeaker
    if (!speaker) return <window visible={false} />

    // Combined visibility: show for both volume and brightness changes
    const anyOsdVisible = {
        get: () => osdVisible.get() || brightnessOsdVisible.get(),
        subscribe: (cb: (v: boolean) => void) => {
            const notify = () => cb(osdVisible.get() || brightnessOsdVisible.get())
            osdVisible.subscribe(notify)
            brightnessOsdVisible.subscribe(notify)
        }
    }

    const [icon, setIcon] = createState(getOsdIcon(speaker.volume, speaker.mute))
    const [vol, setVol] = createState(speaker.volume)
    const [percent, setPercent] = createState(`${Math.round(speaker.volume * 100)}`)

    const updateVolumeVars = () => {
        setIcon(getOsdIcon(speaker.volume, speaker.mute))
        setVol(speaker.volume)
        setPercent(`${Math.round(speaker.volume * 100)}`)
    }

    const updateBrightnessVars = (v: number) => {
        setIcon(getBrightnessIcon(v))
        setVol(v)
        setPercent(`${Math.round(v * 100)}`)
    }

    speaker.connect("notify::volume", () => {
        updateVolumeVars()
        showOSD()
    })
    speaker.connect("notify::mute", () => {
        updateVolumeVars()
        showOSD()
    })

    // Switch to brightness mode when brightness OSD activates
    brightnessOsdVisible.subscribe((visible) => {
        if (visible) updateBrightnessVars(brightness.get())
    })
    // Keep brightness value fresh while OSD is visible
    brightness.subscribe((v) => {
        if (brightnessOsdVisible.get()) updateBrightnessVars(v)
    })
    // Switch back to volume mode when volume OSD activates
    osdVisible.subscribe((visible) => {
        if (visible) updateVolumeVars()
    })

    return (
        <window
            name="osd"
            visible={anyOsdVisible}
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
                    <box cssClasses={["osd-mic-spacer"]} />
                </revealer>
            </box>
        </window>
    )
}
