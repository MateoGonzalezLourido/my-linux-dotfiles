import { For, onCleanup } from "ags"
import { Gtk } from "ags/gtk4"
import Interruptor from "../../componentes/Interruptor"
import { conectarCambioDeslizador } from "../../utilidades/deslizador"
import { InlineEditableValue } from "../../componentes/InlineEditableValue"
import {
  AjusteInterruptor, FilaAjuste, TarjetaAjustes,
  TextoInformativo, TituloAjuste, TituloSeccion,
} from "./componentes"
import {
  barAutoHideEnabled, setBarAutoHideEnabled,
  wsPreviewEnabled, setWsPreviewEnabled,
  spotifyBarEnabled, setSpotifyBarEnabled,
  batteryBarEnabled, setBatteryBarEnabled,
  networkBarEnabled, setNetworkBarEnabled,
  micIndicatorEnabled, setMicIndicatorEnabled,
  screencastIndicatorEnabled, setScreencastIndicatorEnabled,
  trayBarEnabled, setTrayBarEnabled,
  notificationBarEnabled, setNotificationBarEnabled,
  workspacesBarEnabled, setWorkspacesBarEnabled,
  titulosAppsWorkspaceActivos, setTitulosAppsWorkspaceActivos,
  workspaceAppLimit, setWorkspaceAppLimit,
  WORKSPACE_APP_LIMIT_MIN, WORKSPACE_APP_LIMIT_MAX,
  workspaceVisibleLimit, setWorkspaceVisibleLimit,
  WORKSPACE_VISIBLE_LIMIT_MIN, WORKSPACE_VISIBLE_LIMIT_MAX,
} from "./preferences"
import {
  knownTrayApps, hiddenTrayApps, trayOverflowAt,
  hideTrayApp, showTrayApp, forgetTrayApp, setTrayOverflowAt,
  type TrayAppInfo,
} from "./trayApps"
import textos from "../../textos/ajustes/personalizacion.json" with { type: "json" }
import textosApps from "../../textos/ajustes/apps.json" with { type: "json" }
import { formatearTexto } from "../../textos/formatear"

function DeslizadorLimite({ valor, minimo, maximo, alCambiar }: {
  valor: any
  minimo: number
  maximo: number
  alCambiar: (valor: number) => void
}) {
  const ajuste = new Gtk.Adjustment({ lower: minimo, upper: maximo, stepIncrement: 1, pageIncrement: 1 })
  ajuste.value = valor.get()
  const escala = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: ajuste,
    drawValue: false,
    digits: 0,
    hexpand: true,
  })
  escala.cssClasses = ["qs-slider", "brightness"]
  conectarCambioDeslizador(escala, alCambiar)
  // onCleanup, NUNCA connect("destroy"): en GTK4 `destroy` sale de `dispose`, y al
  // desmontar con <With> el widget solo se desparenta —los closures de JS lo siguen
  // referenciando—, así que el handler no llegaba a correr y cada visita a la sección
  // dejaba un suscriptor vivo para siempre. <With> sí hace scope.dispose(). Mismo
  // patrón (y mismo bug) que documenta ReproduccionSpotify.tsx.
  onCleanup(valor.subscribe(() => {
    if (ajuste.value !== valor.get()) ajuste.value = valor.get()
  }))
  return escala
}

function LimiteWorkspace({ titulo, descripcion, tooltip, valor, minimo, maximo, alCambiar }: {
  titulo: string
  descripcion: string
  tooltip: string
  valor: any
  minimo: number
  maximo: number
  alCambiar: (valor: number) => void
}) {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={7} cssClasses={["dev-row"]}>
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <TituloAjuste label={titulo} hexpand halign={Gtk.Align.START} />
        <InlineEditableValue
          display={valor((limite: number) => `${limite}`)}
          getValue={() => valor.get()}
          onCommit={alCambiar}
          min={minimo}
          max={maximo}
          labelClass="sp-field-value"
          tooltip={tooltip}
          maxLength={1}
        />
      </box>
      {DeslizadorLimite({ valor, minimo, maximo, alCambiar }) as unknown as any}
      <TextoInformativo label={descripcion} halign={Gtk.Align.START} wrap xalign={0} />
    </box>
  )
}

function FilaAppBandeja({ app }: { app: TrayAppInfo }) {
  const visible = hiddenTrayApps((ocultas: string[]) => !ocultas.includes(app.id))
  return (
    <FilaAjuste titulo={app.title}>
      <box spacing={8} valign={Gtk.Align.CENTER}>
        {app.iconName
          ? <image iconName={app.iconName} pixelSize={22} />
          : <label cssClasses={["sp-nav-icon"]} label="󰀻" />}
        <button
          cssClasses={["sp-rule-del"]}
          valign={Gtk.Align.CENTER}
          tooltipText={textosApps.app.quitar}
          onClicked={() => forgetTrayApp(app.id)}
        >
          <label label="󰆴" />
        </button>
        <Interruptor activo={visible} alAlternar={() => visible.get() ? hideTrayApp(app.id) : showTrayApp(app.id)} />
      </box>
    </FilaAjuste>
  )
}

type VistaBarra = "barra" | "workspaces"

export default function BarraEscritoriosSection({ vista }: { vista: VistaBarra }) {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
      <TituloSeccion titulo={textos.vistasBarra[vista]} />

      {vista === "barra" && <TarjetaAjustes titulo={textos.seccionesNuevas.barraEscritorios.comportamiento} icono="󰍜">
        <AjusteInterruptor
          titulo={textos.barra.ocultacionAutomatica.titulo}
          informacion={textos.barra.ocultacionAutomatica.descripcion}
          activo={barAutoHideEnabled}
          alAlternar={() => setBarAutoHideEnabled(!barAutoHideEnabled.get())}
        />
      </TarjetaAjustes>}

      {vista === "barra" && <TarjetaAjustes titulo={textos.seccionesNuevas.barraEscritorios.elementos} icono="󰕰">
        <AjusteInterruptor titulo={textos.barra.spotify.titulo} informacion={textos.barra.spotify.descripcion} activo={spotifyBarEnabled} alAlternar={() => setSpotifyBarEnabled(!spotifyBarEnabled.get())} />
        <AjusteInterruptor titulo={textos.barra.bateria.titulo} informacion={textos.barra.bateria.descripcion} activo={batteryBarEnabled} alAlternar={() => setBatteryBarEnabled(!batteryBarEnabled.get())} />
        <AjusteInterruptor titulo={textos.barra.red.titulo} informacion={textos.barra.red.descripcion} activo={networkBarEnabled} alAlternar={() => setNetworkBarEnabled(!networkBarEnabled.get())} />
        <AjusteInterruptor titulo={textos.barra.indicadorMicrofono.titulo} informacion={textos.barra.indicadorMicrofono.descripcion} activo={micIndicatorEnabled} alAlternar={() => setMicIndicatorEnabled(!micIndicatorEnabled.get())} />
        <AjusteInterruptor titulo={textos.barra.compartirPantalla.titulo} informacion={textos.barra.compartirPantalla.descripcion} activo={screencastIndicatorEnabled} alAlternar={() => setScreencastIndicatorEnabled(!screencastIndicatorEnabled.get())} />
        <AjusteInterruptor titulo={textos.barra.bandeja.titulo} informacion={textos.barra.bandeja.descripcion} activo={trayBarEnabled} alAlternar={() => setTrayBarEnabled(!trayBarEnabled.get())} />
        <AjusteInterruptor titulo={textos.barra.notificaciones.titulo} informacion={textos.barra.notificaciones.descripcion} activo={notificationBarEnabled} alAlternar={() => setNotificationBarEnabled(!notificationBarEnabled.get())} />
      </TarjetaAjustes>}

      {vista === "barra" && <TarjetaAjustes titulo={textos.seccionesNuevas.barraEscritorios.espaciosBarra} icono="󰆾">
        <AjusteInterruptor titulo={textos.barra.workspaces.titulo} informacion={textos.barra.workspaces.descripcion} activo={workspacesBarEnabled} alAlternar={() => setWorkspacesBarEnabled(!workspacesBarEnabled.get())} />
        <AjusteInterruptor titulo={textos.vistaPrevia.titulo} informacion={textos.vistaPrevia.descripcion} activo={wsPreviewEnabled} visible={workspacesBarEnabled} alAlternar={() => setWsPreviewEnabled(!wsPreviewEnabled.get())} />
        <AjusteInterruptor titulo={textos.barra.workspaces.titulosApps.titulo} informacion={textos.barra.workspaces.titulosApps.descripcion} activo={titulosAppsWorkspaceActivos} visible={workspacesBarEnabled} alAlternar={() => setTitulosAppsWorkspaceActivos(!titulosAppsWorkspaceActivos.get())} />
      </TarjetaAjustes>}

      {vista === "workspaces" && <TarjetaAjustes titulo={textos.seccionesNuevas.barraEscritorios.espacios} icono="󰆾">
        <box orientation={Gtk.Orientation.VERTICAL}>
          <LimiteWorkspace
            titulo={textos.barra.workspaces.limiteApps.titulo}
            descripcion={formatearTexto(textos.barra.workspaces.limiteApps.descripcion, { minimo: WORKSPACE_APP_LIMIT_MIN, maximo: WORKSPACE_APP_LIMIT_MAX })}
            tooltip={textos.barra.workspaces.limiteApps.tooltip}
            valor={workspaceAppLimit}
            minimo={WORKSPACE_APP_LIMIT_MIN}
            maximo={WORKSPACE_APP_LIMIT_MAX}
            alCambiar={setWorkspaceAppLimit}
          />
          <LimiteWorkspace
            titulo={textos.barra.workspaces.limiteVisibles.titulo}
            descripcion={textos.barra.workspaces.limiteVisibles.descripcion}
            tooltip={textos.barra.workspaces.limiteVisibles.tooltip}
            valor={workspaceVisibleLimit}
            minimo={WORKSPACE_VISIBLE_LIMIT_MIN}
            maximo={WORKSPACE_VISIBLE_LIMIT_MAX}
            alCambiar={setWorkspaceVisibleLimit}
          />
        </box>
      </TarjetaAjustes>}

      {vista === "barra" && <TarjetaAjustes titulo={textosApps.seccion.titulo} icono="󰀻" visible={trayBarEnabled}>
        <FilaAjuste titulo={textosApps.agrupacion.titulo} informacion={textosApps.agrupacion.descripcion} visible={trayBarEnabled}>
          <box spacing={6} valign={Gtk.Align.CENTER}>
            <button cssClasses={["sp-step-btn"]} onClicked={() => setTrayOverflowAt(trayOverflowAt.get() - 1)}><label label="−" /></button>
            <label cssClasses={["sp-step-val"]} label={trayOverflowAt((n: number) => formatearTexto(textosApps.agrupacion.cantidad, { cantidad: n }))} />
            <button cssClasses={["sp-step-btn"]} onClicked={() => setTrayOverflowAt(trayOverflowAt.get() + 1)}><label label="+" /></button>
          </box>
        </FilaAjuste>
        <box orientation={Gtk.Orientation.VERTICAL} visible={trayBarEnabled}>
          <box cssClasses={["dev-row"]} visible={knownTrayApps((apps: TrayAppInfo[]) => apps.length === 0)}>
            <TextoInformativo label={textosApps.vacio} halign={Gtk.Align.START} />
          </box>
          <For each={knownTrayApps}>{(app: TrayAppInfo) => <FilaAppBandeja app={app} />}</For>
        </box>
      </TarjetaAjustes>}
    </box>
  )
}
