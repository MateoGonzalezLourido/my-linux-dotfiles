// Mascota decorativa: un lagarto que se pasea por debajo de la barra mientras
// el escritorio activo de esta salida no tenga clientes o no haya ninguno
// enfocado (modulos/mascotas/estado/monitorActividad.ts). Vive en su PROPIA
// ventana layer-shell, anclada justo debajo del bar — así no necesita conocer
// ni esquivar ningún widget de Barra.tsx, al revés que un cangrejo que viviera
// dentro de ella.
//
// Interactivo: un clic lo tumba un rato, un doble clic lo deja colgado (otro
// doble clic lo suelta) y se puede arrastrar con el ratón para reubicarlo. El
// hueco de clic de la ventana se recorta a la silueta real del sprite
// (clipWindowInputToContent) para que el resto de la franja bajo la barra
// siga siendo transparente a los clics.
//
// Esquiva Quick Settings, Notificaciones y el Calendario cuando se abren
// donde está: a Notificaciones y Calendario los "empuja" fuera de su hueco (y
// deja de poder volver a esa franja mientras sigan abiertos); a Quick
// Settings se sube — baja hasta su borde inferior, sigue paseándose por su
// ancho mientras esté abierto, y vuelve a subir a la barra al cerrarse.
import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createComputed, createState, onCleanup } from "ags"
import GLib from "gi://GLib"
import { clipWindowInputToContent } from "../../utilidades/inputRegion"
import { obtenerControlVisibilidadBarra } from "../../estado/visibilidadBarra"
import { calendarVisible, quickSettingsVisible } from "../../estado/shell"
import { notifPanelVisible } from "../notificaciones/store"
import { lagartoBarraEnabled } from "../ajustes/preferences"
import { mascotaSuspended } from "../../servicios/energia/powerState"
import { suscribirActividadMascota } from "./estado/monitorActividad"
import { avanzarPaso, estadoAleatorio, PARAMETROS_PREDETERMINADOS, type EstadoMovimiento } from "./estado/movimiento"
import {
  ANCHO_CALENDARIO, ANCHO_NOTIFICACIONES,
  empujeDesdeDerecha, empujeDesdeIzquierda, franjaQuickSettings,
} from "./estado/paneles"

// BAR_HEIGHT debe coincidir con el de modulos/barra/Barra.tsx. Se resta 1: sin
// ese solape de un píxel quedaba una línea visible entre el borde inferior
// real de la barra y el sprite, aunque marginTop = BAR_HEIGHT "debería" tocarlo.
const BAR_HEIGHT = 38
const MARGEN_SUPERIOR = BAR_HEIGHT - 1
// Tamaño nativo de los sprites ya escalados (ver generar_lagarto.py,
// ESCALA=1.75). Caminando y tumbado comparten ancho; colgado es un cuerpo
// girado 90° -mucho más estrecho y bastante más alto, cuelga en vertical de
// las patas traseras- así que necesita su propio ancho y alto. Sin reescalar
// aquí: a este tamaño el pixel art se pinta 1:1 y no hace falta que
// Gtk.Picture reescale.
const ANCHO_CAMINANDO = 38
const ALTO_CAMINANDO = 16
const ANCHO_TUMBADO = 38
const ALTO_TUMBADO = 10
const ANCHO_COLGADO = 10
const ALTO_COLGADO = 46
const ALTO_VENTANA = Math.max(ALTO_CAMINANDO, ALTO_COLGADO, ALTO_TUMBADO)
const INTERVALO_MS = 90

// Cuánto tarda en decidirse un clic simple, por si llega un segundo clic justo
// detrás y hay que tratarlo como doble clic (mismo patrón que
// modulos/orion/components/shared/dobleClic.ts).
const ESPERA_CLIC_MS = 300
// Umbral (px) a partir del cual un gesto se considera arrastre y no clic.
const UMBRAL_ARRASTRE_PX = 4
const TUMBADO_MIN_MS = 4000
const TUMBADO_MAX_MS = 9000

const ASSETS_DIR = `${GLib.get_user_config_dir()}/ags/modulos/mascotas/assets`

function cargarTextura(nombre: string): Gdk.Texture | null {
  try {
    return Gdk.Texture.new_from_filename(`${ASSETS_DIR}/${nombre}`)
  } catch (error) {
    console.error("[mascotas] no se pudo cargar el sprite del lagarto:", nombre, error)
    return null
  }
}

// Una sola carga de las texturas, compartida por todos los monitores.
const TEXTURAS = {
  derecha: [cargarTextura("lagarto-a-derecha.png"), cargarTextura("lagarto-b-derecha.png")],
  izquierda: [cargarTextura("lagarto-a-izquierda.png"), cargarTextura("lagarto-b-izquierda.png")],
  colgadoDerecha: cargarTextura("lagarto-colgado-derecha.png"),
  colgadoIzquierda: cargarTextura("lagarto-colgado-izquierda.png"),
  tumbadoDerecha: cargarTextura("lagarto-tumbado-derecha.png"),
  tumbadoIzquierda: cargarTextura("lagarto-tumbado-izquierda.png"),
}

type Pose = "caminando" | "colgado" | "tumbado"

// Qué franja horizontal puede recorrer el lagarto ahora mismo y por qué.
// "evitando" cubre Notificaciones y Calendario (huye del panel, no puede
// volver a esa franja mientras siga abierto); "quicksettings" es el caso
// especial en el que además cambia de superficie (sube a su borde inferior).
// `origen` distingue Notificaciones de Calendario para no revertir por error
// la exclusión de uno al cerrarse el otro (son mutuamente excluyentes, pero
// esto lo deja a prueba de una condición de carrera).
type Modo =
  | { tipo: "normal" }
  | { tipo: "evitando", origen: "notificaciones" | "calendario", limiteIzq: number, limiteDer: number }
  | { tipo: "quicksettings", limiteIzq: number, limiteDer: number }

// Tick propio (más fino que INTERVALO_MS, el de la marcha) para que la
// subida/bajada a Quick Settings se sienta pegada a la animación real del
// panel y no vaya a remolque. La curva del panel (cubic-bezier(0.16,1,0.3,1),
// en QuickSettings.tsx) es un ease-out MUY agresivo: casi todo el recorrido
// visual pasa en el primer tercio y el resto es solo el asentamiento final.
// Un reparto proporcional uniforme (p. ej. 45% del resto en cada paso)
// termina técnicamente rápido pero se SIENTE lento, porque el panel ya está
// quieto mientras el lagarto sigue deslizándose visiblemente detrás. Con
// 0.6 a 20ms el 99% del camino cae en ~100ms, calcado a esa misma sensación.
const TICK_MARGEN_MS = 20
const PASO_MARGEN_FRACCION = 0.6

function clamp(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor))
}

function enteroAleatorio(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

export default function Lagarto(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const visibilidadBarra = obtenerControlVisibilidadBarra(gdkmonitor)

  // Se activa solo con las CUATRO condiciones a la vez: preferencia encendida,
  // barra visible en esta salida (si la barra está retraída, el lagarto no
  // debe quedar flotando solo en el escritorio), escritorio inactivo y el modo
  // ahorro sin pedir que se retire. El ahorro entra aquí y no en un `visible`
  // aparte porque desmontar es lo único que de verdad ahorra: el paseo son ~11
  // fotogramas/s, y cada uno es un commit de esta capa que Hyprland recompone.
  // Mismo gesto que `spotifyBarSuspended` en `Barra.tsx`.
  const [mostrarPorActividad, setMostrarPorActividad] = createState(false)
  const visible = createComputed(
    [lagartoBarraEnabled, visibilidadBarra.visible, mostrarPorActividad, mascotaSuspended],
    (activado, barraVisible, inactivo, ahorro) => activado && barraVisible && inactivo && !ahorro,
  )

  let picture: Gtk.Picture | null = null
  let reclip: ((inmediato?: boolean) => void) | null = null
  // Franja horizontal vigente y por qué (ver tipo Modo). Empieza en "normal";
  // las suscripciones a los paneles más abajo la actualizan.
  let modo: Modo = { tipo: "normal" }
  // Se resiembra en cada aparición (ver bajaVisibilidad más abajo): así no
  // sale siempre del mismo punto ni mirando siempre hacia el mismo lado.
  let m: EstadoMovimiento = estadoAleatorio(limitesActuales().max, Math.random, limitesActuales().min)
  let pose: Pose = "caminando"
  let timerId: number | null = null
  let poseTimerId: number | null = null
  let clicPendienteId: number | null = null
  let margenTimerId: number | null = null
  let arrastrando = false
  // Se pone a `true` en cuanto el arrastre supera el umbral EN CUALQUIER
  // momento de la pulsación actual, y se consulta al soltar para saber si lo
  // que acaba de pasar fue un clic o un arrastre. Separado de `arrastrando`
  // (que solo dice si el arrastre está en curso AHORA) porque `onReleased`
  // necesita la respuesta de toda la pulsación, no del instante final.
  let huboArrastre = false
  let xLagartoAlAgarrar = 0

  // Margen superior real de la ventana: MARGEN_SUPERIOR (bajo el bar) salvo
  // mientras está subido a Quick Settings, donde `asegurarTimerMargen` lo desliza
  // hasta el borde inferior del panel y de vuelta.
  const [margenSuperior, setMargenSuperior] = createState(MARGEN_SUPERIOR)

  function limitesActuales(): { min: number, max: number } {
    const anchoTotal = gdkmonitor.get_geometry().width
    if (modo.tipo === "normal") return { min: 0, max: Math.max(0, anchoTotal - ANCHO_CAMINANDO) }
    return { min: modo.limiteIzq, max: modo.limiteDer }
  }

  /** Borde inferior real de Quick Settings, leído de su propia ventana para
   * no duplicar un alto que cambia con la vista (main/wifi/bluetooth/...).
   * Repliegue razonable si todavía no se ha asignado (panel recién mapeado). */
  function margenBajoQuickSettings(): number {
    const ventanaQs = app.get_window("quick-settings") as unknown as
      { get_surface?: () => { get_height?: () => number } | null } | null
    const alto = ventanaQs?.get_surface?.()?.get_height?.()
    const altoQs = typeof alto === "number" && alto > 0 ? alto : 400
    return MARGEN_SUPERIOR + altoQs - 1
  }

  function detenerTimerMargen() {
    if (margenTimerId === null) return
    GLib.source_remove(margenTimerId)
    margenTimerId = null
  }

  /** Acerca `margenSuperior` un paso hacia su objetivo (la barra, o el borde
   * de Quick Settings si está subido a él) y avisa si ya llegó. El objetivo
   * se recalcula EN CADA LLAMADA a propósito: la superficie de Quick Settings
   * puede no tener aún su asignación real nada más abrirse (mismo caso que
   * documenta OSD.tsx sobre su primer frame a 200×200), así que si esa
   * primera lectura llega antes de tiempo, los siguientes pasos la corrigen
   * solos en cuanto la medida real está disponible — y de paso sigue un
   * cambio de alto del panel (p. ej. al entrar en un submenú) mientras siga
   * abierto, no solo el tramo de apertura. */
  function pasoMargen(): boolean {
    const objetivo = modo.tipo === "quicksettings" ? margenBajoQuickSettings() : MARGEN_SUPERIOR
    const actual = margenSuperior.get()
    if (actual === objetivo) return true
    const paso = Math.max(1, Math.ceil(Math.abs(objetivo - actual) * PASO_MARGEN_FRACCION))
    setMargenSuperior(actual < objetivo ? Math.min(objetivo, actual + paso) : Math.max(objetivo, actual - paso))
    return false
  }

  function asegurarTimerMargen() {
    if (margenTimerId !== null) return
    margenTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MARGEN_MS, () => {
      if (pasoMargen()) {
        margenTimerId = null
        return GLib.SOURCE_REMOVE
      }
      return GLib.SOURCE_CONTINUE
    })
  }

  function texturaYTamanoActual(): { textura: Gdk.Texture | null, ancho: number, alto: number } {
    if (pose === "colgado") {
      return {
        textura: m.direccion === 1 ? TEXTURAS.colgadoDerecha : TEXTURAS.colgadoIzquierda,
        ancho: ANCHO_COLGADO,
        alto: ALTO_COLGADO,
      }
    }
    if (pose === "tumbado") {
      return {
        textura: m.direccion === 1 ? TEXTURAS.tumbadoDerecha : TEXTURAS.tumbadoIzquierda,
        ancho: ANCHO_TUMBADO,
        alto: ALTO_TUMBADO,
      }
    }
    return {
      textura: m.direccion === 1 ? TEXTURAS.derecha[m.fotograma] : TEXTURAS.izquierda[m.fotograma],
      ancho: ANCHO_CAMINANDO,
      alto: ALTO_CAMINANDO,
    }
  }

  // Última imagen realmente escrita en el widget. `pintar()` se llama en CADA
  // tick de la marcha (~11 veces por segundo) y casi siempre con parte de esos
  // valores sin cambiar, así que se comparan antes de tocar nada.
  //
  // Lo caro no son los setters —GTK ya ignora una asignación idéntica— sino el
  // `reclip()`: mide con `compute_bounds()`, construye una `cairo.Region` y la
  // manda al compositor con `set_input_region`, y para hacerlo **pide un tick
  // callback a la ventana**, o sea que mantiene vivo el reloj de FRAMES de la
  // superficie. Llamarlo a ciegas 11 veces por segundo dejaba a la mascota
  // despertando el reloj de frames sin parar incluso con el lagarto quieto — y
  // está quieto a menudo, porque el modelo de movimiento se para a propósito
  // (`estado: "parado"`, de 20 a 70 ticks, o sea entre 1,8 y 6,3 s) y porque
  // colgado y tumbado no se mueven en absoluto. Con la guarda, esos ratos no
  // cuestan ni una medición ni un frame. Es el mismo principio que ya aplica el
  // temporizador al esconderse la ventana, un escalón más adentro.
  let ultimaTextura: Gdk.Texture | null = null
  let ultimoAncho = -1
  let ultimoAlto = -1
  let ultimoMargen = Number.NaN

  function pintar() {
    if (!picture) return
    const { textura, ancho, alto } = texturaYTamanoActual()
    // `m.x` es la posición de referencia del "carril" de la marcha (ancho
    // ANCHO_CAMINANDO). Colgado es mucho más estrecho: centrarlo dentro de
    // ese mismo carril evita que salte hacia la izquierda al cambiar de pose.
    const margen = Math.round(m.x + (ANCHO_CAMINANDO - ancho) / 2)
    // La región de entrada es la silueta del sprite DENTRO de la ventana, así
    // que la mueve tanto el tamaño de la pose como la posición horizontal.
    const cambiaGeometria = ancho !== ultimoAncho || alto !== ultimoAlto || margen !== ultimoMargen

    if (textura !== ultimaTextura) {
      picture.set_paintable(textura ?? null)
      ultimaTextura = textura
    }
    if (ancho !== ultimoAncho) { picture.widthRequest = ancho; ultimoAncho = ancho }
    if (alto !== ultimoAlto) { picture.heightRequest = alto; ultimoAlto = alto }
    if (margen !== ultimoMargen) { picture.marginStart = margen; ultimoMargen = margen }

    if (cambiaGeometria) reclip?.()
  }

  function cancelarTemporizadorPose() {
    if (poseTimerId === null) return
    GLib.source_remove(poseTimerId)
    poseTimerId = null
  }

  function volverACaminar() {
    cancelarTemporizadorPose()
    pose = "caminando"
    m = { ...m, vx: 0, estado: "caminando" }
    pintar()
  }

  function tumbarseUnRato() {
    cancelarTemporizadorPose()
    pose = "tumbado"
    pintar()
    poseTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, enteroAleatorio(TUMBADO_MIN_MS, TUMBADO_MAX_MS), () => {
      poseTimerId = null
      volverACaminar()
      return GLib.SOURCE_REMOVE
    })
  }

  function alternarColgado() {
    cancelarTemporizadorPose()
    if (pose === "colgado") volverACaminar()
    else { pose = "colgado"; pintar() }
  }

  function cancelarClicPendiente() {
    if (clicPendienteId === null) return
    GLib.source_remove(clicPendienteId)
    clicPendienteId = null
  }

  function avanzar() {
    // La física de la marcha se congela mientras hay una pose fija (colgado,
    // tumbado) o mientras el usuario está arrastrando al lagarto a mano.
    if (arrastrando || pose !== "caminando") return
    const { min, max } = limitesActuales()
    m = avanzarPaso(m, max, PARAMETROS_PREDETERMINADOS, Math.random, min)
    pintar()
  }

  function detenerTimer() {
    if (timerId === null) return
    GLib.source_remove(timerId)
    timerId = null
  }

  function iniciarTimer() {
    if (timerId !== null) return
    // Punto de partida nuevo en cada aparición, no solo la primera vez. Si ya
    // hay un panel abierto (modo distinto de "normal"), respeta su franja
    // desde el primer fotograma.
    const { min, max } = limitesActuales()
    m = estadoAleatorio(max, Math.random, min)
    pose = "caminando"
    // Salto directo sin animar: si ya tocaba estar subido a Quick Settings
    // (reaparece con el panel ya abierto), no había nada visible que animar.
    setMargenSuperior(modo.tipo === "quicksettings" ? margenBajoQuickSettings() : MARGEN_SUPERIOR)
    pintar()
    timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVALO_MS, () => {
      avanzar()
      return GLib.SOURCE_CONTINUE
    })
  }

  // El temporizador solo corre mientras la ventana está visible: oculto no
  // cuesta ni un timeout, mismo principio que la onda de Spotify.
  const bajaVisibilidad = visible.subscribe(() => {
    if (visible.get()) iniciarTimer()
    else {
      detenerTimer()
      cancelarTemporizadorPose()
      cancelarClicPendiente()
    }
  })
  const bajaActividad = suscribirActividadMascota(gdkmonitor, setMostrarPorActividad)

  // Notificaciones y Calendario: si el lagarto está donde va a aparecer el
  // panel, lo empuja fuera de ese hueco y no lo deja volver mientras siga
  // abierto (mismo patrón para los dos, solo cambia el borde y el sentido).
  function alAbrirseEvitando(
    origen: "notificaciones" | "calendario",
    calcular: (x: number, anchoTotal: number) => { empuje: { x: number, direccion: 1 | -1 } | null, limiteIzq: number, limiteDer: number },
  ) {
    const anchoTotal = gdkmonitor.get_geometry().width
    const { empuje, limiteIzq, limiteDer } = calcular(m.x, anchoTotal)
    modo = { tipo: "evitando", origen, limiteIzq, limiteDer }
    if (empuje) m = { ...m, x: empuje.x, direccion: empuje.direccion, vx: 0, estado: "caminando" }
    pintar()
  }

  function alCerrarseEvitando(origen: "notificaciones" | "calendario") {
    if (modo.tipo === "evitando" && modo.origen === origen) modo = { tipo: "normal" }
  }

  const bajaNotif = notifPanelVisible.subscribe(() => {
    if (notifPanelVisible.get()) {
      alAbrirseEvitando("notificaciones", (x, anchoTotal) => {
        const { empuje, limiteDerecho } = empujeDesdeDerecha(x, ANCHO_CAMINANDO, anchoTotal, ANCHO_NOTIFICACIONES)
        return { empuje, limiteIzq: 0, limiteDer: limiteDerecho }
      })
    } else {
      alCerrarseEvitando("notificaciones")
    }
  })
  const bajaCalendario = calendarVisible.subscribe(() => {
    if (calendarVisible.get()) {
      alAbrirseEvitando("calendario", (x, anchoTotal) => {
        const { empuje, limiteIzquierdo } = empujeDesdeIzquierda(x, anchoTotal, ANCHO_CALENDARIO)
        return { empuje, limiteIzq: limiteIzquierdo, limiteDer: Math.max(limiteIzquierdo, anchoTotal - ANCHO_CAMINANDO) }
      })
    } else {
      alCerrarseEvitando("calendario")
    }
  })

  // Quick Settings: en vez de esquivarlo, el lagarto se sube a su borde
  // inferior y sigue paseándose por su ancho hasta que se cierra.
  const bajaQuickSettings = quickSettingsVisible.subscribe(() => {
    if (quickSettingsVisible.get()) {
      const anchoTotal = gdkmonitor.get_geometry().width
      const { minX, maxX } = franjaQuickSettings(ANCHO_CAMINANDO, anchoTotal)
      modo = { tipo: "quicksettings", limiteIzq: minX, limiteDer: maxX }
      m = { ...m, x: clamp(m.x, minX, maxX), vx: 0, estado: "caminando" }
      asegurarTimerMargen()
      pintar()
    } else if (modo.tipo === "quicksettings") {
      modo = { tipo: "normal" }
      asegurarTimerMargen()
    }
  })

  onCleanup(() => {
    detenerTimer()
    cancelarTemporizadorPose()
    cancelarClicPendiente()
    detenerTimerMargen()
    bajaVisibilidad()
    bajaActividad()
    bajaNotif()
    bajaCalendario()
    bajaQuickSettings()
  })

  const win = (
    <window
      name="lagarto-mascota"
      namespace="gigios-mascotas"
      visible={visible}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.IGNORE}
      focusable={false}
      anchor={TOP | LEFT | RIGHT}
      application={app}
      marginTop={margenSuperior}
      heightRequest={ALTO_VENTANA}
      cssClasses={["lagarto-window"]}
    >
      <box hexpand vexpand={false}>
        <Gtk.Picture
          $={(self: Gtk.Picture) => { picture = self }}
          contentFit={Gtk.ContentFit.CONTAIN}
          canShrink={false}
          halign={Gtk.Align.START}
          valign={Gtk.Align.START}
          widthRequest={ANCHO_CAMINANDO}
          heightRequest={ALTO_CAMINANDO}
        >
          {/* Fase CAPTURE en los dos gestos, mismo patrón que
              BotonEscritorio.tsx. La decisión de clic/doble clic se toma
              SIEMPRE al soltar ("released"), nunca al pulsar: si se decidiera
              al pulsar (como antes), un temporizador de clic disparado a
              mitad de un arrastre lento le cambiaba la pose por debajo y el
              arrastre dejaba de tener efecto visible. Al mirar `huboArrastre`
              —que cubre TODA la pulsación, no solo el instante final— un
              arrastre real nunca compite con la acción de clic. */}
          <Gtk.GestureClick
            button={Gdk.BUTTON_PRIMARY}
            $={(self: Gtk.GestureClick) => self.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)}
            onPressed={() => {
              huboArrastre = false
            }}
            onReleased={(_gesto: Gtk.GestureClick, pulsaciones: number) => {
              if (huboArrastre) return
              if (pulsaciones >= 2) {
                cancelarClicPendiente()
                alternarColgado()
                return
              }
              // Doble clic real: GTK dispara "released" con pulsaciones=1 y
              // luego, si llega el segundo clic a tiempo, otra vez con
              // pulsaciones=2. Se retrasa la acción del primero por si ese
              // segundo clic aparece, para no tumbarlo un instante y colgarlo
              // justo después.
              cancelarClicPendiente()
              clicPendienteId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ESPERA_CLIC_MS, () => {
                clicPendienteId = null
                tumbarseUnRato()
                return GLib.SOURCE_REMOVE
              })
            }}
          />
          <Gtk.GestureDrag
            $={(self: Gtk.GestureDrag) => self.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)}
            onDragBegin={() => {
              arrastrando = false
              xLagartoAlAgarrar = m.x
            }}
            onDragUpdate={(_gesto: Gtk.GestureDrag, offsetX: number, offsetY: number) => {
              if (!arrastrando) {
                if (Math.abs(offsetX) < UMBRAL_ARRASTRE_PX && Math.abs(offsetY) < UMBRAL_ARRASTRE_PX) return
                arrastrando = true
                huboArrastre = true
                cancelarClicPendiente()
              }
              const { min, max } = limitesActuales()
              m = { ...m, x: clamp(xLagartoAlAgarrar + offsetX, min, max) }
              pintar()
            }}
            onDragEnd={() => {
              if (!arrastrando) return
              arrastrando = false
              // Solo retoma la física de la marcha si no quedó colgado ni
              // tumbado: arrastrar en esas poses solo lo reubica.
              if (pose === "caminando") m = { ...m, vx: 0, estado: "caminando" }
              pintar()
            }}
          />
        </Gtk.Picture>
      </box>
    </window>
  ) as Gtk.Window

  // El hueco de clic se recorta a la silueta real del sprite (se
  // recalcula en cada pintar()): el resto de la franja bajo la barra sigue
  // siendo transparente a los clics.
  reclip = clipWindowInputToContent(win, [picture], { vaciarAlMapear: true })

  return win
}
