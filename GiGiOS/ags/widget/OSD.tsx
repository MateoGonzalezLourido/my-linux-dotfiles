import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createComputed, createState } from "ags"
import AstalWp from "gi://AstalWp"
import {
    barVisible, osdVisible, setOsdVisible, micOsdVisible,
    brightness, brightnessOsdVisible,
} from "./state"
import { barAutoHideEnabled, volumeOsdEnabled } from "./settings/preferences"

let osdTimeout: number | null = null

function hideOSD() {
    setOsdVisible(false)
    if (osdTimeout) clearTimeout(osdTimeout)
    osdTimeout = null
}

export function showOSD(startup = false) {
    if (!volumeOsdEnabled.get()) {
        hideOSD()
        return
    }
    const speaker = AstalWp.get_default()?.audio?.defaultSpeaker
    if (!speaker || (startup && (speaker.mute || speaker.volume <= 0))) {
        hideOSD()
        return
    }
    setOsdVisible(true)
    if (osdTimeout) {
        clearTimeout(osdTimeout)
    }
    osdTimeout = setTimeout(() => {
        setOsdVisible(false)
        osdTimeout = null
    }, 2000)
}

volumeOsdEnabled.subscribe(() => {
    if (!volumeOsdEnabled.get()) hideOSD()
})

function getOsdIcon(v: number, muted: boolean) {
    if (muted || v === 0) return "󰝟"
    if (v < 0.20) return "󰕿"
    if (v < 0.40) return "󰖀"
    if (v < 0.60) return "󰕾"
    return "󰕾"
}

function getBrightnessIcon(v: number) {
    if (v < 0.25) return "󰃞"
    if (v < 0.50) return "󰃝"
    if (v < 0.75) return "󰃟"
    return "󰃠"
}

export default function OSD(gdkmonitor: Gdk.Monitor) {
    const wp = AstalWp.get_default()
    const audio = wp?.audio
    let speaker: AstalWp.Endpoint | null = audio?.defaultSpeaker ?? null

    const anyOsdVisible = createComputed(() => osdVisible() || brightnessOsdVisible())

    const [icon, setIcon] = createState(speaker ? getOsdIcon(speaker.volume, speaker.mute) : "󰝟")
    const [vol, setVol] = createState(speaker?.volume ?? 0)
    const [percent, setPercent] = createState(speaker ? `${Math.round(speaker.volume * 100)}` : "—")
    const [appearance, setAppearance] = createState<"volume" | "muted" | "brightness">(
        speaker?.mute ? "muted" : "volume",
    )

    const updateVolumeVars = () => {
        if (!speaker) {
            setIcon("󰝟")
            setVol(0)
            setPercent("—")
            setAppearance("muted")
            return
        }
        setIcon(getOsdIcon(speaker.volume, speaker.mute))
        setVol(speaker.volume)
        setPercent(`${Math.round(speaker.volume * 100)}`)
        setAppearance(speaker.mute || speaker.volume === 0 ? "muted" : "volume")
    }

    const updateBrightnessVars = (v: number) => {
        const value = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
        setIcon(getBrightnessIcon(value))
        setVol(value)
        setPercent(`${Math.round(value * 100)}`)
        setAppearance("brightness")
    }

    let volumeId = 0
    let muteId = 0
    const bindSpeaker = (next: AstalWp.Endpoint | null) => {
        if (speaker && volumeId) speaker.disconnect(volumeId)
        if (speaker && muteId) speaker.disconnect(muteId)
        speaker = next
        volumeId = muteId = 0
        if (speaker) {
            volumeId = speaker.connect("notify::volume", () => {
                updateVolumeVars()
            })
            muteId = speaker.connect("notify::mute", () => {
                updateVolumeVars()
            })
        }
        updateVolumeVars()
    }
    bindSpeaker(speaker)
    audio?.connect("notify::default-speaker", () => bindSpeaker(audio.defaultSpeaker ?? null))

    // Switch to brightness mode when brightness OSD activates
    brightnessOsdVisible.subscribe(() => {
        if (brightnessOsdVisible.get()) updateBrightnessVars(brightness.get())
    })
    // Keep brightness value fresh while OSD is visible
    brightness.subscribe(() => {
        if (brightnessOsdVisible.get()) updateBrightnessVars(brightness.get())
    })
    // Switch back to volume mode when volume OSD activates
    osdVisible.subscribe(() => {
        if (osdVisible.get()) updateVolumeVars()
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
            // Sin auto-ocultado el bar ya tiene zona exclusiva: el compositor nos
            // baja sus 38px, así que solo hace falta el hueco de 8.
            marginTop={createComputed(() => barAutoHideEnabled() && barVisible() ? 46 : 8)}
        >
            <box orientation={Gtk.Orientation.HORIZONTAL} halign={Gtk.Align.CENTER}>
                <box
                    cssClasses={appearance((kind) => ["osd-container", `osd-${kind}`])}
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
                    transitionDuration={180}
                >
                    <box cssClasses={["osd-mic-spacer"]} />
                </revealer>
            </box>
        </window>
    )
}
