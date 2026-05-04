import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { createState } from "ags"
import { anyPanelVisible, setAnyPanelVisible } from "../state"

export default function PowerOptions(gdkmonitor: Gdk.Monitor) {
    const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
    const [hovered, setHovered] = createState<string | null>(null)

    const handleAction = (command: string) => {
        execAsync(command)
            .catch(err => console.error(`Power Action Error: ${err}`))
        setAnyPanelVisible(false)
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
            <box orientation={Gtk.Orientation.VERTICAL} spacing={10} halign={Gtk.Align.CENTER} hexpand>
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

    anyPanelVisible.subscribe((v) => {
        if (v) setHovered(null)
    })

    return (
        <window
            name="power-menu"
            visible={anyPanelVisible}
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
                    setAnyPanelVisible(false)
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
                    onPressed={(self, n, x, y) => {
                        const widget = self.get_widget()
                        const target = widget.pick(x, y, Gtk.PickFlags.DEFAULT)
                        if (target === widget || target?.get_css_classes().includes("power-menu-overlay")) {
                            setAnyPanelVisible(false)
                        }
                    }}
                />
                <box
                    cssClasses={["power-menu-container"]}
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.CENTER}
                    hexpand
                    vexpand
                >

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
