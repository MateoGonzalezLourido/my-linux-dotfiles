import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import AstalWp from "gi://AstalWp"
import { barVisible, pixelVolOsdVisible, showPixelVolOSD } from "./state"

// ── Pixel sprites 16×16 ───────────────────────────────────────────────────────
// 0=transparent  1=orange(body)  2=cyan(wave)  3=red(mute X)
const S = 1, W = 2, X = 3

function cp(s: number[][]): number[][] { return s.map(r => [...r]) }

const BASE: number[][] = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,S,S,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,S,S,S,0,0,0,0,0,0,0,0,0,0],
  [0,0,S,S,S,S,S,0,0,0,0,0,0,0,0,0],
  [0,S,S,S,S,S,S,S,0,0,0,0,0,0,0,0],
  [S,S,S,S,S,S,S,S,0,0,0,0,0,0,0,0],
  [S,S,S,S,S,S,S,S,0,0,0,0,0,0,0,0],
  [S,S,S,S,S,S,S,S,0,0,0,0,0,0,0,0],
  [S,S,S,S,S,S,S,S,0,0,0,0,0,0,0,0],
  [0,S,S,S,S,S,S,S,0,0,0,0,0,0,0,0],
  [0,0,S,S,S,S,S,0,0,0,0,0,0,0,0,0],
  [0,0,0,S,S,S,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,S,S,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
]

const SPRITE_LOW = cp(BASE)

const SPRITE_MED = cp(BASE)
;[[3,9],[4,9],[5,10],[6,10],[7,10],[8,10],[9,10],[10,10],[11,9],[12,9]].forEach(([r,c]) => {
  SPRITE_MED[r][c] = W
})

const SPRITE_HI_F1 = cp(SPRITE_MED)
;[[2,13],[3,13],[4,13],[5,14],[6,14],[7,14],[8,14],[9,14],[10,13],[11,13],[12,13],[13,13]].forEach(([r,c]) => {
  if (SPRITE_HI_F1[r]) SPRITE_HI_F1[r][c] = W
})

const SPRITE_HI_F2 = cp(SPRITE_MED)
;[[1,12],[2,12],[3,13],[4,13],[5,14],[6,14],[7,14],[8,14],[9,13],[10,13],[11,12],[12,12]].forEach(([r,c]) => {
  if (SPRITE_HI_F2[r]) SPRITE_HI_F2[r][c] = W
})

const SPRITE_MUTE = cp(BASE)
;[[4,9],[5,10],[6,11],[7,12],[8,12],[9,11],[10,10],[11,9]].forEach(([r,c]) => { SPRITE_MUTE[r][c] = X })
;[[4,12],[5,11],[6,10],[7,9],[8,9],[9,10],[10,11],[11,12]].forEach(([r,c]) => { SPRITE_MUTE[r][c] = X })

// ── Helpers ───────────────────────────────────────────────────────────────────
function hex2rgb(h: string): [number, number, number] {
  return [
    parseInt(h.slice(1,3), 16) / 255,
    parseInt(h.slice(3,5), 16) / 255,
    parseInt(h.slice(5,7), 16) / 255,
  ]
}

const VU_COLORS = [
  '#00c8ff','#00d4f0','#00dfe0','#00e8c8','#00f0a0',
  '#20f080','#60f060','#a0f040','#d4f020','#f0e000',
  '#f8c800','#ffa000','#ff7800','#ff5000','#ff2800',
  '#ff0080','#df00a0','#bf00c0','#9f00e0','#7f00ff',
]

function activeColor(v: number): string {
  return VU_COLORS[Math.min(19, Math.floor(v * 20))] ?? '#ff8800'
}

function getSprite(v: number, m: boolean, f: number): number[][] {
  if (m)        return SPRITE_MUTE
  if (v < 0.25) return SPRITE_LOW
  if (v < 0.60) return SPRITE_MED
  return f === 0 ? SPRITE_HI_F1 : SPRITE_HI_F2
}

// ── Dimensions ───────────────────────────────────────────────────────────────
const SPRITE_SCALE = 2          // 16px × 2 = 32px sprite
const BAR_W = 7, BAR_GAP = 2    // 7*20 + 2*19 = 178px VU width
const BAR_H = 16                // bar height

// ── Component ─────────────────────────────────────────────────────────────────
export default function PixelVolumeOSD(gdkmonitor: Gdk.Monitor) {
  const wp = AstalWp.get_default()
  const speaker = wp?.audio?.defaultSpeaker
  if (!speaker) return <window visible={false} application={app} />

  const [vol, setVol]     = createState(speaker.volume)
  const [muted, setMuted] = createState(speaker.mute)
  const [frame, setFrame] = createState(0)

  speaker.connect("notify::volume", () => { setVol(speaker.volume);  showPixelVolOSD() })
  speaker.connect("notify::mute",   () => { setMuted(speaker.mute);  showPixelVolOSD() })

  setInterval(() => setFrame(f => 1 - f), 160)

  // ── Sprite (32×32) ─────────────────────────────────────────────────────────
  const spriteArea = new Gtk.DrawingArea()
  spriteArea.set_content_width(16 * SPRITE_SCALE)
  spriteArea.set_content_height(16 * SPRITE_SCALE)
  spriteArea.set_draw_func((_w: any, cr: any) => {
    getSprite(vol.get(), muted.get(), frame.get()).forEach((row, y) => {
      row.forEach((px, x) => {
        if (!px) return
        const [r, g, b] = hex2rgb(px === 1 ? '#ff8800' : px === 2 ? '#00c8ff' : '#ff2020')
        cr.setSourceRGB(r, g, b)
        cr.rectangle(x * SPRITE_SCALE, y * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE)
        cr.fill()
      })
    })
  })
  vol.subscribe   (() => spriteArea.queue_draw())
  muted.subscribe (() => spriteArea.queue_draw())
  frame.subscribe (() => spriteArea.queue_draw())

  // ── VU meter ───────────────────────────────────────────────────────────────
  const vuW = 20 * BAR_W + 19 * BAR_GAP
  const vuArea = new Gtk.DrawingArea()
  vuArea.set_content_width(vuW)
  vuArea.set_content_height(BAR_H)
  vuArea.set_draw_func((_w: any, cr: any) => {
    const active = muted.get() ? 0 : Math.round(vol.get() * 20)
    VU_COLORS.forEach((hex, i) => {
      const x = i * (BAR_W + BAR_GAP)
      if (i < active) {
        const [r, g, b] = hex2rgb(hex)
        cr.setSourceRGBA(r, g, b, 0.22)
        cr.rectangle(x - 1, 0, BAR_W + 2, BAR_H)
        cr.fill()
        cr.setSourceRGB(r, g, b)
        cr.rectangle(x, 1, BAR_W, BAR_H - 2)
        cr.fill()
      } else {
        cr.setSourceRGBA(1, 1, 1, 0.07)
        cr.rectangle(x, 1, BAR_W, BAR_H - 2)
        cr.fill()
      }
    })
  })
  vol.subscribe   (() => vuArea.queue_draw())
  muted.subscribe (() => vuArea.queue_draw())

  return (
    <window
      name="pixel-vol-osd"
      visible={pixelVolOsdVisible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      anchor={Astal.WindowAnchor.TOP}
      application={app}
      cssClasses={["pv-osd-window"]}
      marginTop={barVisible((v) => v ? 44 : 8)}
    >
      <box
        cssClasses={["pv-container"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
      >
        <Gtk.EventControllerScroll
          flags={Gtk.EventControllerScrollFlags.VERTICAL}
          onScroll={(_s, _dx, dy) => {
            speaker.volume = Math.max(0, Math.min(1.5, speaker.volume - dy * 0.05))
          }}
        />

        {/* Row 1: title + sprite */}
        <box orientation={Gtk.Orientation.HORIZONTAL} spacing={6} valign={Gtk.Align.CENTER}>
          <label
            cssClasses={["pv-title"]}
            label="// VOLUME //"
            hexpand
            halign={Gtk.Align.START}
            valign={Gtk.Align.CENTER}
          />
          {spriteArea}
        </box>

        {/* Row 2: VU bars */}
        {vuArea}

        {/* Row 3: percentage + mute */}
        <box orientation={Gtk.Orientation.HORIZONTAL} valign={Gtk.Align.CENTER}>
          <box hexpand halign={Gtk.Align.START} spacing={2} valign={Gtk.Align.BASELINE_FILL}>
            <label
              cssClasses={["pv-percent"]}
              css={vol((v) => { const c = activeColor(v); return `color:${c};` })}
              label={vol((v) => `${Math.round(v * 100)}`)}
            />
            <label
              cssClasses={["pv-percent-sym"]}
              css={vol((v) => `color:${activeColor(v)};`)}
              label="%"
            />
          </box>
          <button
            cssClasses={muted((m) => m ? ["pv-mute-btn", "pv-muting"] : ["pv-mute-btn"])}
            halign={Gtk.Align.END}
            valign={Gtk.Align.CENTER}
            onClicked={() => { speaker.mute = !speaker.mute }}
          >
            <label label="MUTE" cssClasses={["pv-mute-label"]} />
          </button>
        </box>
      </box>
    </window>
  )
}
