// Recorta la región de entrada de una ventana layer-shell a uno o varios widgets
// de contenido. Las partes transparentes de la superficie —esquinas, conectores,
// sombras y huecos entre tarjetas— dejan así pasar los clics sin alterar el dibujo.
import GLib from "gi://GLib"
import cairo from "gi://cairo"

interface OpcionesRecorteEntrada {
  /** Recorta cada contenido como un rectángulo redondeado en vez de conservar
   * las esquinas transparentes de su caja de asignación. */
  radioEsquinas?: number
  /** Añade únicamente la silueta pintada de dos curvas laterales pegadas a las
   * esquinas inferiores, sin convertir sus anchos en franjas verticales. */
  radioCurvasInferioresLaterales?: number
}

function anadirRectanguloRedondeado(
  region: any,
  rect: { x: number; y: number; width: number; height: number },
  radioSolicitado: number,
): void {
  const radio = Math.max(0, Math.min(
    Math.floor(radioSolicitado),
    Math.floor(rect.width / 2),
    Math.floor(rect.height / 2),
  ))
  if (radio === 0) {
    region.unionRectangle(rect)
    return
  }

  // cairo.Region solo admite rectángulos enteros. Una franja por fila conserva
  // la parte clicable de la tarjeta y deja pasar los clics por sus cuatro
  // esquinas transparentes.
  for (let fila = 0; fila < rect.height; fila++) {
    const distanciaVertical = fila < radio
      ? radio - fila - 0.5
      : fila >= rect.height - radio
        ? fila - (rect.height - radio) + 0.5
        : 0
    const limiteCurva = distanciaVertical > 0
      ? radio - Math.sqrt(Math.max(0, radio * radio - distanciaVertical * distanciaVertical))
      : 0
    const recorteLateral = Math.max(0, Math.ceil(limiteCurva - 0.5))
    const ancho = rect.width - recorteLateral * 2
    if (ancho <= 0) continue

    region.unionRectangle({
      x: rect.x + recorteLateral,
      y: rect.y + fila,
      width: ancho,
      height: 1,
    })
  }
}

function anadirCurvasInferioresLaterales(
  region: any,
  rect: { x: number; y: number; width: number; height: number },
  radioSolicitado: number,
): void {
  const radio = Math.max(0, Math.min(Math.floor(radioSolicitado), rect.height))
  if (radio === 0) return

  // Las DrawingArea de Orion pintan el espacio situado debajo de un cuarto de
  // círculo. Una fila por píxel aproxima esa misma silueta en cairo.Region sin
  // conservar el cuadrado transparente que contiene cada curva.
  for (let fila = 0; fila < radio; fila++) {
    const yCentro = fila + 0.5
    const limiteCurva = Math.sqrt(Math.max(0, radio * radio - yCentro * yCentro))
    const inicioPintado = Math.min(radio, Math.ceil(limiteCurva - 0.5))
    const anchoPintado = radio - inicioPintado
    if (anchoPintado <= 0) continue

    const y = rect.y + rect.height - radio + fila
    region.unionRectangle({
      x: rect.x - radio + inicioPintado,
      y,
      width: anchoPintado,
      height: 1,
    })
    region.unionRectangle({
      x: rect.x + rect.width,
      y,
      width: anchoPintado,
      height: 1,
    })
  }
}

// Devuelve una función para volver a medir y aplicar la región. Hay que llamarla
// al terminar una animación CSS con `transform`: `compute_bounds()` devuelve la
// posición transformada y, sin esa segunda medición, el recorte quedaría desplazado.
// Los cambios de tamaño de la superficie se observan automáticamente más abajo.
export function clipWindowInputToContent(
  win: any,
  contenido: any,
  opciones: OpcionesRecorteEntrada = {},
): () => void {
  let surfaceHandlers: { surface: any; ids: number[] } | null = null

  const apply = () => {
    try {
      const surface = win.get_surface?.()
      if (!surface) return
      const contenidos = Array.isArray(contenido) ? contenido : [contenido]
      const region = new (cairo as any).Region()
      let contenidosValidos = 0

      for (const contenido of contenidos) {
        if (!contenido || contenido.get_visible?.() === false) continue
        const res = contenido.compute_bounds(win)
        // gjs devuelve [ok, Graphene.Rect].
        const ok = Array.isArray(res) ? res[0] : false
        const rect = Array.isArray(res) ? res[1] : null
        if (!ok || !rect) continue
        const x = Math.floor(rect.origin.x)
        const y = Math.floor(rect.origin.y)
        const w = Math.ceil(rect.size.width)
        const h = Math.ceil(rect.size.height)
        if (w <= 0 || h <= 0) continue

        const rectangulo = { x, y, width: w, height: h }
        if (opciones.radioEsquinas) {
          anadirRectanguloRedondeado(region, rectangulo, opciones.radioEsquinas)
        } else {
          region.unionRectangle(rectangulo)
        }
        if (opciones.radioCurvasInferioresLaterales) {
          anadirCurvasInferioresLaterales(
            region,
            rectangulo,
            opciones.radioCurvasInferioresLaterales,
          )
        }
        contenidosValidos++
      }

      // No sustituir una región anterior por una vacía durante el desmontaje de
      // la ventana; el siguiente map volverá a medir todos los contenidos.
      if (contenidosValidos === 0) return
      surface.set_input_region(region)
    } catch (e) {
      // Si algo no está disponible, se conserva de forma segura la región predeterminada.
      console.error("[inputRegion] clip failed:", e)
    }
  }

  // Esperar a idle permite medir después de que GTK asigne el tamaño definitivo.
  const scheduleApply = () => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { apply(); return GLib.SOURCE_REMOVE })
  }

  const hookSurface = () => {
    const surface = win.get_surface?.()
    if (!surface) return
    // Evitar manejadores duplicados si la misma superficie persiste entre mapeos.
    if (surfaceHandlers && surfaceHandlers.surface === surface) return
    if (surfaceHandlers) {
      try { for (const id of surfaceHandlers.ids) surfaceHandlers.surface.disconnect(id) } catch (_) {}
    }
    const ids = [
      surface.connect("notify::width", scheduleApply),
      surface.connect("notify::height", scheduleApply),
    ]
    surfaceHandlers = { surface, ids }
  }

  win.connect("map", () => { hookSurface(); scheduleApply() })
  if (win.get_mapped?.()) { hookSurface(); scheduleApply() }

  // El llamador debe invocarla al terminar cualquier animación de entrada con transform.
  return scheduleApply
}
