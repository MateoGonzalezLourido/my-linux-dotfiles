import AstalWp from "gi://AstalWp"
import { createState } from "ags"
import { Gtk, Gdk } from "ags/gtk4"
import { barVisible, widgetsRefresh } from "../state"

const HEADSET_ICON = "󰋋"   // nf-md-headphones

// ¿La salida por defecto son auriculares/cascos (BT o cable)?
//
// Por cable NO basta con mirar el sink. Esto asumía el perfil UCM "HiFi" (cada
// salida es un sink propio, con "Headphones" en el node.name), pero con el perfil
// ALSA clásico —el de esta máquina— altavoces y auriculares COMPARTEN un único
// sink cuyos campos son siempre genéricos (`name` null, `icon`
// "audio-card-analog-pci", `description` "Audio Interno Estéreo analógico"): al
// enchufar el jack no cambia ninguno de los tres, cambia el *puerto activo* del
// dispositivo, que Astal expone como `route` ("analog-output-headphones" /
// "Auriculares"). Sin mirar la ruta activa, el cable no se detectaba nunca.
//
// Por BT sí lo delata el endpoint (WirePlumber marca el icono "audio-headset"/
// "audio-headphones"), así que la búsqueda une icon + name + description + ruta
// activa para cubrir ambos casos. Ojo: la ruta ACTIVA (`route`), no la lista
// `routes` — ahí los auriculares siguen figurando aunque suene por los altavoces.
function isHeadset(s: AstalWp.Endpoint | null): boolean {
  if (!s) return false
  const route = s.route
  const hay = `${s.icon ?? ""} ${s.name ?? ""} ${s.description ?? ""} ` +
              `${route?.name ?? ""} ${route?.description ?? ""}`
  return /head(set|phone)|auric|earbud|earphone|hands[-_ ]?free/.test(hay.toLowerCase())
}

const isMutedVol = (s: AstalWp.Endpoint) => s.mute || s.volume === 0

// Cascos silenciados: mostramos el mismo 󰋋 y le pintamos una diagonal encima
// (ver slashArea). El glifo propio "headphones-off" sale tofu en esta Meslo.
const isHeadsetMuted = (s: AstalWp.Endpoint | null) => !!s && isHeadset(s) && isMutedVol(s)

function speakerIcon(s: AstalWp.Endpoint | null): string {
  if (!s) return "󰝟"
  const head = isHeadset(s)
  if (isMutedVol(s)) return head ? HEADSET_ICON : "󰝟"   // 󰋋 (se tacha con la diagonal)
  if (head) return HEADSET_ICON
  if (s.volume < 0.25) return "󰕿"
  if (s.volume < 0.50) return "󰖀"
  return "󰕾"
}

export default function Volume() {
  const wp = AstalWp.get_default()
  if (!wp?.audio) return (<box />)
  const audio = wp.audio

  let speaker: AstalWp.Endpoint | null = audio.defaultSpeaker ?? null

  const [icon, setIcon]   = createState(speakerIcon(speaker))
  const [appearance, setAppearance] = createState(
    speaker ? (speaker.mute ? "muted" : "normal") : "no-output",
  )
  const [tooltip, setTooltip] = createState(
    speaker ? `${Math.round(speaker.volume * 100)}` : "Sin dispositivo de salida",
  )
  const [slashed, setSlashed] = createState(isHeadsetMuted(speaker))

  // Diagonal (esquina inferior-izq → superior-der) sobre el icono de cascos.
  // Trazo con "recorte": primero una línea del color del bar (efecto de corte) y
  // encima la línea clara, para que se lea nítida sobre el glifo.
  const slashArea = new Gtk.DrawingArea()
  slashArea.set_can_target(false)          // no roba clic/scroll del botón
  slashArea.set_halign(Gtk.Align.FILL)
  slashArea.set_valign(Gtk.Align.FILL)
  slashArea.set_visible(slashed.get())
  slashArea.set_draw_func((_a, cr, width, height) => {
    // Diagonal corta y centrada sobre el glifo (no de esquina a esquina).
    const cx = width / 2, cy = height / 2
    const r = Math.min(width, height) * 0.42    // media longitud del trazo
    const u = Math.SQRT1_2                       // dirección ↙→↗ normalizada
    const x0 = cx - r * u, y0 = cy + r * u, x1 = cx + r * u, y1 = cy - r * u
    // Banda diagonal como paralelogramo relleno (evita depender de stroke).
    const band = (half: number) => {
      const dx = x1 - x0, dy = y1 - y0
      const len = Math.hypot(dx, dy) || 1
      const nx = (-dy / len) * half, ny = (dx / len) * half
      cr.moveTo(x0 + nx, y0 + ny)
      cr.lineTo(x1 + nx, y1 + ny)
      cr.lineTo(x1 - nx, y1 - ny)
      cr.lineTo(x0 - nx, y0 - ny)
      cr.closePath()
      cr.fill()
    }
    // recorte con el color del bar (#08080c) y encima la línea clara
    cr.setSourceRGBA(8 / 255, 8 / 255, 12 / 255, 1);          band(1.5)
    cr.setSourceRGBA(226 / 255, 226 / 255, 226 / 255, 0.9);   band(0.8)
  })
  slashed.subscribe(() => { slashArea.set_visible(slashed.get()); slashArea.queue_draw() })

  const sync = () => {
    setIcon(speakerIcon(speaker))
    setAppearance(speaker ? (speaker.mute ? "muted" : "normal") : "no-output")
    setTooltip(speaker ? `${Math.round(speaker.volume * 100)}` : "Sin dispositivo de salida")
    setSlashed(isHeadsetMuted(speaker))
  }

  // Cachea con el bar oculto: no re-renderiza, mantiene el último estado.
  const update = () => { if (!barVisible.get()) return; sync() }

  // El altavoz por defecto puede cambiar (auriculares, BT, cambio de salida en QS).
  // Hay que re-enganchar las señales al nuevo dispositivo y actualizar la referencia
  // `speaker`: si no, el icono quedaría del dispositivo viejo y —peor— el clic/scroll
  // controlaría el volumen del dispositivo equivocado. La referencia se actualiza
  // siempre (para las interacciones); el render respeta barVisible vía update().
  let volId = 0, muteId = 0, iconId = 0, descId = 0, routeId = 0
  const bindSpeaker = (s: AstalWp.Endpoint | null) => {
    if (speaker && volId) {
      speaker.disconnect(volId); speaker.disconnect(muteId)
      speaker.disconnect(iconId); speaker.disconnect(descId)
      speaker.disconnect(routeId)
    }
    speaker = s
    volId = muteId = iconId = descId = routeId = 0
    if (speaker) {
      volId  = speaker.connect("notify::volume", update)
      muteId = speaker.connect("notify::mute",   update)
      // notify::icon / ::description delatan los cascos BT y su poblado tardío en
      // el arranque, pero NO el jack: ahí el sink no cambia (ver isHeadset).
      iconId = speaker.connect("notify::icon",        update)
      descId = speaker.connect("notify::description", update)
      // notify::route es EL evento del cable — el único que se emite al enchufar o
      // desenchufar el jack cuando el puerto cambia sin cambiar de sink. Sin esto,
      // isHeadset ya vería la ruta correcta pero nadie la volvería a leer: el icono
      // se quedaría congelado hasta el siguiente cambio de volumen.
      routeId = speaker.connect("notify::route", update)
    }
    update()
  }
  bindSpeaker(speaker)

  audio.connect("notify::default-speaker", () => bindSpeaker(audio.defaultSpeaker ?? null))

  // Al arrancar, WirePlumber puede no haber poblado aún icon/name/description del
  // endpoint, y además barVisible es false los primeros ~2s (update() se ignora),
  // así que la detección de cascos fallaba hasta el primer hover. Forzamos varios
  // sync() diferidos —sync() no está gateado por barVisible— para fijar el estado
  // correcto desde el inicio.
  setTimeout(sync, 400)
  setTimeout(sync, 1200)
  setTimeout(sync, 3000)

  // Al volver visible, sincronizar con el estado real del hardware.
  // gnim invoca el callback sin argumentos → hay que leer .get().
  widgetsRefresh.subscribe(() => { if (widgetsRefresh.get()) sync() })

  const toggleMute = () => { if (speaker) speaker.mute = !speaker.mute }

  return (
    <button
      cssClasses={appearance((state) => state === "no-output"
        ? ["volume", "no-output"]
        : state === "muted" ? ["volume", "bt-muted"] : ["volume"])}
      tooltipText={tooltip}
      onClicked={toggleMute}
    >
      <Gtk.GestureClick
        button={Gdk.BUTTON_SECONDARY}
        onPressed={toggleMute}
      />
      <Gtk.Overlay $={(self) => { self.add_overlay(slashArea) }}>
        <label
          cssClasses={appearance((state) => state === "muted" ? ["icon-muted"] : [])}
          label={icon}
        />
      </Gtk.Overlay>
      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL}
        onScroll={(_self, _dx, dy) => {
          if (!speaker) return
          speaker.volume = Math.max(0, Math.min(1.0, speaker.volume - dy * 0.05))
        }}
      />
    </button>
  )
}
