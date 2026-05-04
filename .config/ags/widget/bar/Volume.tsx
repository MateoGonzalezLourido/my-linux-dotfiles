import AstalWp from "gi://AstalWp"
import { createBinding } from "ags"
import { Gtk } from "ags/gtk4"

function volIcon(v: number, muted: boolean) {
  if (muted || v === 0) return "󰝟"
  if (v < 0.33)         return "󰕿"
  if (v < 0.66)         return "󰖀"
  return "󰕾"
}

export default function Volume() {
  const wp      = AstalWp.get_default()
  const speaker = wp?.audio?.defaultSpeaker
  if (!speaker) return (<box />)

  const vol   = createBinding(speaker, "volume")
  const muted = createBinding(speaker, "mute")

  return (
    <button
      cssClasses={muted((m) => m ? ["bt-muted"] : ["bt-normal"])}
      onClicked={() => { speaker.mute = !speaker.mute }}
    >
      <label
        cssClasses={muted((m) => m ? ["icon-muted"] : ["icon-normal"])}
        label={vol((v) => volIcon(v, speaker.mute))}
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

