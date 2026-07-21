import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { execAsync } from "ags/process"
import { powerMenuVisible, closeAllPanels, panelAutoClose } from "../../estado/shell"
import BotonAccionEnergia from "./componentes/BotonAccionEnergia"
import { ACCIONES_ENERGIA } from "./componentes/accionesEnergia"
import { crearCicloVida } from "../../utilidades/cicloVida"

export default function PowerOptions(gdkmonitor: Gdk.Monitor) {
    const cicloVida = crearCicloVida()
    const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
    const autoCierre = panelAutoClose(closeAllPanels, 300, powerMenuVisible)
    const [tecladoActivo, establecerTecladoActivo] = createState(false)

    cicloVida.suscribir(powerMenuVisible, () => establecerTecladoActivo(false))

    const manejarEntradaPuntero = () => {
        autoCierre.onEnter()
        establecerTecladoActivo(true)
    }

    const ejecutarAccion = (comando: string) => {
        execAsync(comando)
            .catch(error => console.error(`Error en acción de energía: ${error}`))
        closeAllPanels()
    }

    const panel = (
        <box
            cssClasses={["power-menu-container"]}
            orientation={Gtk.Orientation.VERTICAL}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
        >
            <Gtk.EventControllerMotion
                onEnter={manejarEntradaPuntero}
                onLeave={autoCierre.onLeave}
            />
            <box
                cssClasses={["power-menu-strip"]}
                spacing={0}
                valign={Gtk.Align.CENTER}
            >
                {ACCIONES_ENERGIA.map((accion) => (
                    <BotonAccionEnergia accion={accion} ejecutar={ejecutarAccion} />
                ))}
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
            keymode={tecladoActivo((activo) =>
                activo ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
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
