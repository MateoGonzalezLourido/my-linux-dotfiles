import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { createState } from "ags"
import { powerMenuVisible, closeAllPanels } from "../state"

export default function PowerOptions(gdkmonitor: Gdk.Monitor) {
    const { TOP, RIGHT } = Astal.WindowAnchor
    const [hovered, setHovered] = createState<string | null>(null)
    let hoverTimeout: number | null = null

    const clearTimer = () => {
        if (hoverTimeout !== null) {
            GLib.source_remove(hoverTimeout)
            hoverTimeout = null
        }
    }

    const startTimer = () => {
        clearTimer()
        hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            closeAllPanels()
            hoverTimeout = null
            return GLib.SOURCE_REMOVE
        })
    }

    const handleAction = (command: string) => {
        execAsync(command)
            .catch(err => console.error(`Power Action Error: ${err}`))
        closeAllPanels()
    }

    const PowerButtonAction = ({ id, icon, label, command }: { id: string, icon: string, label: string, command: string }) => (
        <button
            cssClasses={hovered((h) => ["power-button", id, h === id ? "highlighted" : ""])}
            onClicked={() => handleAction(command)}
            focusable={false}
        >
            <Gtk.EventControllerMotion
                onEnter={() => setHovered(id)}
                onLeave={() => setHovered(null)}
            />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={6} halign={Gtk.Align.CENTER} hexpand>
                <label
                    cssClasses={["power-icon"]}
                    label={icon}
                    halign={Gtk.Align.CENTER}
                    xalign={0.5}
                    hexpand
                />
                <label
                    cssClasses={["power-label"]}
                    label={label}
                    halign={Gtk.Align.CENTER}
                    xalign={0.5}
                    hexpand
                />
            </box>
        </button>
    )

    powerMenuVisible.subscribe((v) => {
        if (!v) setHovered(null)
    })

    return (
        <window
            name="power-menu"
            visible={powerMenuVisible}
            gdkmonitor={gdkmonitor}
            layer={Astal.Layer.TOP}
            exclusivity={Astal.Exclusivity.NORMAL}
            keymode={Astal.Keymode.ON_DEMAND}
            anchor={TOP | RIGHT}
            application={app}
            marginTop={48}
            marginRight={8}
            cssClasses={["power-window"]}
        >
            <Gtk.EventControllerKey
                onKeyPressed={(_self, keyval) => {
                    if (keyval === Gdk.KEY_Escape) { closeAllPanels(); return true }
                    return false
                }}
            />
            <box
                cssClasses={["power-menu-container"]}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <Gtk.EventControllerMotion
                    onEnter={clearTimer}
                    onLeave={startTimer}
                />
                <box
                    cssClasses={["power-menu-strip"]}
                    spacing={0}
                    valign={Gtk.Align.CENTER}
                >
                    <PowerButtonAction id="lock" icon="󰌾" label="Lock" command="hyprlock" />
                    <PowerButtonAction id="logout" icon="󰍃" label="Logout" command="hyprctl dispatch exit" />
                    <PowerButtonAction id="suspend" icon="󰏤" label="Suspend" command="systemctl suspend" />
                    <PowerButtonAction id="shutdown" icon="󰐥" label="Shutdown" command="systemctl poweroff" />
                    <PowerButtonAction id="hibernate" icon="󰒲" label="Hibernate" command="systemctl hibernate" />
                    <PowerButtonAction id="reboot" icon="󰜉" label="Reboot" command="systemctl reboot" />
                </box>
            </box>
        </window>
    )
}

