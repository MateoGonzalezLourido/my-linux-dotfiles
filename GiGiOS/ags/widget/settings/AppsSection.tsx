// widget/settings/AppsSection.tsx
// Sección "Apps" del panel de ajustes general (widget/SettingsPanel.tsx).
// Lista las apps que han aparecido alguna vez en segundo plano (el SystemTray) y
// deja decidir cuáles se muestran en el bar. Los datos viven en trayApps.ts.
import { Gtk } from "ags/gtk4"
import { For } from "ags"
import Interruptor from "../Interruptor"
import { EncabezadoAjuste, TextoInformativo, TituloSeccion } from "./componentes"
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
        <EncabezadoAjuste
          titulo={app.title}
          informacion={visible((v: boolean) => v ? "Se muestra en segundo plano" : "Oculta del bar")}
          halign={Gtk.Align.START}
        />
        {/* Olvidar: quita la app del registro (reaparecerá si vuelve a salir en el tray). */}
        <button cssClasses={["sp-rule-del"]} valign={Gtk.Align.CENTER} tooltipText="Olvidar esta app" onClicked={() => forgetTrayApp(app.id)}>
          <label label={"󰆴"} />
        </button>
        <Interruptor
          activo={visible}
          alAlternar={() => (visible.get() ? hideTrayApp(app.id) : showTrayApp(app.id))}
        />
      </box>
    </box>
  )
}

export default function AppsSection() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]} hexpand>
      <TituloSeccion titulo="Apps en segundo plano" />

      {/* umbral de agrupación: a partir de N iconos, todos se recogen en la flecha */}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
        <box spacing={8} valign={Gtk.Align.CENTER}>
          <EncabezadoAjuste
            titulo="Agrupar en un menú"
            informacion={"A partir de este número de iconos, todos se recogen en un menú\ndesplegable (la flecha) en vez de mostrarse sueltos en el bar."}
            halign={Gtk.Align.START}
            propiedadesInformacion={{ wrap: true, lines: 2, maxWidthChars: 62, xalign: 0 }}
          />
          <box spacing={6} valign={Gtk.Align.CENTER}>
            <button cssClasses={["sp-step-btn"]} onClicked={() => setTrayOverflowAt(trayOverflowAt.get() - 1)}><label label="−" /></button>
            <label cssClasses={["sp-step-val"]} label={trayOverflowAt((n: number) => `${n} apps`)} />
            <button cssClasses={["sp-step-btn"]} onClicked={() => setTrayOverflowAt(trayOverflowAt.get() + 1)}><label label="+" /></button>
          </box>
        </box>
      </box>

      {/* placeholder cuando el registro está vacío */}
      <TextoInformativo
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
