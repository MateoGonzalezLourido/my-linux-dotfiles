import { createState } from "ags"
import { execAsync } from "ags/process"
import { Gdk, Gtk } from "ags/gtk4"
import AstalMpris from "gi://AstalMpris"
import GdkPixbuf from "gi://GdkPixbuf"
import GLib from "gi://GLib"
import cairo from "gi://cairo"

const ART_SIZE = 30

function coverCacheName(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = (Math.imul(hash, 31) + url.charCodeAt(i)) | 0
  const ext = (url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || "img").toLowerCase()
  return `c${(hash >>> 0).toString(16)}.${ext}`
}

/** Reproductor mínimo de Spotify para el centro de la barra. */
export default function SpotifyNowPlaying() {
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />

  const [visible, setVisible] = createState(false)
  const [title, setTitle] = createState("")
  const [artist, setArtist] = createState("")

  let destroyed = false
  let coverInput = "\0"
  let pollTimer: number | null = null
  let waveTimer: number | null = null
  let wavePhase = 0
  let currentSpotify: any = null
  let spotifyPlaying = false

  const artPicture = new Gtk.Picture({
    contentFit: Gtk.ContentFit.COVER,
    canShrink: true,
    hexpand: true,
    vexpand: true,
  })

  // La carátula se carga con resolución HiDPI, pero este contenedor limita su
  // tamaño lógico a 30×30 para que la textura grande no ensanche la barra.
  const artCap = new Gtk.ScrolledWindow()
  artCap.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.NEVER)
  artCap.set_propagate_natural_width(false)
  artCap.set_propagate_natural_height(false)
  artCap.set_min_content_width(ART_SIZE)
  artCap.set_max_content_width(ART_SIZE)
  artCap.set_min_content_height(ART_SIZE)
  artCap.set_max_content_height(ART_SIZE)
  artCap.set_child(artPicture)

  const setArtworkFile = (path: string) => {
    if (destroyed) return
    try {
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, ART_SIZE * 3, ART_SIZE * 3, true)
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
    const base = [2, 3, 6, 11, 18, 23, 15, 20, 16, 12, 8, 5, 3, 2, 2]
    const gap = width / (base.length + 1)
    cr.setSourceRGBA(0.88, 0.88, 0.86, 0.92)
    cr.setLineWidth(2)
    cr.setLineCap(cairo.LineCap.ROUND)

    base.forEach((naturalHeight, index) => {
      const pulse = naturalHeight <= 2
        ? 1
        : 0.80 + 0.20 * Math.sin(wavePhase + index * 0.38)
      const barHeight = spotifyPlaying ? Math.max(2, naturalHeight * pulse) : 2
      const x = gap * (index + 1)
      cr.moveTo(x, (height - barHeight) / 2)
      cr.lineTo(x, (height + barHeight) / 2)
      cr.stroke()
    })
  })

  const startWave = () => {
    if (waveTimer !== null) return
    waveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
      wavePhase += 0.16
      waveform.queue_draw()
      return GLib.SOURCE_CONTINUE
    })
  }

  const stopWave = () => {
    if (waveTimer === null) return
    GLib.source_remove(waveTimer)
    waveTimer = null
  }

  const update = () => {
    const spotify = mpris.players.find((player: any) =>
      String(player.bus_name || "").toLowerCase().includes("spotify"))
    const isPlaying = spotify?.playback_status === AstalMpris.PlaybackStatus.PLAYING
    currentSpotify = spotify || null
    spotifyPlaying = isPlaying
    waveform.queue_draw()
    setVisible(Boolean(spotify && (spotify.title || spotify.artist)))

    if (!spotify) {
      stopWave()
      return
    }

    setTitle(spotify.title || "Sin título")
    setArtist(spotify.artist || "Artista desconocido")
    resolveArtwork(spotify.cover_art || spotify.art_url || "")
    if (isPlaying) startWave()
    else stopWave()
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
        stopWave()
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
          waveform.queue_draw()
          if (spotifyPlaying) startWave()
          else stopWave()
          currentSpotify.play_pause()
        }}
      />
    </box>
  )
}
