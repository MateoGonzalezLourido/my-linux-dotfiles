// Icono de la barra (inmediatamente a la izquierda del botón de notificaciones) que
// avisa de que algo está capturando la pantalla: compartir por portal (Discord,
// OBS, Zoom, navegador) o grabar en local (wf-recorder y cía.).
//
// No hay polling aquí: hypr/scripts/screencast-monitor.sh escribe
// ~/.config/gigios/screencast.json y esto lo observa con un Gio.FileMonitor,
// igual que Actualizaciones. Sustituye al antiguo indicador, que hacía un
// `pgrep -x wf-recorder` cada 2 s POR MONITOR y no veía los screencasts.
import { Gtk } from "ags/gtk4"
import { datosCapturaPantalla } from "../../../../servicios/pantalla/captura"
import { tooltipCaptura } from "../../../../servicios/pantalla/capturaDatos"

export default function CapturaPantalla() {
  return (
    <box
      visible={datosCapturaPantalla((datos) => datos.active)}
      valign={Gtk.Align.CENTER}
      cssClasses={["recording", "screencast-indicator"]}
      tooltipText={datosCapturaPantalla(tooltipCaptura)}
    >
      <label label="󰑊" />
    </box>
  )
}
