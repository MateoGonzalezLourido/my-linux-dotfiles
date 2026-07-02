import AstalWp from "gi://AstalWp"
import { createState } from "ags"
import { Gtk, Gdk } from "ags/gtk4"
import { showPixelVolOSD, barVisible, widgetsRefresh } from "../state"

function volIcon(v: number, muted: boolean) {
  if (muted || v === 0) return "󰝟"
  if (v < 0.25) return "󰕿"
  if (v < 0.50) return "󰖀"
  return "󰕾"
}

export default function Volume() {
  const wp = AstalWp.get_default()
  if (!wp?.audio) return (<box />)
  const audio = wp.audio

  let speaker = audio.defaultSpeaker
  if (!speaker) return (<box />)

  const [icon, setIcon]   = createState(volIcon(speaker.volume, speaker.mute))
  const [muted, setMuted] = createState(speaker.mute)
  const [tooltip, setTooltip] = createState(`${Math.round(speaker.volume * 100)}`)

  const sync = () => {
    if (!speaker) return
    setIcon(volIcon(speaker.volume, speaker.mute))
    setMuted(speaker.mute)
    setTooltip(`${Math.round(speaker.volume * 100)}`)
  }

  // Cachea con el bar oculto: no re-renderiza, mantiene el último estado.
  const update = () => { if (!barVisible.get()) return; sync() }

  // El altavoz por defecto puede cambiar (auriculares, BT, cambio de salida en QS).
  // Hay que re-enganchar las señales al nuevo dispositivo y actualizar la referencia
  // `speaker`: si no, el icono quedaría del dispositivo viejo y —peor— el clic/scroll
  // controlaría el volumen del dispositivo equivocado. La referencia se actualiza
  // siempre (para las interacciones); el render respeta barVisible vía update().
  let volId = 0, muteId = 0
  const bindSpeaker = (s: AstalWp.Endpoint | null) => {
    if (speaker && volId) { speaker.disconnect(volId); speaker.disconnect(muteId) }
    speaker = s
    volId = muteId = 0
    if (speaker) {
      volId  = speaker.connect("notify::volume", update)
      muteId = speaker.connect("notify::mute",   update)
    }
    update()
  }
  bindSpeaker(speaker)

  audio.connect("notify::default-speaker", () => bindSpeaker(audio.defaultSpeaker))

  // Al volver visible, sincronizar con el estado real del hardware.
  // gnim invoca el callback sin argumentos → hay que leer .get().
  widgetsRefresh.subscribe(() => { if (widgetsRefresh.get()) sync() })

  const toggleMute = () => { if (speaker) { speaker.mute = !speaker.mute; showPixelVolOSD() } }

  return (
    <button
      cssClasses={muted((m) => m ? ["volume", "bt-muted"] : ["volume"])}
      tooltipText={tooltip}
      onClicked={toggleMute}
    >
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onPressed={toggleMute}
      />
      <label
        cssClasses={muted((m) => m ? ["icon-muted"] : [])}
        label={icon}
      />
      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL}
        onScroll={(_self, _dx, dy) => {
          if (!speaker) return
          speaker.volume = Math.max(0, Math.min(1.5, speaker.volume - dy * 0.05))
          showPixelVolOSD()
        }}
      />
    </button>
  )
}
