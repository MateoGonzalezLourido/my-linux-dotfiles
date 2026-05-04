import AstalWp from "gi://AstalWp"
import { createState } from "ags"
import { Gtk, Gdk } from "ags/gtk4"

function volIcon(v: number, muted: boolean) {
  if (muted || v === 0) return "󰝟"
  if (v < 0.20)         return "󰕿"
  if (v < 0.40)         return "󰖀"
  if (v < 0.60)         return "󰕾"
  if (v < 0.80)         return ""
  return ""
}

export default function Volume() {
  const wp      = AstalWp.get_default()
  const speaker = wp?.audio?.defaultSpeaker
  if (!speaker) return (<box />)

  const [icon, setIcon] = createState(volIcon(speaker.volume, speaker.mute))
  const [muted, setMuted] = createState(speaker.mute)

  const updateVars = () => {
    setIcon(volIcon(speaker.volume, speaker.mute))
    setMuted(speaker.mute)
  }

  speaker.connect("notify::volume", updateVars)
  speaker.connect("notify::mute", updateVars)

  return (
    <button
      cssClasses={muted((m) => m ? ["bt-muted"] : ["bt-normal"])}
    >
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onPressed={() => { speaker.mute = !speaker.mute }}
      />
      <label
        cssClasses={muted((m) => m ? ["icon-muted"] : ["icon-normal"])}
        label={icon}
      />
      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL}
        onScroll={(_self, _dx, dy) => {
          speaker.volume = Math.max(0, Math.min(1, speaker.volume - dy * 0.05))
        }}
      />
    </button>
  )
}

