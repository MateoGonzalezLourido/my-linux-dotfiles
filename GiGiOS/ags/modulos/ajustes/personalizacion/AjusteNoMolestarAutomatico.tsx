// modulos/ajustes/personalizacion/AjusteNoMolestarAutomatico.tsx
// Bloque "No molestar automático" de Notificaciones > General.
// Un toggle maestro + una lista editable de clases de ventana que, al ponerse en
// pantalla completa, también activan el No molestar (además de los juegos).
// La lógica vive en modulos/notificaciones/autoDnd/; aquí sólo persiste preferencias.
import { For } from "ags"
import { Gtk } from "ags/gtk4"
import AstalHyprland from "gi://AstalHyprland"
import Interruptor from "../../../componentes/Interruptor"
import { EncabezadoAjuste, TextoInformativo, TituloSubseccion } from "../componentes"
import textos from "../../../textos/ajustes/personalizacion.json" with { type: "json" }
import {
  autoDndEnabled, setAutoDndEnabled,
  autoDndFullscreenApps, addAutoDndApp, removeAutoDndApp,
} from "../preferences"

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
        tooltipText={textos.noMolestar.lista.quitar}
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
        <EncabezadoAjuste
          titulo={textos.noMolestar.titulo}
          informacion={textos.noMolestar.descripcion}
          halign={Gtk.Align.START}
          propiedadesInformacion={{ wrap: true, lines: 2, maxWidthChars: 62, xalign: 0 }}
        />
        <Interruptor
          activo={autoDndEnabled}
          alAlternar={() => setAutoDndEnabled(!autoDndEnabled.get())}
        />
      </box>

      {/* Lista de apps que silencian en pantalla completa (sólo si está activo) */}
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={6}
        cssClasses={["adnd-apps"]}
        visible={autoDndEnabled((v: boolean) => v)}
      >
        <TituloSubseccion
          label={textos.noMolestar.lista.titulo}
          halign={Gtk.Align.START}
        />

        <TextoInformativo
          label={textos.noMolestar.lista.ayuda}
          halign={Gtk.Align.START}
        />

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <For each={autoDndFullscreenApps}>
            {(app: string) => <AppRow app={app} />}
          </For>
        </box>

        <TextoInformativo
          label={textos.noMolestar.lista.vacia}
          halign={Gtk.Align.START}
          visible={autoDndFullscreenApps((a: string[]) => a.length === 0)}
        />

        {/* Añadir por clase o desde la ventana actual */}
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <entry
            cssClasses={["sp-num-input", "adnd-entry"]}
            hexpand
            xalign={0}
            placeholderText={textos.noMolestar.lista.placeholder}
            $={(self: Gtk.Entry) => { entryRef = self }}
            onActivate={addTyped}
          />
          <button cssClasses={["sp-add-rule"]} onClicked={addTyped} valign={Gtk.Align.CENTER}>
            <label label={textos.noMolestar.lista.anadir} />
          </button>
          <button
            cssClasses={["sp-add-rule"]}
            onClicked={addFocused}
            valign={Gtk.Align.CENTER}
            tooltipText={textos.noMolestar.lista.anadirVentana}
          >
            <label label={`󰊓 ${textos.noMolestar.lista.ventana}`} />
          </button>
        </box>
      </box>
    </box>
  )
}
