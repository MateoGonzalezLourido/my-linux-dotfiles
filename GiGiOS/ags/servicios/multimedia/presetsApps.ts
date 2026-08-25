// Volumen por aplicación ("mezcla de aplicaciones" de Quick Settings): el almacén de
// presets y —lo que antes no existía— el vigilante que los APLICA a los streams nuevos.
//
// **El fallo que lo motiva.** Los presets se guardaban bien en `audioPresets.json`, pero
// la única línea que los aplicaba vivía dentro del sondeo `pactl` de `QuickSettings.tsx`,
// y ese sondeo **solo corre con el submenú "Aplicaciones" abierto** (refcount ligado a
// `quickSettingsVisible ∧ qsView ∧ audioMode`). O sea: bajabas Spotify al 57 %, cerrabas
// el panel, reabrías Spotify y sonaba al volumen que trajera la app. El ajuste no se
// perdía —seguía en el JSON—, simplemente no había nadie escuchando cuando aparecía el
// stream. Síntoma exacto reportado: "si edito el volumen en Spotify antes de abrir Quick
// Settings, el cambio de audio no le surte efecto". No es específico de Spotify: le pasa
// a cualquier app que se lance con el panel cerrado.
//
// **Esto es AstalWp, NO `pactl`, y esa fue la segunda versión.** La primera vigilaba con
// un `pactl subscribe` en un subproceso, y funcionaba, pero AstalWp ya publica lo mismo
// nativamente: `audio.streams` / `audio.recorders` (los `Stream/Output|Input/Audio`, o sea
// los sink-inputs y source-outputs de Pulse) con señales `stream-added` / `recorder-added`,
// y cada stream trae `id`, `volume` en la MISMA escala que el `value_percent` de pactl
// (medido: preset 0.20 → `volume` 0.2000000031) y `get_pw_property("application.name")`.
// Cero subprocesos, cero parseo de JSON, cero texto localizable. Lo que se tiró con esa
// primera versión merece quedar escrito porque son trampas reales de aquel camino:
//   - `pactl subscribe` **necesitaba `LC_ALL=C`**: sus mensajes son traducibles y el parseo
//     de "Event 'new' on sink-input #45" dependía del locale.
//   - **El hijo no se moría con AGS.** Gio no mata a los hijos al salir, y el SIGPIPE que
//     normalmente los liquida no llegaba porque ese proceso solo escribe cuando hay un
//     evento: cuatro huérfanos medidos con un solo AGS. Hacía falta un envoltorio `bash`
//     que vigilara el stdin, y dentro de él un `exec 3<&0`, porque POSIX manda redirigir a
//     /dev/null el stdin de todo proceso en segundo plano de un shell sin control de
//     trabajos. Nada de esto existe ya: una señal de GObject no deja huérfanos.
//
// **La corrección tardía.** Una app puede fijar su propio volumen JUSTO DESPUÉS de crear
// el stream (Spotify lo hace: restaura el suyo al conectar). Aplicando solo al aparecer, el
// cliente gana la carrera y el preset vuelve a no verse — mismo síntoma, otra causa. Por
// eso, durante `GRACIA_MS` tras aplicar, se escucha `notify::volume` de ese stream y se
// corrige UNA vez si alguien lo ha pisado. Con `pactl` esto costaba un sondeo extra a los
// 700 ms; aquí es una señal que casi nunca se dispara.
//
// **Se escribe con `fijarVolumenEndpoint`**, no con `stream.volume = v`: el setter de
// AstalWp recorta a 1.5 en silencio y los presets de app llegan al 200 % (ver
// `escrituraVolumen.ts`).

import GLib from "gi://GLib"
import AstalWp from "gi://AstalWp"
import { createState } from "ags"
import { execAsync } from "ags/process"
import { fijarVolumenEndpoint } from "./escrituraVolumen"

export type TipoMezcla = "speaker" | "mic"

const RUTA_PRESETS = `${GLib.get_user_config_dir()}/gigios/audioPresets.json`

function cargarPresets(): Record<string, number> {
  try {
    const [ok, contenido] = GLib.file_get_contents(RUTA_PRESETS)
    if (ok) return JSON.parse(new TextDecoder().decode(contenido))
  } catch (e) { }
  return {}
}

/** Fuente única de los presets: la UI lee y escribe aquí, el vigilante lee de aquí. */
export const [audioPresets, setAudioPresets] = createState<Record<string, number>>(cargarPresets())

let idGuardado: number | null = null

/** Escritura diferida 2 s: arrastrar el slider dispara decenas de cambios seguidos. */
export function guardarAudioPresets(p: Record<string, number>) {
  if (idGuardado !== null) GLib.source_remove(idGuardado)
  idGuardado = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    try {
      const dir = GLib.path_get_dirname(RUTA_PRESETS)
      if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o700)
      GLib.file_set_contents(RUTA_PRESETS, JSON.stringify(p))
    } catch (e) { }
    idGuardado = null
    return GLib.SOURCE_REMOVE
  })
}

/**
 * Nombre visible de un stream, ya fusionado con las propiedades de su cliente. La cadena
 * de respaldo es la MISMA que usa la fila de la UI: si divergieran, la fila guardaría el
 * preset bajo una clave que el vigilante nunca buscaría —fallo silencioso, el preset
 * simplemente no se aplicaría— y eso ya pasó una vez entre `mic:` y `app:mic:`.
 */
export function nombreStream(si: any): string {
  const p = si?.properties || {}
  return p["application.name"] || p["node.name"] || p["media.name"]
    || p["application.process.binary"] || "App"
}

/** Clave del preset. La comparte la UI: cambiarla aquí invalidaría los JSON existentes. */
export function clavePreset(tipo: TipoMezcla, nombre: string): string {
  return `app:${tipo === "speaker" ? "spk" : "mic"}:${nombre.toLowerCase()}`
}

const listado = (tipo: TipoMezcla) => (tipo === "speaker" ? "sink-inputs" : "source-outputs")
/**
 * Streams vivos con las propiedades de su cliente fusionadas (`application.name` suele
 * venir del cliente, no del stream). Devuelve también la lista de clientes porque la UI
 * la necesita para las apps "en silencio" y sería un `pactl` de más pedirla dos veces.
 */
export function obtenerStreams(tipo: TipoMezcla): Promise<{ streams: any[]; clientes: any[] }> {
  return Promise.all([
    execAsync(["bash", "-c", `pactl -f json list ${listado(tipo)} 2>/dev/null`]).catch(() => "[]"),
    execAsync(["bash", "-c", "pactl -f json list clients 2>/dev/null"]).catch(() => "[]"),
  ]).then(([streamsStr, clientesStr]) => {
    const crudos = JSON.parse(streamsStr)
    const clientesCrudos = JSON.parse(clientesStr)
    const streams = Array.isArray(crudos) ? crudos : (crudos ? [crudos] : [])
    const clientes = Array.isArray(clientesCrudos) ? clientesCrudos : (clientesCrudos ? [clientesCrudos] : [])
    const porIndice = new Map<string, any>()
    clientes.forEach(c => porIndice.set(String(c.index), c))
    streams.forEach(si => {
      const cliente = porIndice.get(String(si.client))
      if (cliente) si.properties = { ...cliente.properties, ...si.properties }
    })
    return { streams, clientes }
  })
}

// Ids de stream ya atendidos, por tipo. Son ids globales de PipeWire (los de AstalWp), no
// los índices de Pulse: el mismo espacio de nombres que usan las señales, así que un stream
// no puede contarse dos veces. Se limpian en `stream-removed`, que es exacto — con los
// índices de Pulse había que podar contra la lista viva porque PulseAudio los recicla.
const atendidos: Record<TipoMezcla, Set<number>> = { speaker: new Set(), mic: new Set() }

/** Ventana en la que se vigila que el cliente no pise el preset recién aplicado. */
const GRACIA_MS = 1500

function audio(): AstalWp.Audio | null {
  try { return AstalWp.get_default()?.audio ?? null } catch { return null }
}

const listaViva = (tipo: TipoMezcla, a: AstalWp.Audio) =>
  tipo === "speaker" ? a.get_streams() : a.get_recorders()

/** Nombre de la app tal y como lo anuncia el cliente. Es la clave del preset. */
export function nombreDeStream(stream: any): string {
  const propiedad = (clave: string) => {
    try { return stream.get_pw_property(clave) } catch { return null }
  }
  return propiedad("application.name") || propiedad("node.name")
    || propiedad("media.name") || propiedad("application.process.binary")
    || stream.description || "App"
}

/**
 * Aplica el preset a un stream recién aparecido y vigila `GRACIA_MS` por si el cliente
 * pisa el valor justo después (Spotify lo hace). **Corrige durante TODA la ventana, no una
 * sola vez**, y esa distinción es el bug que costó una ronda: al llegar `stream-added` el
 * `volume` del stream todavía es `0` y el valor de verdad llega en una notificación
 * posterior (medido: `added vol=0` → `notify::volume 1` → …), así que una corrección única
 * se la comía esa notificación de inicialización y el pisotón real, unos cientos de ms más
 * tarde, ya no tenía a nadie escuchando. Pasada la gracia se desengancha del todo: el
 * usuario tiene que poder bajar el volumen desde la propia app sin que esto se lo devuelva.
 */
function atender(tipo: TipoMezcla, stream: any) {
  const vistos = atendidos[tipo]
  if (vistos.has(stream.id)) return
  vistos.add(stream.id)

  const preset = audioPresets.get()[clavePreset(tipo, nombreDeStream(stream))]
  if (preset === undefined) return

  fijarVolumenEndpoint(stream, preset)

  let manejador: number | null = stream.connect("notify::volume", () => {
    // Tolerancia de 1 punto: la curva cúbica de PipeWire no devuelve el valor exacto que
    // se escribió (medido: 0.20 → 0.2000000031). Sin ella esto se re-dispararía a sí mismo.
    if (Math.abs(stream.volume - preset) <= 0.01) return
    fijarVolumenEndpoint(stream, preset)
  })
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, GRACIA_MS, () => {
    if (manejador !== null) { try { stream.disconnect(manejador) } catch { } ; manejador = null }
    return GLib.SOURCE_REMOVE
  })
}

let iniciado = false

/**
 * Arranca el vigilante. Se llama una vez desde `app.ts`. El barrido inicial atiende a lo
 * que ya estuviera sonando cuando arrancó el shell (un `hyprctl reload` con Spotify
 * abierto, por ejemplo); a partir de ahí manda la señal.
 */
export function initPresetsApps() {
  if (iniciado) return
  iniciado = true
  const a = audio()
  if (!a) { console.error("[presetsApps] AstalWp no disponible: los presets por app no se aplicarán"); return }

  const enganchar = (tipo: TipoMezcla, senalAlta: string, senalBaja: string) => {
    for (const stream of listaViva(tipo, a)) atender(tipo, stream)
    a.connect(senalAlta, (_a: any, stream: any) => atender(tipo, stream))
    a.connect(senalBaja, (_a: any, stream: any) => atendidos[tipo].delete(stream.id))
  }
  enganchar("speaker", "stream-added", "stream-removed")
  enganchar("mic", "recorder-added", "recorder-removed")
}
