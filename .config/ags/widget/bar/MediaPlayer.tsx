import AstalMpris from "gi://AstalMpris"
import { createBinding } from "ags"
import { Gtk } from "ags/gtk4"

export default function MediaPlayer() {
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />

  const players = createBinding(mpris, "players")

  return (
    <box
      name="mpris"
      cssClasses={["mpris-widget"]}
      visible={players((ps) => ps.length > 0)}
      valign={Gtk.Align.CENTER}
      spacing={10}
    >
      <box
        cssClasses={["album-art"]}
        css={players((ps) => {
          const art = ps[0]?.coverArt
          return art ? `background-image: url('${art}');` : ""
        })}
      />
      
      <box
        cssClasses={["title-scroll-container"]}
        valign={Gtk.Align.CENTER}
        overflow={Gtk.Overflow.HIDDEN}
        widthRequest={140}
        hexpand={false}
      >
        <label
          cssClasses={["title-text"]}
          label={players((ps) => {
            const p = ps[0]
            if (!p) return ""
            const t = p.title || "Unknown"
            const a = p.artist || ""
            const al = p.album || ""
            
            let text = t
            if (a && !t.includes(a)) text += ` · ${a}`
            if (al && !t.includes(al) && !text.includes(al)) text += ` · ${al}`
            
            return `${text}      ${text}      `
          })}
          halign={Gtk.Align.START}
          hexpand={false}
          ellipsize={0}
        />
      </box>

      <box cssClasses={["controls"]} spacing={4} valign={Gtk.Align.CENTER}>
        <button cssClasses={["btn-add"]} label="⊕" />
        <button
          cssClasses={["prev"]}
          onClicked={() => mpris.players[0]?.previous()}
          label="⏮"
        />
        <button
          cssClasses={["play-pause"]}
          onClicked={() => mpris.players[0]?.playPause()}
          label={players((ps) => 
            ps[0]?.playbackStatus === AstalMpris.PlaybackStatus.PLAYING ? "⏸" : "▶"
          )}
        />
        <button
          cssClasses={["next"]}
          onClicked={() => mpris.players[0]?.next()}
          label="⏭"
        />
      </box>
    </box>
  )
}
