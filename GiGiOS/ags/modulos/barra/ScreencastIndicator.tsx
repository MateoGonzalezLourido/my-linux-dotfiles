// modulos/barra/ScreencastIndicator.tsx
// Icono de la barra (inmediatamente a la izquierda de NotificationButton) que
// avisa de que algo está capturando la pantalla: compartir por portal (Discord,
// OBS, Zoom, navegador) o grabar en local (wf-recorder y cía.).
//
// No hay polling aquí: hypr/scripts/screencast-monitor.sh escribe
// ~/.config/gigios/screencast.json y esto lo observa con un Gio.FileMonitor,
// igual que UpdatesButton. Sustituye al antiguo Recording.tsx, que hacía un
// `pgrep -x wf-recorder` cada 2 s POR MONITOR y no veía los screencasts.
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { createState, onCleanup } from "ags"
import { Gtk } from "ags/gtk4"

const SCREENCAST_PATH = `${GLib.get_user_config_dir()}/gigios/screencast.json`

type Kind = "share" | "record"
type Source = { kind: Kind; app: string }
type ScreencastData = { active: boolean; sources: Source[] }

const EMPTY: ScreencastData = { active: false, sources: [] }

// Lee screencast.json de forma defensiva: ausente/corrupto → nada capturando.
function readScreencast(): ScreencastData {
  try {
    const [ok, content] = GLib.file_get_contents(SCREENCAST_PATH)
    if (!ok) return EMPTY
    const j = JSON.parse(new TextDecoder().decode(content))
    const sources: Source[] = Array.isArray(j.sources)
      ? j.sources.filter(
          (s: any) => s && (s.kind === "share" || s.kind === "record") && typeof s.app === "string",
        )
      : []
    // `active` exige además fuentes: un JSON incoherente no enciende el icono.
    return { active: j.active === true && sources.length > 0, sources }
  } catch (_) {
    return EMPTY
  }
}

const KIND_LABEL: Record<Kind, string> = {
  share: "Compartiendo pantalla",
  record: "Grabando pantalla",
}

// "Compartiendo pantalla · Discord", y una línea por tipo si coinciden ambos.
function tooltipFor(d: ScreencastData): string {
  const lines: string[] = []
  for (const kind of ["share", "record"] as const) {
    const apps = [...new Set(d.sources.filter((s) => s.kind === kind).map((s) => s.app))]
    if (apps.length > 0) lines.push(`${KIND_LABEL[kind]} · ${apps.join(", ")}`)
  }
  return lines.join("\n")
}

export default function ScreencastIndicator() {
  const [data, setData] = createState(readScreencast())

  let monitor: Gio.FileMonitor | null = null
  try {
    const file = Gio.file_new_for_path(SCREENCAST_PATH)
    monitor = file.monitor(Gio.FileMonitorFlags.NONE, null)
    monitor.connect("changed", () => setData(readScreencast()))
  } catch (e) {
    console.error("[screencast] monitor:", e)
  }
  onCleanup(() => {
    monitor?.cancel()
    monitor = null
  })

  return (
    <box
      visible={data((d) => d.active)}
      valign={Gtk.Align.CENTER}
      cssClasses={["recording", "screencast-indicator"]}
      tooltipText={data(tooltipFor)}
    >
      <label label="󰑊" />
    </box>
  )
}
