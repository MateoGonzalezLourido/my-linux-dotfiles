import { createState, onCleanup } from "ags"
import { execAsync } from "ags/process"
import { Gdk, Gtk } from "ags/gtk4"
import AstalHyprland from "gi://AstalHyprland"
import AstalMpris from "gi://AstalMpris"
import GdkPixbuf from "gi://GdkPixbuf"
import GLib from "gi://GLib"
import cairo from "gi://cairo"
import { barVisible } from "../state"
import { powerSaveActive } from "../power/powerState"
import { isAd, parseTrackId } from "../services/spotify/parse"
import { transferToThisDevice } from "../services/spotify/SpotifyService"
import {
  programarLimpiezaCacheCaratulas,
  registrarCaratulaLocal,
  resolverCaratulaRemota,
} from "../cacheCaratulas"

const ART_WIDTH = 40
const ART_HEIGHT = 30

const WAVE_BARS = 13
const WAVE_LINE = 2.4
const WAVE_MIN = 2        // altura en reposo: un punto
const ATTACK_TAU = 0.045  // sube de golpe…
const RELEASE_TAU = 0.19  // …y cae despacio, como un vúmetro
const WAVE_BPM = 112
const WAVE_FPS_SAVE = 24  // en ahorro de energía se dibuja a menos frames
// Tope normal. `add_tick_callback` va al ritmo del MONITOR, así que sin tope (el
// umbral era literalmente 0) este adorno se dibujaba a la tasa de refresco: en un panel
// de 240 Hz, 240 pasadas por segundo de 13 bandas × 3 senos más un repintado de cairo,
// y cuatro de cada cinco no las ve nadie — un vúmetro de 13 barritas no se ve más
// fluido a 240 que a 60.
//
// MEDIDO en esta máquina (2560x1440@240, 12 hilos), y el número honesto es modesto: la
// animación entera cuesta ~2,7 puntos de un core (AGS sonando ~7,8% vs ~5,0% en pausa),
// y este tope se lleva ~0,6, no los ~2 que cabría esperar de dividir los frames por
// cuatro. El motivo es que el callback lo sigue invocando GTK 240 veces por segundo
// aunque salgamos temprano: lo que se ahorra es el dibujo, no la llamada. Bajarlo a
// 1 fps solo llegaba a ~1,5 puntos, o sea que ni siquiera destruyendo la animación se
// recupera mucho más. Se deja en 60 porque es gratis y no se nota, no porque arregle
// nada gordo: el ruido entre medidas ya es de ~1 punto.
//
// Contexto para no volver a perseguir esto: AGS entero ronda el 7% de UN core, ~0,6%
// del CPU total. No es lo que cuesta frames en un juego. En fullscreen real, además, el
// compositor deja de mandar frames y la animación se para sola (medido: 9,5% → 3,5%);
// el caso que de verdad paga es un juego en ventana SIN bordes, donde la barra sigue
// visible y el reloj de frames vivo.
const WAVE_FPS_MAX = 60

/** Ruido determinista: da a cada banda su propia fase y ganancia. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

type Band = {
  gain: number   // techo de la banda: los graves pegan más fuerte
  speed: number  // los agudos tiemblan, los graves ondulan
  bass: number   // cuánto le llega el golpe de bombo
  ph: [number, number, number]
  level: number
}

/**
 * Una banda por barra, cada una con su fase y su velocidad. Que cada barra
 * evolucione por su cuenta es justo lo que las despega de la senoide única que
 * las hacía desfilar en formación.
 */
function makeBands(): Band[] {
  return Array.from({ length: WAVE_BARS }, (_, i) => {
    const t = i / (WAVE_BARS - 1)
    return {
      gain: (0.44 + 0.56 * Math.pow(1 - t, 0.8)) * (0.82 + 0.32 * hash01(i + 1)),
      speed: 1.15 + 2.7 * t,
      bass: Math.pow(1 - t, 1.7),
      ph: [hash01(i + 7) * 6.283, hash01(i + 31) * 6.283, hash01(i + 91) * 6.283],
      level: 0,
    }
  })
}

/** Reproductor mínimo de Spotify para el centro de la barra. */
export default function SpotifyNowPlaying() {
  const hypr = AstalHyprland.get_default()
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />
  programarLimpiezaCacheCaratulas()

  const [visible, setVisible] = createState(false)
  const [title, setTitle] = createState("")
  const [artist, setArtist] = createState("")

  let destroyed = false
  let coverInput = "\0"
  let pollTimer: number | null = null
  let currentSpotify: any = null
  let spotifyPlaying = false
  let adIndex = 0
  let lastAdTrackId: string | null = null

  const bands = makeBands()
  let energy = 0            // 0 parado, 1 sonando: las barras suben y caen en vez de saltar
  let clockT = 0
  let lastFrameUs = 0
  let carry = 0
  let tickId: number | null = null
  let barShown = barVisible.get()

  const artPicture = new Gtk.Picture({
    contentFit: Gtk.ContentFit.COVER,
    canShrink: true,
    hexpand: true,
    vexpand: true,
  })

  // El contenedor fija el tamaño lógico a 40×30. La textura conserva la
  // resolución original para que GTK pueda reducirla con nitidez en HiDPI.
  const artCap = new Gtk.ScrolledWindow()
  artCap.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.NEVER)
  artCap.set_propagate_natural_width(false)
  artCap.set_propagate_natural_height(false)
  artCap.set_min_content_width(ART_WIDTH)
  artCap.set_max_content_width(ART_WIDTH)
  artCap.set_min_content_height(ART_HEIGHT)
  artCap.set_max_content_height(ART_HEIGHT)
  artCap.set_child(artPicture)

  const setArtworkFile = (path: string) => {
    if (destroyed) return
    try {
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path)
      artPicture.set_paintable(Gdk.Texture.new_for_pixbuf(pixbuf))
    } catch (_) {
      artPicture.set_paintable(null)
    }
  }

  const resolveArtwork = (raw: string) => {
    if (raw === coverInput) return
    coverInput = raw
    if (!raw) {
      artPicture.set_paintable(null)
      return
    }

    if (!raw.startsWith("http")) {
      registrarCaratulaLocal(raw)
      setArtworkFile(raw.startsWith("file://") ? raw.slice(7) : raw)
      return
    }

    resolverCaratulaRemota(raw)
      .then((path) => { if (coverInput === raw) setArtworkFile(path) })
      .catch(() => { if (coverInput === raw) artPicture.set_paintable(null) })
  }

  const waveform = new Gtk.DrawingArea({
    widthRequest: 54,
    heightRequest: 26,
    valign: Gtk.Align.CENTER,
  })
  waveform.set_can_target(false)
  waveform.set_draw_func((_area, cr, width, height) => {
    const gap = width / (WAVE_BARS + 1)
    const span = height - WAVE_LINE  // los extremos redondeados sobresalen media línea
    cr.setLineWidth(WAVE_LINE)
    cr.setLineCap(cairo.LineCap.ROUND)

    bands.forEach((band, index) => {
      const level = band.level * energy
      const barHeight = WAVE_MIN + (span - WAVE_MIN) * level
      const x = gap * (index + 1)
      cr.setSourceRGBA(0.88, 0.88, 0.86, 0.5 + 0.45 * level)
      cr.moveTo(x, (height - barHeight) / 2)
      cr.lineTo(x, (height + barHeight) / 2)
      cr.stroke()
    })
  })

  const restWave = () => {
    energy = 0
    carry = 0
    bands.forEach((band) => { band.level = 0 })
  }

  const frame = (_widget: any, frameClock: any): boolean => {
    const nowUs = frameClock.get_frame_time()
    const raw = lastFrameUs ? (nowUs - lastFrameUs) / 1e6 : 1 / 60
    lastFrameUs = nowUs
    // Un salto largo (bar oculto, suspensión) no debe teletransportar las barras.
    carry += Math.min(0.1, raw)
    // `carry` NO se resetea al saltar: sigue acumulando, así que el frame que sí se
    // dibuja recibe el dt real y la animación avanza a la misma velocidad de siempre.
    // Bajar el ritmo aquí cambia cuántas veces se dibuja, no lo rápido que se mueve.
    if (carry < 1 / (powerSaveActive.get() ? WAVE_FPS_SAVE : WAVE_FPS_MAX)) return true
    const dt = carry
    carry = 0
    clockT += dt

    const target = spotifyPlaying ? 1 : 0
    energy += (target - energy) * (1 - Math.exp(-dt / (spotifyPlaying ? 0.20 : 0.28)))

    // Bombo con acento cada cuatro tiempos: pulso musical, no deriva uniforme.
    const beat = (clockT / (60 / WAVE_BPM)) % 4
    const kick = Math.exp(-(beat % 1) * 7) * (beat < 1 ? 1 : 0.55)

    bands.forEach((band) => {
      // Tres senos inconmensurables: no se repiten en bucle como una senoide sola.
      // El /0.72 y la S de smoothstep son lo que da recorrido: sin ellos la suma se
      // apelotona en torno a 0.5 y las barras solo respiran a media altura.
      const wobble = (
        0.55 * Math.sin(clockT * band.speed + band.ph[0]) +
        0.30 * Math.sin(clockT * band.speed * 1.73 + band.ph[1]) +
        0.15 * Math.sin(clockT * band.speed * 2.61 + band.ph[2])
      ) / 0.72
      const n = Math.min(1, Math.max(0, 0.5 + 0.5 * wobble))
      const shaped = n * n * (3 - 2 * n)
      const peak = Math.min(1, band.gain * (0.06 + 0.94 * shaped) + 0.5 * kick * band.bass)
      const tau = peak > band.level ? ATTACK_TAU : RELEASE_TAU
      band.level += (peak - band.level) * (1 - Math.exp(-dt / tau))
    })

    waveform.queue_draw()

    // Ya está todo caído: soltar el reloj de frames hasta que vuelva a sonar.
    if (!spotifyPlaying && energy < 0.004) {
      restWave()
      waveform.queue_draw()
      tickId = null
      return false
    }
    return true
  }

  /** Anima solo si hay algo que animar y el bar está a la vista. */
  const syncWave = () => {
    const needed = barShown && (spotifyPlaying || energy > 0)
    if (needed && tickId === null) {
      lastFrameUs = 0
      tickId = waveform.add_tick_callback(frame)
    } else if (!needed && tickId !== null) {
      waveform.remove_tick_callback(tickId)
      tickId = null
    }
  }

  const unsubBar = barVisible.subscribe(() => {
    barShown = barVisible.get()
    // Oculto y en pausa: no hay que reanudar ninguna caída al reaparecer.
    if (!barShown && !spotifyPlaying) restWave()
    syncWave()
  })

  const update = () => {
    const spotify = mpris.players.find((player: any) =>
      String(player.bus_name || "").toLowerCase().includes("spotify"))
    const isPlaying = spotify?.playback_status === AstalMpris.PlaybackStatus.PLAYING
    currentSpotify = spotify || null
    spotifyPlaying = isPlaying

    if (!spotify) {
      setVisible(false)
      restWave()
      syncWave()
      waveform.queue_draw()
      return
    }

    // Un anuncio trae título de reclamo ("Escucha música sin anuncios…") y ningún
    // artista, así que se colaba como pista con "Artista desconocido". El trackid es
    // el único dato que lo delata: mismo `isAd` puro que usa el reproductor de
    // QuickSettings, y misma cuenta de anuncios del bloque (Spotify no publica
    // cuántos van ni cuántos quedan).
    const rawTrackId = spotify.trackid || ""
    const ad = isAd(rawTrackId)
    setVisible(Boolean(ad || spotify.title || spotify.artist))

    if (ad) {
      // El mismo anuncio persiste varios ticks de 1 s: solo cuenta si cambia el id.
      if (rawTrackId !== lastAdTrackId) {
        adIndex += 1
        lastAdTrackId = rawTrackId
      }
      setTitle(`Anuncio · ${adIndex}`)
      setArtist("")
    } else {
      adIndex = 0
      lastAdTrackId = null
      setTitle(spotify.title || "Sin título")
      setArtist(spotify.artist || "Artista desconocido")
    }

    resolveArtwork(spotify.cover_art || spotify.art_url || "")
    syncWave()
  }

  /**
   * ¿El audio está saliendo por ESTE equipo? MPRIS no lo dice: cuando reproduces en
   * el móvil, el cliente de escritorio hace de mando a distancia y su MPRIS anuncia
   * "Playing" igual que si sonara aquí. Quien lo delata es PipeWire: el nodo de
   * Spotify solo está `running` mientras el cliente *rinde* audio (medido: `running`
   * sonando, `idle` en pausa, y no existe si nunca ha sonado). Sonando en el móvil,
   * el cliente no rinde nada.
   *
   * Ante cualquier fallo (sin pw-dump, JSON raro) devuelve `true` = "suena aquí", que
   * degrada al comportamiento de siempre (play/pausa) en vez de intentar una
   * transferencia sorpresa.
   */
  const audioIsLocal = async (): Promise<boolean> => {
    try {
      const nodes = JSON.parse(await execAsync(["pw-dump"]))
      return nodes.some((node: any) => {
        const props = node?.info?.props
        if (!props) return false
        if (!String(props["media.class"] || "").includes("Stream/Output/Audio")) return false
        const who = `${props["application.name"] || ""} ${props["node.name"] || ""}`.toLowerCase()
        return who.includes("spotify") && node?.info?.state === "running"
      })
    } catch (_) { return true }
  }

  const wait = (ms: number) => new Promise<void>((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE })
  })

  /**
   * `audioIsLocal` con red de seguridad para el arranque: el nodo tarda un instante
   * en pasar a `running` después de darle a play, así que un play seguido de un pause
   * rápido se leería como "esto suena en otro sitio" y acabaría transfiriendo en vez
   * de pausar. Un segundo sondeo solo en el camino dudoso lo descarta.
   */
  const resolveLocal = async (): Promise<boolean> => {
    if (await audioIsLocal()) return true
    await wait(350)
    return audioIsLocal()
  }

  const notify = (body: string) =>
    execAsync(["notify-send", "-a", "Spotify", "-i", "spotify", "Spotify", body]).catch(() => { })

  /** Trae el audio del móvil (u otro dispositivo Connect) a este PC. */
  const takeOverPlayback = async () => {
    const result = await transferToThisDevice()
    if (result === "ok") return

    // Plan B (cuentas free: la API rechaza todo /me/player con 403, y sin
    // credenciales configuradas ni eso). Lo único que queda es pedirle al cliente
    // local que abra la pista: al reproducirla él, el audio pasa a este equipo.
    // Reabre desde el principio — no hay forma de conservar la posición por aquí.
    if (result === "denied" || result === "unavailable") {
      const id = parseTrackId(currentSpotify?.trackid || "")
      if (id && currentSpotify?.can_control) {
        try {
          currentSpotify.open_uri(`spotify:track:${id}`)
          return
        } catch (_) { /* cae al aviso */ }
      }
    }

    notify(result === "no-device"
      ? "No se pudo traer el audio: este equipo no aparece como dispositivo de Spotify Connect."
      : "No se pudo traer el audio a este equipo.")
  }

  const focusSpotify = () => {
    const client = (hypr.get_clients?.() ?? []).find((candidate: any) =>
      [candidate.class, candidate.initialClass, candidate.initial_class]
        .some((value) => String(value || "").toLowerCase().includes("spotify")))
    if (!client?.address) return

    const address = String(client.address)
    const normalized = address.startsWith("0x") ? address : `0x${address}`
    execAsync(["hyprctl", "dispatch", "focuswindow", `address:${normalized}`]).catch(() => {})
  }

  update()
  pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    update()
    return GLib.SOURCE_CONTINUE
  })

  // Limpieza al DESMONTAR. Va con `onCleanup` (el hook de ags) y no con un
  // `connect("destroy")` en el box, que es lo que había y NO funcionaba: en GTK4 no
  // existe `gtk_widget_destroy()`, la señal sale de `dispose`, y al desmontar con
  // <With> el widget solo se desparenta — los closures de JS siguen referenciándolo,
  // así que nunca se libera y el handler no llega a correr.
  //
  // MEDIDO antes de arreglarlo, con el ahorro oscilando cada 15 s: tres montajes
  // seguidos dejaban las TRES instancias haciendo tick a la vez (74/44/14 ticks) y
  // ni un solo "destroy". O sea que cada ciclo fugaba este timer de 1 s, el tick
  // callback del waveform (que es el reloj de FRAMES) y la suscripción a barVisible.
  // Ya pasaba al apagar Spotify desde Ajustes; el ajuste de ahorro solo lo convertía
  // en automático y repetido. Mismo patrón que `CpuRam.tsx`, que ya lo documenta.
  onCleanup(() => {
    destroyed = true
    if (pollTimer !== null) { GLib.source_remove(pollTimer); pollTimer = null }
    if (tickId !== null) { waveform.remove_tick_callback(tickId); tickId = null }
    unsubBar()
  })

  return (
    <box
      visible={visible}
      cssClasses={["bar-spotify"]}
      spacing={3}
      valign={Gtk.Align.CENTER}
    >
      <box spacing={7}>
        <box cssClasses={["bar-spotify-art"]} overflow={Gtk.Overflow.HIDDEN}>
          <Gtk.Overlay $={(overlay: Gtk.Overlay) => {
            overlay.set_child(<label label="󰓇" cssClasses={["bar-spotify-placeholder"]} /> as Gtk.Widget)
            overlay.add_overlay(artCap)
          }} />
        </box>
        <box
          orientation={Gtk.Orientation.VERTICAL}
          valign={Gtk.Align.CENTER}
          widthRequest={145}
        >
          <label
            cssClasses={["bar-spotify-title"]}
            label={title}
            halign={Gtk.Align.START}
            ellipsize={3}
            maxWidthChars={24}
          />
          <label
            cssClasses={["bar-spotify-artist"]}
            label={artist}
            halign={Gtk.Align.START}
            ellipsize={3}
            maxWidthChars={24}
          />
        </box>
      </box>
      {waveform}
      <Gtk.GestureClick
        button={1}
        onReleased={() => {
          if (!currentSpotify) return

          const toggle = () => {
            spotifyPlaying = !spotifyPlaying
            syncWave()
            currentSpotify.play_pause()
          }

          // Si MPRIS dice "Playing" puede estar sonando aquí… o en el móvil. Solo en
          // el segundo caso el clic significa "tráete el audio". Hay que preguntarle a
          // PipeWire (async), así que aquí no se conmuta de forma optimista: pausar
          // algo que en realidad suena en otro sitio sería justo lo contrario de lo
          // que se ha pedido. El sondeo tarda decenas de ms; el poller de 1 s corrige
          // el estado de la onda después.
          if (!spotifyPlaying) { toggle(); return }
          resolveLocal().then((local) => {
            if (destroyed || !currentSpotify) return
            if (local) toggle()
            else takeOverPlayback()
          })
        }}
      />
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onReleased={focusSpotify}
      />
    </box>
  )
}
