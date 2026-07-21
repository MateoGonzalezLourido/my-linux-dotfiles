import { onCleanup } from "ags"
import { Gtk } from "ags/gtk4"
import cairo from "gi://cairo"
import { powerSaveActive } from "../../../servicios/energia/powerState"
import { estadoSpotify } from "../../../servicios/multimedia/mpris"
import type { EstadoVisibilidadBarra } from "../visibilidad"

const BARRAS = 13
const TRAZO = 2.4
const MINIMO = 2
const ATAQUE = 0.045
const CAIDA = 0.19
const BPM = 112
const FPS_AHORRO = 24
const FPS_MAXIMO = 60

function ruidoDeterminista(numero: number): number {
  const seno = Math.sin(numero * 127.1 + 311.7) * 43758.5453
  return seno - Math.floor(seno)
}

type Banda = {
  ganancia: number
  velocidad: number
  grave: number
  fases: [number, number, number]
  nivel: number
}

function crearBandas(): Banda[] {
  return Array.from({ length: BARRAS }, (_, indice) => {
    const proporcion = indice / (BARRAS - 1)
    return {
      ganancia: (0.44 + 0.56 * Math.pow(1 - proporcion, 0.8)) * (0.82 + 0.32 * ruidoDeterminista(indice + 1)),
      velocidad: 1.15 + 2.7 * proporcion,
      grave: Math.pow(1 - proporcion, 1.7),
      fases: [
        ruidoDeterminista(indice + 7) * 6.283,
        ruidoDeterminista(indice + 31) * 6.283,
        ruidoDeterminista(indice + 91) * 6.283,
      ],
      nivel: 0,
    }
  })
}

/** Único estado que permanece por monitor: la animación depende de su visibilidad. */
export default function OndaSpotify({ visibilidad }: { visibilidad: EstadoVisibilidadBarra }) {
  const bandas = crearBandas()
  let energia = 0
  let tiempo = 0
  let ultimoFrameUs = 0
  let acumulado = 0
  let idTick: number | null = null
  let barraVisible = visibilidad.visible.get()
  let reproduciendo = estadoSpotify.get()?.reproduciendo ?? false

  const onda = new Gtk.DrawingArea({
    widthRequest: 54,
    heightRequest: 26,
    valign: Gtk.Align.CENTER,
  })
  onda.set_can_target(false)
  onda.set_draw_func((_area, cr, ancho, alto) => {
    const separacion = ancho / (BARRAS + 1)
    const recorrido = alto - TRAZO
    cr.setLineWidth(TRAZO)
    cr.setLineCap(cairo.LineCap.ROUND)

    bandas.forEach((banda, indice) => {
      const nivel = banda.nivel * energia
      const altura = MINIMO + (recorrido - MINIMO) * nivel
      const x = separacion * (indice + 1)
      cr.setSourceRGBA(0.88, 0.88, 0.86, 0.5 + 0.45 * nivel)
      cr.moveTo(x, (alto - altura) / 2)
      cr.lineTo(x, (alto + altura) / 2)
      cr.stroke()
    })
  })

  const reposar = () => {
    energia = 0
    acumulado = 0
    bandas.forEach((banda) => { banda.nivel = 0 })
  }

  const frame = (_widget: any, reloj: any): boolean => {
    const ahoraUs = reloj.get_frame_time()
    const transcurrido = ultimoFrameUs ? (ahoraUs - ultimoFrameUs) / 1e6 : 1 / 60
    ultimoFrameUs = ahoraUs
    acumulado += Math.min(0.1, transcurrido)
    if (acumulado < 1 / (powerSaveActive.get() ? FPS_AHORRO : FPS_MAXIMO)) return true
    const delta = acumulado
    acumulado = 0
    tiempo += delta

    const objetivo = reproduciendo ? 1 : 0
    energia += (objetivo - energia) * (1 - Math.exp(-delta / (reproduciendo ? 0.20 : 0.28)))
    const pulso = (tiempo / (60 / BPM)) % 4
    const bombo = Math.exp(-(pulso % 1) * 7) * (pulso < 1 ? 1 : 0.55)

    bandas.forEach((banda) => {
      const oscilacion = (
        0.55 * Math.sin(tiempo * banda.velocidad + banda.fases[0])
        + 0.30 * Math.sin(tiempo * banda.velocidad * 1.73 + banda.fases[1])
        + 0.15 * Math.sin(tiempo * banda.velocidad * 2.61 + banda.fases[2])
      ) / 0.72
      const normalizado = Math.min(1, Math.max(0, 0.5 + 0.5 * oscilacion))
      const perfil = normalizado * normalizado * (3 - 2 * normalizado)
      const pico = Math.min(1, banda.ganancia * (0.06 + 0.94 * perfil) + 0.5 * bombo * banda.grave)
      const constante = pico > banda.nivel ? ATAQUE : CAIDA
      banda.nivel += (pico - banda.nivel) * (1 - Math.exp(-delta / constante))
    })

    onda.queue_draw()
    if (!reproduciendo && energia < 0.004) {
      reposar()
      onda.queue_draw()
      idTick = null
      return false
    }
    return true
  }

  const sincronizar = () => {
    const necesario = barraVisible && (reproduciendo || energia > 0)
    if (necesario && idTick === null) {
      ultimoFrameUs = 0
      idTick = onda.add_tick_callback(frame)
    } else if (!necesario && idTick !== null) {
      onda.remove_tick_callback(idTick)
      idTick = null
    }
  }

  const cancelarSpotify = estadoSpotify.subscribe(() => {
    reproduciendo = estadoSpotify.get()?.reproduciendo ?? false
    if (!reproduciendo && !barraVisible) reposar()
    sincronizar()
  })
  const cancelarVisibilidad = visibilidad.visible.subscribe(() => {
    barraVisible = visibilidad.visible.get()
    if (!barraVisible && !reproduciendo) reposar()
    sincronizar()
  })
  sincronizar()

  onCleanup(() => {
    cancelarSpotify()
    cancelarVisibilidad()
    if (idTick !== null) onda.remove_tick_callback(idTick)
  })

  return onda
}
