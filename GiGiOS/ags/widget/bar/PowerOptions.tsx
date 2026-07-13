import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { execAsync } from "ags/process"
import { powerMenuVisible, closeAllPanels, panelAutoClose } from "../state"

export default function PowerOptions(gdkmonitor: Gdk.Monitor) {
    const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
    const autoClose = panelAutoClose(closeAllPanels, 300, powerMenuVisible)
    const [keyboardActive, setKeyboardActive] = createState(false)

    powerMenuVisible.subscribe(() => setKeyboardActive(false))

    const handlePointerEnter = () => {
        autoClose.onEnter()
        setKeyboardActive(true)
    }

    const handleAction = (command: string) => {
        execAsync(command)
            .catch(err => console.error(`Power Action Error: ${err}`))
        closeAllPanels()
    }

    const PowerButtonAction = ({ id, icon, label, command }: { id: string, icon: string, label: string, command: string }) => (
        <button
            cssClasses={["power-button", id]}
            onClicked={() => handleAction(command)}
            focusable={false}
        >
            <box
                cssClasses={["power-button-content"]}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                hexpand
                vexpand
            >
                <box
                    cssClasses={["power-icon-frame"]}
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.CENTER}
                    widthRequest={56}
                    heightRequest={56}
                >
                    <label
                        cssClasses={["power-icon"]}
                        label={icon}
                        halign={Gtk.Align.CENTER}
                        valign={Gtk.Align.CENTER}
                        xalign={0.5}
                        yalign={0.5}
                        justify={Gtk.Justification.CENTER}
                        widthRequest={56}
                        heightRequest={56}
                        hexpand
                        vexpand
                    />
                </box>
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

    const panel = (
        <box
            cssClasses={["power-menu-container"]}
            orientation={Gtk.Orientation.VERTICAL}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
        >
            <Gtk.EventControllerMotion
                onEnter={handlePointerEnter}
                onLeave={autoClose.onLeave}
            />
            <box
                cssClasses={["power-menu-strip"]}
                spacing={0}
                valign={Gtk.Align.CENTER}
            >
                <PowerButtonAction id="lock" icon="󰌾" label="Bloquear" command="hyprlock" />
                <PowerButtonAction id="logout" icon="󰍃" label="Salir" command="hyprctl dispatch exit" />
                <PowerButtonAction id="suspend" icon="󰏤" label="Suspender" command="systemctl suspend" />
                <PowerButtonAction id="shutdown" icon="󰐥" label="Apagar" command="systemctl poweroff" />
                <PowerButtonAction id="hibernate" icon="󰒲" label="Hibernar" command="systemctl hibernate" />
                <PowerButtonAction id="reboot" icon="󰜉" label="Reiniciar" command="systemctl reboot" />
            </box>
        </box>
    ) as unknown as Gtk.Widget

    return (
        <window
            name="power-menu"
            visible={powerMenuVisible}
            gdkmonitor={gdkmonitor}
            layer={Astal.Layer.OVERLAY}
            anchor={TOP | BOTTOM | LEFT | RIGHT}
            exclusivity={Astal.Exclusivity.IGNORE}
            keymode={keyboardActive((active) =>
                active ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
            application={app}
            cssClasses={["power-window"]}
        >
            <Gtk.EventControllerKey
                onKeyPressed={(_self, keyval) => {
                    if (keyval === Gdk.KEY_Escape) { closeAllPanels(); return true }
                    return false
                }}
            />
            <box cssClasses={["power-menu-overlay"]} hexpand vexpand>
                <Gtk.GestureClick
                    onPressed={(self: Gtk.GestureClick, _n: number, x: number, y: number) => {
                        const backdrop = self.get_widget() as Gtk.Widget
                        const hit = backdrop.pick(x, y, 0)
                        let w: Gtk.Widget | null = hit
                        while (w && w !== backdrop) {
                            if (w === panel) return
                            w = w.get_parent()
                        }
                        closeAllPanels()
                    }}
                />
                {panel as unknown as any}
            </box>
        </window>
    )
}
