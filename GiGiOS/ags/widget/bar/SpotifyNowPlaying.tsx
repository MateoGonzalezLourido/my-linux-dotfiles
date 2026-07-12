import { createState } from "ags"
import { execAsync } from "ags/process"
import { Gdk, Gtk } from "ags/gtk4"
import AstalHyprland from "gi://AstalHyprland"
import AstalMpris from "gi://AstalMpris"
import GdkPixbuf from "gi://GdkPixbuf"
import GLib from "gi://GLib"
import cairo from "gi://cairo"
import { barVisible } from "../state"
import { powerSaveActive } from "../power/powerState"

const ART_WIDTH = 40
const ART_HEIGHT = 30

const WAVE_BARS = 13
const WAVE_LINE = 2.4
const WAVE_MIN = 2        // altura en reposo: un punto
const ATTACK_TAU = 0.045  // sube de golpe…
const RELEASE_TAU = 0.19  // …y cae despacio, como un vúmetro
const WAVE_BPM = 112
const WAVE_FPS_SAVE = 24  // en ahorro de energía se dibuja a menos frames

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

function coverCacheName(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = (Math.imul(hash, 31) + url.charCodeAt(i)) | 0
  const ext = (url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || "img").toLowerCase()
  return `c${(hash >>> 0).toString(16)}.${ext}`
}

/** Reproductor mínimo de Spotify para el centro de la barra. */
export default function SpotifyNowPlaying() {
  const hypr = AstalHyprland.get_default()
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />

  const [visible, setVisible] = createState(false)
  const [title, setTitle] = createState("")
  const [artist, setArtist] = createState("")

  let destroyed = false
  let coverInput = "\0"
  let pollTimer: number | null = null
  let currentSpotify: any = null
  let spotifyPlaying = false

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
      setArtworkFile(raw.startsWith("file://") ? raw.slice(7) : raw)
      return
    }

    const dir = `${GLib.get_user_cache_dir()}/ags/media`
    const path = `${dir}/${coverCacheName(raw)}`
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
      setArtworkFile(path)
      return
    }

    GLib.mkdir_with_parents(dir, 0o700)
    execAsync(["curl", "-sfL", "-o", path, raw])
      .then(() => { if (coverInput === raw) setArtworkFile(path) })
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
    if (carry < (powerSaveActive.get() ? 1 / WAVE_FPS_SAVE : 0)) return true
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
    setVisible(Boolean(spotify && (spotify.title || spotify.artist)))

    if (!spotify) {
      restWave()
      syncWave()
      waveform.queue_draw()
      return
    }

    setTitle(spotify.title || "Sin título")
    setArtist(spotify.artist || "Artista desconocido")
    resolveArtwork(spotify.cover_art || spotify.art_url || "")
    syncWave()
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

  return (
    <box
      visible={visible}
      cssClasses={["bar-spotify"]}
      spacing={3}
      valign={Gtk.Align.CENTER}
      $={(self: Gtk.Box) => self.connect("destroy", () => {
        destroyed = true
        if (pollTimer !== null) GLib.source_remove(pollTimer)
        if (tickId !== null) { waveform.remove_tick_callback(tickId); tickId = null }
        unsubBar()
      })}
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
          spotifyPlaying = !spotifyPlaying
          syncWave()
          currentSpotify.play_pause()
        }}
      />
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onReleased={focusSpotify}
      />
    </box>
  )
}
