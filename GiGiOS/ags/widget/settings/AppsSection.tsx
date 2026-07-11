// widget/settings/AppsSection.tsx
// Sección "Apps" del panel de ajustes general (widget/SettingsPanel.tsx).
// Lista las apps que han aparecido alguna vez en segundo plano (el SystemTray) y
// deja decidir cuáles se muestran en el bar. Los datos viven en trayApps.ts.
import { Gtk } from "ags/gtk4"
import { For } from "ags"
import {
  knownTrayApps, hiddenTrayApps, trayOverflowAt,
  hideTrayApp, showTrayApp, forgetTrayApp, setTrayOverflowAt,
  type TrayAppInfo,
} from "./trayApps"

function AppRow(app: TrayAppInfo) {
  const visible = hiddenTrayApps((h: string[]) => !h.includes(app.id))
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
      <box spacing={10} valign={Gtk.Align.CENTER}>
        {app.iconName ? <image iconName={app.iconName} pixelSize={22} /> : <label cssClasses={["sp-nav-icon"]} label={"󰀻"} />}
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
          <label cssClasses={["sp-field-label"]} label={app.title} halign={Gtk.Align.START} />
          <label cssClasses={["sp-field-hint"]} label={visible((v: boolean) => v ? "Se muestra en segundo plano" : "Oculta del bar")} halign={Gtk.Align.START} />
        </box>
        {/* Olvidar: quita la app del registro (reaparecerá si vuelve a salir en el tray). */}
        <button cssClasses={["sp-rule-del"]} valign={Gtk.Align.CENTER} tooltipText="Olvidar esta app" onClicked={() => forgetTrayApp(app.id)}>
          <label label={"󰆴"} />
        </button>
        <button
          cssClasses={visible((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
          valign={Gtk.Align.CENTER}
          onClicked={() => (visible.get() ? hideTrayApp(app.id) : showTrayApp(app.id))}
        >
          <box cssClasses={["qs-toggle-track"]}>
            <box cssClasses={visible((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
          </box>
        </button>
      </box>
    </box>
  )
}

export default function AppsSection() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]} hexpand>
      <label cssClasses={["sp-section-title"]} label="✦ Apps en segundo plano" halign={Gtk.Align.START} />
      <label
        cssClasses={["sp-field-hint"]}
        label={"Estas apps ponen un icono en el bar mientras corren en segundo plano.\nDesactiva las que no quieras ver."}
        halign={Gtk.Align.START}
        wrap={true}
        lines={2}
        maxWidthChars={62}
        xalign={0}
      />

      {/* umbral de agrupación: a partir de N iconos, todos se recogen en la flecha */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
            <label cssClasses={["sp-field-label"]} label="Agrupar en un menú" halign={Gtk.Align.START} />
            <label
              cssClasses={["sp-field-hint"]}
              label={"A partir de este número de iconos, todos se recogen en un menú\ndesplegable (la flecha) en vez de mostrarse sueltos en el bar."}
              halign={Gtk.Align.START}
              wrap={true}
              lines={2}
              maxWidthChars={62}
              xalign={0}
            />
          </box>
          <box spacing={6} valign={Gtk.Align.CENTER}>
            <button cssClasses={["sp-step-btn"]} onClicked={() => setTrayOverflowAt(trayOverflowAt.get() - 1)}><label label="−" /></button>
            <label cssClasses={["sp-step-val"]} label={trayOverflowAt((n: number) => `${n} apps`)} />
            <button cssClasses={["sp-step-btn"]} onClicked={() => setTrayOverflowAt(trayOverflowAt.get() + 1)}><label label="+" /></button>
          </box>
        </box>
      </box>

      {/* placeholder cuando el registro está vacío */}
      <label
        cssClasses={["sp-field-hint"]}
        label="Aún no ha aparecido ninguna app en segundo plano."
        halign={Gtk.Align.START}
        visible={knownTrayApps((k: TrayAppInfo[]) => k.length === 0)}
      />

      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} hexpand>
        <For each={knownTrayApps}>{(app: TrayAppInfo) => AppRow(app)}</For>
      </box>
    </box>
  )
}
