import { Gtk } from "ags/gtk4"
import type { Accessor } from "ags"
import { SECCIONES_NAVEGACION, type IdSeccion } from "./secciones.tsx"
import textos from "../../../textos/ajustes/general.json" with { type: "json" }

export default function NavegacionAjustes({
  seccion,
  seleccionar,
}: {
  seccion: Accessor<IdSeccion>
  seleccionar: (seccion: IdSeccion) => void
}) {
  return (
    <box cssClasses={["sp-nav"]} orientation={Gtk.Orientation.VERTICAL} spacing={4}>
      <label cssClasses={["sp-nav-title"]} label={textos.panel.titulo} halign={Gtk.Align.START} />
      <Gtk.ScrolledWindow
        cssClasses={["sp-nav-scroll"]}
        vexpand
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.NEVER}
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          {SECCIONES_NAVEGACION.map((destino) => (
            <button
              cssClasses={seccion((actual) =>
                actual === destino.id ? ["sp-nav-item", "active"] : ["sp-nav-item"])}
              onClicked={() => seleccionar(destino.id)}
              valign={Gtk.Align.CENTER}
              overflow={Gtk.Overflow.VISIBLE}
            >
              <box
                cssClasses={["sp-nav-content"]}
                spacing={10}
                valign={Gtk.Align.CENTER}
                heightRequest={24}
                overflow={Gtk.Overflow.VISIBLE}
              >
                <label
                  cssClasses={["sp-nav-icon"]}
                  label={destino.icon}
                  valign={Gtk.Align.CENTER}
                  heightRequest={22}
                  overflow={Gtk.Overflow.VISIBLE}
                />
                <label
                  cssClasses={["sp-nav-label"]}
                  label={destino.label}
                  hexpand
                  halign={Gtk.Align.START}
                  valign={Gtk.Align.CENTER}
                  heightRequest={22}
                  overflow={Gtk.Overflow.VISIBLE}
                />
              </box>
            </button>
          ))}
        </box>
      </Gtk.ScrolledWindow>
    </box>
  )
}
