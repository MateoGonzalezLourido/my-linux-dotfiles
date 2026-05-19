import AstalWp from "gi://AstalWp"
import { createState } from "ags"
import { Gtk, Gdk } from "ags/gtk4"
import { showPixelVolOSD } from "../state"

function volIcon(v: number, muted: boolean) {
  if (muted || v === 0) return "󰝟"
  if (v < 0.25) return "󰕿"
  if (v < 0.50) return "󰖀"
  if (v < 0.75) return "󰕾"
  return "󰕾"
}

export default function Volume() {
  const wp      = AstalWp.get_default()
  const speaker = wp?.audio?.defaultSpeaker
  if (!speaker) return (<box />)

  const [icon, setIcon]           = createState(volIcon(speaker.volume, speaker.mute))
  const [muted, setMuted]         = createState(speaker.mute)

  const update = () => {
    setIcon(volIcon(speaker.volume, speaker.mute))
    setMuted(speaker.mute)
  }

  speaker.connect("notify::volume", update)
  speaker.connect("notify::mute",   update)

  return (
    <button
      cssClasses={muted((m) => m ? ["volume", "bt-muted"] : ["volume"])}
      onClicked={() => { speaker.mute = !speaker.mute; showPixelVolOSD() }}
    >
      <label
        cssClasses={muted((m) => m ? ["icon-muted"] : [])}
        label={icon}
      />
      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL}
        onScroll={(_self, _dx, dy) => {
          speaker.volume = Math.max(0, Math.min(1.5, speaker.volume - dy * 0.05))
          showPixelVolOSD()
        }}
      />
    </button>
  )
}
