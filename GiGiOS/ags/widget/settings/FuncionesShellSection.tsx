import { Gtk } from "ags/gtk4"
import { AjusteInterruptor, TarjetaAjustes, TituloSeccion } from "./componentes"
import LimpiezaPortapapeles from "./LimpiezaPortapapeles"
import {
  startupVolumeMuted, setStartupVolumeMuted,
  startupMicMuted, setStartupMicMuted,
  volumeOsdEnabled, setVolumeOsdEnabled,
  micOsdEnabled, setMicOsdEnabled,
  brightnessOsdEnabled, setBrightnessOsdEnabled,
  orionEnabled, setOrionEnabled,
  orionAppsDefault, setOrionAppsDefault,
  orionRecordarUltimaSeccion, setOrionRecordarUltimaSeccion,
  anclarVentanasRofi, setAnclarVentanasRofi,
  clipboardHistoryEnabled, setClipboardHistoryEnabled,
  limpiezaPortapapelesAlIniciar, setLimpiezaPortapapelesAlIniciar,
} from "./preferences"
import textos from "../../textos/ajustes/personalizacion.json" with { type: "json" }

type VistaFunciones = "personalizacion" | "orion" | "portapapeles"

export default function FuncionesShellSection({ vista }: { vista: VistaFunciones }) {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
      <TituloSeccion titulo={textos.vistasFunciones[vista]} />

      {vista === "personalizacion" && <TarjetaAjustes titulo={textos.seccionesNuevas.funcionesShell.sonidoInicio} icono="󰍃">
        <AjusteInterruptor titulo={textos.inicioAudio.volumen.titulo} informacion={textos.inicioAudio.volumen.descripcion} activo={startupVolumeMuted} alAlternar={() => setStartupVolumeMuted(!startupVolumeMuted.get())} />
        <AjusteInterruptor titulo={textos.inicioAudio.microfono.titulo} informacion={textos.inicioAudio.microfono.descripcion} activo={startupMicMuted} alAlternar={() => setStartupMicMuted(!startupMicMuted.get())} />
      </TarjetaAjustes>}

      {vista === "personalizacion" && <TarjetaAjustes titulo={textos.seccionesNuevas.funcionesShell.indicadores} icono="󰕾">
        <AjusteInterruptor titulo={textos.osd.volumen.titulo} informacion={textos.osd.volumen.descripcion} activo={volumeOsdEnabled} alAlternar={() => setVolumeOsdEnabled(!volumeOsdEnabled.get())} />
        <AjusteInterruptor titulo={textos.osd.microfono.titulo} informacion={textos.osd.microfono.descripcion} activo={micOsdEnabled} alAlternar={() => setMicOsdEnabled(!micOsdEnabled.get())} />
        <AjusteInterruptor titulo={textos.osd.brillo.titulo} informacion={textos.osd.brillo.descripcion} activo={brightnessOsdEnabled} alAlternar={() => setBrightnessOsdEnabled(!brightnessOsdEnabled.get())} />
      </TarjetaAjustes>}

      {vista === "personalizacion" && <TarjetaAjustes titulo={textos.seccionesNuevas.funcionesShell.ventanas} icono="󰖯">
        <AjusteInterruptor titulo={textos.ventanas.anclaje.titulo} informacion={textos.ventanas.anclaje.descripcion} activo={anclarVentanasRofi} alAlternar={() => setAnclarVentanasRofi(!anclarVentanasRofi.get())} />
      </TarjetaAjustes>}

      {vista === "orion" && <TarjetaAjustes titulo={textos.seccionesNuevas.funcionesShell.orion} icono="󰆍">
        <AjusteInterruptor titulo={textos.orion.menu.titulo} informacion={textos.orion.menu.descripcion} activo={orionEnabled} alAlternar={() => setOrionEnabled(!orionEnabled.get())} />
        <AjusteInterruptor titulo={textos.orion.paginaInicial.titulo} informacion={textos.orion.paginaInicial.descripcion} activo={orionAppsDefault} visible={orionEnabled} alAlternar={() => setOrionAppsDefault(!orionAppsDefault.get())} />
        <AjusteInterruptor titulo={textos.orion.ultimaSeccion.titulo} informacion={textos.orion.ultimaSeccion.descripcion} activo={orionRecordarUltimaSeccion} visible={orionEnabled} alAlternar={() => setOrionRecordarUltimaSeccion(!orionRecordarUltimaSeccion.get())} />
      </TarjetaAjustes>}

      {vista === "portapapeles" && <TarjetaAjustes titulo={textos.seccionesNuevas.funcionesShell.portapapeles} icono="󰅇">
        <AjusteInterruptor titulo={textos.portapapeles.titulo} informacion={textos.portapapeles.descripcion} activo={clipboardHistoryEnabled} alAlternar={() => setClipboardHistoryEnabled(!clipboardHistoryEnabled.get())} />
        <LimpiezaPortapapeles />
        <AjusteInterruptor
          titulo={textos.portapapeles.limpiezaAutomatica.titulo}
          informacion={textos.portapapeles.limpiezaAutomatica.descripcion}
          activo={limpiezaPortapapelesAlIniciar}
          alAlternar={() => setLimpiezaPortapapelesAlIniciar(!limpiezaPortapapelesAlIniciar.get())}
        />
      </TarjetaAjustes>}
    </box>
  )
}
