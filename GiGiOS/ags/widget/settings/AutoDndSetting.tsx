// widget/settings/AutoDndSetting.tsx
// Bloque "No molestar automático" de la sección Personalización.
// Un toggle maestro + una lista editable de clases de ventana que, al ponerse en
// pantalla completa, también activan el No molestar (además de los juegos).
// La lógica vive en widget/notifications/autoDnd/; aquí sólo persiste preferencias.
import { For } from "ags"
import { Gtk } from "ags/gtk4"
import AstalHyprland from "gi://AstalHyprland"
import {
  autoDndEnabled, setAutoDndEnabled,
  autoDndFullscreenApps, addAutoDndApp, removeAutoDndApp,
} from "./preferences"

// Fila de una app configurada: la clase + botón de borrar.
function AppRow({ app }: { app: string }) {
  return (
    <box spacing={5} valign={Gtk.Align.CENTER} cssClasses={["sp-rule-row"]}>
      <label cssClasses={["adnd-app-name"]} label={app} halign={Gtk.Align.START} ellipsize={3} />
      <box hexpand />
      <button
        cssClasses={["sp-rule-del"]}
        onClicked={() => removeAutoDndApp(app)}
        valign={Gtk.Align.CENTER}
        tooltipText="Quitar de la lista"
      >
        <label label="󰅖" />
      </button>
    </box>
  )
}

export default function AutoDndSetting() {
  let entryRef: Gtk.Entry

  const addTyped = () => {
    if (!entryRef) return
    const v = entryRef.get_text().trim()
    if (!v) return
    addAutoDndApp(v)
    entryRef.set_text("")
  }

  // Añade la app que esté ahora mismo en pantalla completa; si ninguna lo está,
  // cae en la ventana enfocada. Así no hay que buscar la clase a mano con hyprctl.
  const addFocused = () => {
    const hypr = AstalHyprland.get_default()
    const clients = hypr.get_clients?.() ?? []
    const fs = clients.find((c: any) => (c.fullscreen ?? 0) !== 0)
    const target = fs ?? hypr.focusedClient
    const cls = (target?.class ?? "").trim()
    if (cls) addAutoDndApp(cls)
  }

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8} cssClasses={["sp-field"]} hexpand>
      {/* Toggle maestro */}
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
          <label cssClasses={["sp-field-label"]} label="No molestar automático" halign={Gtk.Align.START} />
          <label
            cssClasses={["sp-field-hint"]}
            label={"Silencia los popups mientras juegas o con una app en pantalla completa.\nLas notificaciones se siguen guardando en el historial."}
            halign={Gtk.Align.START}
            wrap={true}
            lines={2}
            maxWidthChars={62}
            xalign={0}
          />
        </box>
        <button
          cssClasses={autoDndEnabled((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
          valign={Gtk.Align.CENTER}
          onClicked={() => setAutoDndEnabled(!autoDndEnabled.get())}
        >
          <box cssClasses={["qs-toggle-track"]}>
            <box cssClasses={autoDndEnabled((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
          </box>
        </button>
      </box>

      {/* Lista de apps que silencian en pantalla completa (sólo si está activo) */}
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={6}
        cssClasses={["adnd-apps"]}
        visible={autoDndEnabled((v: boolean) => v)}
      >
        <label
          cssClasses={["sp-subsection-title"]}
          label="Apps que silencian en pantalla completa"
          halign={Gtk.Align.START}
        />

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <For each={autoDndFullscreenApps}>
            {(app: string) => <AppRow app={app} />}
          </For>
        </box>

        <label
          cssClasses={["sp-field-hint"]}
          label="Sin apps: sólo los juegos activan el No molestar."
          halign={Gtk.Align.START}
          visible={autoDndFullscreenApps((a: string[]) => a.length === 0)}
        />

        {/* Añadir por clase o desde la ventana actual */}
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <entry
            cssClasses={["sp-num-input", "adnd-entry"]}
            hexpand
            placeholderText="clase de la ventana (p. ej. mpv)"
            $={(self: Gtk.Entry) => { entryRef = self }}
            onActivate={addTyped}
          />
          <button cssClasses={["sp-add-rule"]} onClicked={addTyped} valign={Gtk.Align.CENTER}>
            <label label="Añadir" />
          </button>
          <button
            cssClasses={["sp-add-rule"]}
            onClicked={addFocused}
            valign={Gtk.Align.CENTER}
            tooltipText="Añade la app en pantalla completa (o la ventana enfocada)"
          >
            <label label="󰊓 Ventana" />
          </button>
        </box>
      </box>
    </box>
  )
}
