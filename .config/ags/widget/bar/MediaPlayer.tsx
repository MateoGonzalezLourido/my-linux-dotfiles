import AstalMpris from "gi://AstalMpris"
import { createBinding, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { gameActive } from "../state"

// ── Ad tracker ────────────────────────────────────────────────────────────────
let _lastAdId = ""
let _adIndex = 0

function isAd(p: AstalMpris.Player | undefined): boolean {
  return !!(p?.trackId?.includes(":ad:"))
}

function hasContent(p: AstalMpris.Player | undefined): boolean {
  return !!((p?.title ?? "").trim() || (p?.artist ?? "").trim())
}

function shouldShow(ps: AstalMpris.Player[]): boolean {
  const p = ps[0]
  return !!p && (isAd(p) || hasContent(p))
}

function getText(p: AstalMpris.Player | undefined): string {
  if (!p) return ""
  if (isAd(p)) {
    const id = p.trackId ?? "ad"
    if (id !== _lastAdId) { _lastAdId = id; _adIndex++ }
    return `󰖊  Anuncio ${_adIndex}`
  }
  _lastAdId = ""; _adIndex = 0
  const t = (p.title ?? "").trim()
  const a = (p.artist ?? "").trim()
  return a && !t.includes(a) ? `${t} · ${a}` : t
}

// Marquee: pad to fixed 28 chars so translateX(-245px) loops perfectly
// JetBrains Mono 12px ≈ 7.2px/char  →  (28+6) * 7.2 = 244.8px ≈ 245px
const MARQUEE_CHARS = 28
const MARQUEE_GAP   = "      " // 6 spaces

function marqueeLabel(p: AstalMpris.Player | undefined): string {
  const raw = getText(p)
  if (!raw) return ""
  const chunk = raw.length >= MARQUEE_CHARS
    ? raw.slice(0, MARQUEE_CHARS)
    : raw.padEnd(MARQUEE_CHARS)
  return `${chunk}${MARQUEE_GAP}${chunk}${MARQUEE_GAP}`
}

export default function MediaPlayer() {
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />

  const players = createBinding(mpris, "players")
  const [mprisVisible, setMprisVisible] = createState(false)

  const updateVisibility = () => {
    setMprisVisible(shouldShow(mpris.players) && !gameActive.get())
  }

  players.subscribe(updateVisibility)
  gameActive.subscribe(updateVisibility)

  // Initial update
  updateVisibility()

  return (
    <box
      cssClasses={["mpris-widget"]}
      visible={mprisVisible}
      valign={Gtk.Align.CENTER}
      halign={Gtk.Align.CENTER}
      hexpand={false}
      spacing={8}
    >

      {/* Texto — clip fijo, sin duplicación */}
      <box
        cssClasses={["title-scroll-container"]}
        valign={Gtk.Align.CENTER}
        overflow={Gtk.Overflow.HIDDEN}
        hexpand={false}
      >
        <label
          cssClasses={["title-text"]}
          label={players((ps) => marqueeLabel(ps[0]))}
          halign={Gtk.Align.START}
          hexpand={false}
          ellipsize={0}
        />
      </box>

      {/* Controles */}
      <box cssClasses={["controls"]} spacing={0} valign={Gtk.Align.CENTER} hexpand={false}>
        <button
          cssClasses={["prev"]}
          sensitive={players((ps) => !isAd(ps[0]))}
          onClicked={() => mpris.players[0]?.previous()}
          label="󰒮"
        />
        <button
          cssClasses={["play-pause"]}
          onClicked={() => mpris.players[0]?.playPause()}
          label={players((ps) =>
            ps[0]?.playbackStatus === AstalMpris.PlaybackStatus.PLAYING ? "󰏤" : "󰐊"
          )}
        />
        <button
          cssClasses={["next"]}
          onClicked={() => mpris.players[0]?.next()}
          label="󰒭"
        />
      </box>
    </box>
  )
}
