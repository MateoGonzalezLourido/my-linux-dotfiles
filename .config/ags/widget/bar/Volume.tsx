import AstalWp from "gi://AstalWp"
import { createState } from "ags"
import { Gtk, Gdk } from "ags/gtk4"
import { showPixelVolOSD, barVisible, widgetsRefresh } from "../state"

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

  const [icon, setIcon]   = createState(volIcon(speaker.volume, speaker.mute))
  const [muted, setMuted] = createState(speaker.mute)
  const [tooltip, setTooltip] = createState(`${Math.round(speaker.volume * 100)}`)

  const update = () => {
    if (!barVisible.get()) return
    setIcon(volIcon(speaker.volume, speaker.mute))
    setMuted(speaker.mute)
    setTooltip(`${Math.round(speaker.volume * 100)}`)
  }

  speaker.connect("notify::volume", update)
  speaker.connect("notify::mute",   update)

  // Al volver visible, sincronizar con el estado real del hardware
  widgetsRefresh.subscribe((v) => {
    if (v) {
      setIcon(volIcon(speaker.volume, speaker.mute))
      setMuted(speaker.mute)
      setTooltip(`${Math.round(speaker.volume * 100)}`)
    }
  })

  return (
    <button
      cssClasses={muted((m) => m ? ["volume", "bt-muted"] : ["volume"])}
      tooltipText={tooltip}
      onClicked={() => { speaker.mute = !speaker.mute; showPixelVolOSD() }}
    >
      <Gtk.GestureClick
        button={3}
        onPressed={() => { speaker.mute = !speaker.mute; showPixelVolOSD() }}
      />
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
