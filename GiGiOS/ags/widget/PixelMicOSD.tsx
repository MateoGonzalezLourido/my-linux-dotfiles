import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import AstalWp from "gi://AstalWp"
import { barVisible, pixelMicOsdVisible, showPixelMicOSD } from "./state"

// ── Mic sprites 16×16 ─────────────────────────────────────────────────────────
// 0=transparent  1=purple(body)  3=indicator(cyan dots / red mute line)

const M = 1, D = 3

function cp(s: number[][]): number[][] { return s.map(r => [...r]) }

// Base mic: capsule outline + neck + base
const MIC_BASE: number[][] = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,M,M,M,M,M,0,0,0,0,0,0],
  [0,0,0,0,M,0,0,0,0,0,M,0,0,0,0,0],
  [0,0,0,0,M,0,0,0,0,0,M,0,0,0,0,0],
  [0,0,0,0,M,0,0,0,0,0,M,0,0,0,0,0],
  [0,0,0,0,M,0,0,0,0,0,M,0,0,0,0,0],
  [0,0,0,0,M,0,0,0,0,0,M,0,0,0,0,0],
  [0,0,0,0,M,0,0,0,0,0,M,0,0,0,0,0],
  [0,0,0,0,M,0,0,0,0,0,M,0,0,0,0,0],
  [0,0,0,0,0,M,M,M,M,M,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,M,M,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,M,M,0,0,0,0,0,0,0],
  [0,0,0,M,M,M,M,M,M,M,M,M,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
]

// Active frame 1: single center dot inside capsule
const MIC_ACTIVE_F1 = cp(MIC_BASE)
MIC_ACTIVE_F1[5][7] = D

// Active frame 2: two dots (top/bottom of center)
const MIC_ACTIVE_F2 = cp(MIC_BASE)
MIC_ACTIVE_F2[4][7] = D
MIC_ACTIVE_F2[6][7] = D

// Mute: red diagonal line across capsule (top-left → bottom-right)
const MIC_MUTE = cp(MIC_BASE)
;[[2,4],[3,5],[4,6],[5,7],[6,8],[7,9],[8,10]].forEach(([r,c]) => {
  MIC_MUTE[r][c] = D
})

function getMicSprite(v: number, m: boolean, f: number): number[][] {
  if (m)        return MIC_MUTE
  if (v < 0.30) return MIC_BASE
  return f === 0 ? MIC_ACTIVE_F1 : MIC_ACTIVE_F2
}

// ── Helpers (identical to PixelVolumeOSD) ────────────────────────────────────
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
  return VU_COLORS[Math.min(19, Math.floor(v * 20))] ?? '#9f40ff'
}

// ── Identical dimensions as PixelVolumeOSD ────────────────────────────────────
const SPRITE_SCALE = 2
const BAR_W = 7, BAR_GAP = 2
const BAR_H = 16

// ── Component ─────────────────────────────────────────────────────────────────
export default function PixelMicOSD(gdkmonitor: Gdk.Monitor) {
  const wp = AstalWp.get_default()
  const mic = wp?.audio?.defaultMicrophone
  if (!mic) return <window visible={false} application={app} />

  const [vol, setVol]     = createState(mic.volume)
  const [muted, setMuted] = createState(mic.mute)
  const [frame, setFrame] = createState(0)

  mic.connect("notify::volume", () => { setVol(mic.volume);  showPixelMicOSD() })
  mic.connect("notify::mute",   () => { setMuted(mic.mute);  showPixelMicOSD() })

  setInterval(() => setFrame(f => 1 - f), 200)

  // ── Sprite ─────────────────────────────────────────────────────────────────
  const spriteArea = new Gtk.DrawingArea()
  spriteArea.set_content_width(16 * SPRITE_SCALE)
  spriteArea.set_content_height(16 * SPRITE_SCALE)
  spriteArea.set_draw_func((_w: any, cr: any) => {
    const isMuted = muted.get()
    getMicSprite(vol.get(), isMuted, frame.get()).forEach((row, y) => {
      row.forEach((px, x) => {
        if (!px) return
        const color = px === 1
          ? '#9f40ff'                               // purple body
          : isMuted ? '#ff2020' : '#00ffcc'         // red diagonal / cyan dots
        const [r, g, b] = hex2rgb(color)
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
      name="pixel-mic-osd"
      visible={pixelMicOsdVisible}
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
            mic.volume = Math.max(0, Math.min(1.5, mic.volume - dy * 0.05))
          }}
        />

        {/* Row 1: title + sprite */}
        <box orientation={Gtk.Orientation.HORIZONTAL} spacing={6} valign={Gtk.Align.CENTER}>
          <label
            cssClasses={["pv-title"]}
            label="// MIC //"
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
            onClicked={() => { mic.mute = !mic.mute }}
          >
            <label label="MUTE" cssClasses={["pv-mute-label"]} />
          </button>
        </box>
      </box>
    </window>
  )
}
