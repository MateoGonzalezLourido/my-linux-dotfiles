import AstalWp from "gi://AstalWp"
import { createBinding } from "ags"
import { Gtk } from "ags/gtk4"

function volIcon(v: number, muted: boolean) {
  if (muted || v === 0) return "󰝟"
  if (v < 0.33)         return "󰕿"
  if (v < 0.66)         return "󰖀"
  return "󰕾"
}

const BTN = "border: none; padding: 0 6px; margin: 0 1px;"
const BTN_MUTED = "border: none; padding: 0 6px; margin: 0 1px;"
const ICON_CSS = "font-family: 'JetBrainsMono Nerd Font'; font-size: 14px; color: #e2e2e2;"
const ICON_MUTED = "font-family: 'JetBrainsMono Nerd Font'; font-size: 14px; color: rgba(226,226,226,0.45);"

export default function Volume() {
  const wp      = AstalWp.get_default()
  const speaker = wp?.audio?.defaultSpeaker
  if (!speaker) return <box />

  const vol   = createBinding(speaker, "volume")
  const muted = createBinding(speaker, "mute")

  return (
    <button
      css={muted((m) => m ? BTN_MUTED : BTN)}
      onClicked={() => { speaker.mute = !speaker.mute }}
    >
      <label
        css={muted((m) => m ? ICON_MUTED : ICON_CSS)}
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

