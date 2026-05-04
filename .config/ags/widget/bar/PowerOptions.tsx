import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { createState } from "ags"
import { powerMenuVisible, setPowerMenuVisible } from "../state"

export default function PowerOptions(gdkmonitor: Gdk.Monitor) {
    const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
    const [hovered, setHovered] = createState<string | null>(null)

    const handleAction = (command: string) => {
        setPowerMenuVisible(false)
        execAsync(command)
    }

    const PowerButtonAction = ({ id, icon, label, command, highlightedClass = "" }: { id: string, icon: string, label: string, command: string, highlightedClass?: string }) => (
        <button
            cssClasses={hovered((h) => ["power-button", id, h === id ? "highlighted" : ""])}
            onClicked={() => handleAction(command)}
            focusable={false}
        >
            <Gtk.EventControllerMotion
                onEnter={() => setHovered(id)}
                onLeave={() => setHovered(null)}
            />
            <box orientation={Gtk.Orientation.VERTICAL} spacing={15} halign={Gtk.Align.CENTER} hexpand>
                <label cssClasses={["power-icon"]} label={icon} xalign={0.5} />
                <label cssClasses={["power-label"]} label={label} xalign={0.5} />
            </box>
        </button>
    )

    powerMenuVisible.subscribe((v) => {
        if (v) setHovered(null)
    })

    return (
        <window
            name="power-menu"
            visible={powerMenuVisible}
            gdkmonitor={gdkmonitor}
            layer={Astal.Layer.OVERLAY}
            exclusivity={Astal.Exclusivity.IGNORE}
            keymode={Astal.Keymode.EXCLUSIVE}
            anchor={TOP | BOTTOM | LEFT | RIGHT}
            application={app}
            css="background-color: transparent;"
        >
            <Gtk.EventControllerKey
                onKeyPressed={(self, keyval, keycode, state) => {
                    setPowerMenuVisible(false)
                    return true
                }}
            />
            <box
                cssClasses={["power-menu-overlay"]}
                hexpand
                vexpand
                halign={Gtk.Align.FILL}
                valign={Gtk.Align.FILL}
            >
                <Gtk.GestureClick
                    onPressed={() => setPowerMenuVisible(false)}
                />
                <box
                    cssClasses={["power-menu-container"]}
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.CENTER}
                    hexpand
                    vexpand
                >
                    <Gtk.GestureClick
                        onPressed={() => {}} // Stop propagation
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
            </box>
        </window>
    )
}
