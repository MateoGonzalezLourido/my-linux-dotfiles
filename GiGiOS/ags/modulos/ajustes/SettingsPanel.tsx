// modulos/ajustes/SettingsPanel.tsx
// Ventana general abierta desde el engranaje de ajustes rápidos. Mantiene el
// fondo a pantalla completa y el panel centrado, con navegación a la izquierda.
// El contenido va en un <With> sobre `vistaActiva` (sección, o null si el panel está
// cerrado): se construye al ABRIR y se desmonta al cerrar, así que con Ajustes cerrado no
// queda ni un timer ni una suscripción viva. La nav lateral es estática y vive con la
// ventana. Ojo: tiene que ser UN solo <With>, no dos anidados — ver la nota junto a él.
import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { With, createState, createComputed } from "ags"
import { settingsPanelVisible, setSettingsPanelVisible, privilegedPromptActive } from "../../estado/shell"
import NavegacionAjustes from "./panel/NavegacionAjustes.tsx"
import { crearContenidoSeccion, type IdSeccion } from "./panel/secciones.tsx"
import { clasesFondoShell } from "./preferences"

export default function SettingsPanel(gdkmonitor: Gdk.Monitor) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  const [seccion, establecerSeccion] = createState<IdSeccion>("account")
  // null = panel cerrado → no se construye ninguna sección. La sección elegida se
  // conserva en `seccion` entre aperturas; lo que se tira es el árbol de widgets.
  const vistaActiva = createComputed(() => settingsPanelVisible() ? seccion() : null)
  let contenidoDesplazable: Gtk.ScrolledWindow

  const panel = (
    <box cssClasses={["sp-panel"]} orientation={Gtk.Orientation.HORIZONTAL} spacing={0} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
      <NavegacionAjustes
        seccion={seccion}
        seleccionar={(destino) => {
          establecerSeccion(destino)
          contenidoDesplazable?.get_vadjustment().set_value(0)
        }}
      />

      {/* content (scrollable: algunas secciones —Pantalla— son más altas que el panel) */}
      <Gtk.ScrolledWindow
        cssClasses={["sp-content"]}
        $={(self: Gtk.ScrolledWindow) => { contenidoDesplazable = self }}
        hexpand
        vexpand
        heightRequest={700}
        propagateNaturalHeight={false}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.EXTERNAL}
      >
        <box orientation={Gtk.Orientation.VERTICAL} hexpand>
          {/* UN SOLO <With>, sobre `vistaActiva` (= sección, o null con el panel cerrado).
              Gatea por VISIBILIDAD, no solo por sección: sin eso la sección por defecto
              (Cuenta) se construía al arrancar el shell —una vez por monitor— y seguía
              montada toda la sesión sin haber abierto Ajustes nunca, porque `panel` se
              evalúa en el cuerpo de la función que app.ts invoca con .map() al arrancar y
              <With> renderiza con `immediate: true`. Cerrar solo cambiaba `visible` de la
              ventana y no desmontaba nada.

              NO se puede hacer con dos <With> anidados (visibilidad → sección), que es lo
              primero que sale: <With> devuelve un Fragment y `Fragment.append` lanza
              "nesting Fragments are not yet supported". El error se traga en el efecto, así
              que el panel se queda SIN CONTENIDO y además el fragment externo nunca llega a
              tener hijos → su scope no se dispone jamás y no corre ni un onCleanup: pierdes
              justo lo que venías a arreglar, en silencio. Medido.

              Por lo mismo el caso cerrado devuelve un <box/> vacío y no `null`: <With> no
              añade nada al fragment ante null/undefined/false/"", y el ciclo de disposición
              cuelga de iterar los hijos del fragment. Sin hijo no hay dispose. */}
          <With value={vistaActiva}>
            {(s: IdSeccion | null) => {
              if (s === null) return <box />
              return crearContenidoSeccion(s) as any
            }}
          </With>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  ) as unknown as Gtk.Widget

  return (
    <window
      name="settings-panel"
      visible={settingsPanelVisible}
      gdkmonitor={gdkmonitor}
      // Mientras polkit pide la contraseña, esta ventana se aparta: una capa
      // OVERLAY tapa SIEMPRE al diálogo (es un toplevel normal) y obligaba a
      // cerrar Ajustes para poder escribir. Ver withPrivilegedPrompt en state.tsx.
      layer={privilegedPromptActive(a => a ? Astal.Layer.BOTTOM : Astal.Layer.OVERLAY)}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      // Y suelta el teclado: con ON_DEMAND la capa puede retener el foco y el
      // diálogo se quedaría sin recibir lo que teclees.
      keymode={privilegedPromptActive(a => a ? Astal.Keymode.NONE : Astal.Keymode.ON_DEMAND)}
      application={app}
      cssClasses={clasesFondoShell("sp-window")}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval) => {
          if (keyval === Gdk.KEY_Escape) { setSettingsPanelVisible(false); return true }
          return false
        }}
      />
      <box cssClasses={["sp-backdrop"]} hexpand vexpand>
        <Gtk.GestureClick
          onPressed={(self: Gtk.GestureClick, _n: number, x: number, y: number) => {
            const backdrop = self.get_widget() as Gtk.Widget
            const hit = backdrop.pick(x, y, 0)
            let w: Gtk.Widget | null = hit
            while (w && w !== backdrop) {
              if (w === panel) return
              w = w.get_parent()
            }
            setSettingsPanelVisible(false)
          }}
        />
        {panel as unknown as any}
      </box>
    </window>
  )
}
