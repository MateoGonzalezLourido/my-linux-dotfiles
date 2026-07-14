import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import GLib from "gi://GLib"
import {
  orionVisible,
  setOrionVisible,
  rightPanelVisible,
  hidePanel,
  preparePanelOpen,
  finalizarCierrePanel,
} from "./state"
import SectionIndex from "./components/SectionIndex"
import SearchBar, { focusSearchAndType } from "./components/SearchBar"
import NavSections from "./components/NavSections"
import { SystemStats } from "./components/sections/HomeSection"
import CornerCurve from "./components/CornerCurve"
import RightPanel from "./components/RightPanel"
import { clipWindowInputToContent } from "../inputRegion"

export default function Orion(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  const PROPORCION_HOLGURA_VERTICAL = 0.2
  const PREPARACION_ENTRADA_MS = 32
  const DURACION_ENTRADA_MS = 280
  const DURACION_ANIMACION_SALIDA_MS = 220
  const ESPERA_DESMAPEO_MS = 280
  // Debe coincidir con el radio usado por components/CornerCurve.tsx.
  const RADIO_CURVAS_LATERALES = 24
  const [orionRenderizado, establecerOrionRenderizado] = createState(orionVisible.get())
  const [cssAnimacionOrion, establecerCssAnimacionOrion] = createState(".orion-wrapper {}")
  let temporizadorPreparacionEntrada: number | null = null
  let temporizadorFinEntrada: number | null = null
  let idFrameSalida: number | null = null
  let refVentana: any = null
  // El transform de entrada altera temporalmente compute_bounds(); el recorte
  // debe repetirse cuando el panel vuelve a su posición definitiva.
  let recalcularRegionEntrada: (() => void) | null = null

  // Panel shell: [orion-main][separator?][right?]
  // overflow:hidden clips all columns to shared border-radius.
  // A balance spacer outside the left curve keeps orion-main centred while the
  // contextual panel is visible on the right.
  const panelInner = (
    <box cssClasses={["orion-panel"]}>
      <box cssClasses={["orion-main"]} orientation={Gtk.Orientation.VERTICAL}>
        <box cssClasses={["section-index-container"]}>
          <SectionIndex />
        </box>
        <SearchBar />
        <NavSections />
        <SystemStats />
      </box>
      <box cssClasses={["orion-panel-sep"]} visible={rightPanelVisible(v => v)} />
      <RightPanel />
    </box>
  ) as unknown as Gtk.Widget

  // Mirrors the contextual panel on the opposite side of the main content.
  const balanceL = (<box cssClasses={["orion-balance"]} visible={rightPanelVisible(v => v)} />) as unknown as Gtk.Widget

  const panelContainer = (
    <box
      cssClasses={["orion-wrapper"]}
      css={cssAnimacionOrion}
      hexpand
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.END}
    >
      {balanceL}
      {CornerCurve({ left: true })}
      {panelInner}
      {CornerCurve({ left: false })}
    </box>
  ) as unknown as Gtk.Widget

  function cancelarEsperaSalida(): void {
    if (idFrameSalida === null) return
    panelContainer.remove_tick_callback(idFrameSalida)
    idFrameSalida = null
  }

  function cancelarTemporizadoresEntrada(): boolean {
    const preparacionPendiente = temporizadorPreparacionEntrada !== null
    if (temporizadorPreparacionEntrada !== null) {
      GLib.source_remove(temporizadorPreparacionEntrada)
      temporizadorPreparacionEntrada = null
    }
    if (temporizadorFinEntrada !== null) {
      GLib.source_remove(temporizadorFinEntrada)
      temporizadorFinEntrada = null
    }
    return preparacionPendiente
  }

  function calcularDistanciaVertical(): number {
    const altoSuperficie = refVentana?.get_surface?.()?.get_height?.() ?? 0
    const altoVentana = refVentana?.get_height?.() ?? 0
    const altoPanel = panelContainer.get_height()
    const altoBase = Math.max(1, Math.ceil(Math.max(
      altoSuperficie,
      altoVentana,
      altoPanel,
    )))
    return Math.ceil(altoBase * (1 + PROPORCION_HOLGURA_VERTICAL))
  }

  function iniciarEntrada(): void {
    cancelarEsperaSalida()
    cancelarTemporizadoresEntrada()
    // Mapear primero con opacidad cero permite a GTK medir el panel incluso en
    // la primera apertura, sin mostrar un fotograma en su posición final.
    establecerCssAnimacionOrion(".orion-wrapper { opacity: 0; }")
    establecerOrionRenderizado(true)

    temporizadorPreparacionEntrada = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREPARACION_ENTRADA_MS, () => {
      const distanciaEntrada = calcularDistanciaVertical()
      establecerCssAnimacionOrion(`
        @keyframes orion-panel-slide-in-dynamic {
          from { transform: translateY(${distanciaEntrada}px); }
          to { transform: translateY(0); }
        }
        @keyframes orion-panel-fade-in-dynamic {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .orion-wrapper {
          animation:
            orion-panel-slide-in-dynamic ${DURACION_ENTRADA_MS}ms cubic-bezier(0.16, 1, 0.3, 1),
            orion-panel-fade-in-dynamic 45ms linear;
        }
      `)
      temporizadorPreparacionEntrada = null
      temporizadorFinEntrada = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DURACION_ENTRADA_MS, () => {
        // El helper difiere la medición a idle, cuando el transform ya está en
        // identidad y la región coincide con el panel que ve el usuario.
        recalcularRegionEntrada?.()
        temporizadorFinEntrada = null
        return GLib.SOURCE_REMOVE
      })
      return GLib.SOURCE_REMOVE
    })
  }

  function terminarSalida(): void {
    establecerOrionRenderizado(false)
    idFrameSalida = null
    // Restablecer la sección después de aplicar visible=false evita cambios de
    // contenido o anchura en el último fotograma de la animación.
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      if (!orionVisible.get() && !orionRenderizado.get()) finalizarCierrePanel()
      return GLib.SOURCE_REMOVE
    })
  }

  function iniciarSalida(): void {
    // Si se cierra durante los dos fotogramas invisibles de preparación, no hay
    // nada que animar ni conviene hacer aparecer el panel solo para ocultarlo.
    if (cancelarTemporizadoresEntrada()) {
      terminarSalida()
      return
    }
    const distanciaSalida = calcularDistanciaVertical()

    establecerCssAnimacionOrion(`
      @keyframes orion-panel-slide-out-dynamic {
        from { transform: translateY(0); }
        to { transform: translateY(${distanciaSalida}px); }
      }
      .orion-wrapper {
        animation: orion-panel-slide-out-dynamic ${DURACION_ANIMACION_SALIDA_MS}ms cubic-bezier(0.4, 0, 1, 1) forwards;
      }
    `)

    cancelarEsperaSalida()
    let primerFrameUs: number | null = null
    let frameFinalPresentado = false
    idFrameSalida = panelContainer.add_tick_callback((_widget: any, relojFrame: any) => {
      const ahoraUs = relojFrame.get_frame_time()
      if (primerFrameUs === null) primerFrameUs = ahoraUs
      const transcurridoMs = (ahoraUs - primerFrameUs) / 1000
      if (transcurridoMs < ESPERA_DESMAPEO_MS) return true

      // Este tick dibuja el estado final. Esperar al siguiente garantiza que el
      // panel ya cruzó el borde inferior antes de desmapear la superficie.
      if (!frameFinalPresentado) {
        frameFinalPresentado = true
        return true
      }

      terminarSalida()
      return false
    })
  }

  const win = (
    <window
      name="orion"
      visible={orionRenderizado}
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      anchor={BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={orionVisible((visible) =>
        visible ? Astal.Keymode.ON_DEMAND : Astal.Keymode.NONE)}
      application={app}
      decorated={false}
      deletable={false}
      marginTop={40}
      cssClasses={["Orion"]}
      $={(self: any) => { refVentana = self }}
    >
      <Gtk.EventControllerKey
        onKeyPressed={(_self, keyval, _keycode, state) => {
          if (keyval === Gdk.KEY_Escape) { hidePanel(); return true }
          const s = state as unknown as number
          const CTRL = 4, ALT = 8, SUPER = 0x4000000
          if (!(s & CTRL) && !(s & ALT) && !(s & SUPER)) {
            const cp = Gdk.keyval_to_unicode(keyval)
            if (cp >= 0x20) { focusSearchAndType(String.fromCodePoint(cp)); return true }
          }
          return false
        }}
      />

      <box hexpand>
        <Gtk.GestureClick onPressed={(self: Gtk.GestureClick, _n: number, x: number, y: number) => {
          const outerBox = self.get_widget() as Gtk.Widget
          const hit = outerBox.pick(x, y, 0)
          let w: Gtk.Widget | null = hit
          while (w && w !== outerBox) {
            if (w === panelContainer) return
            w = w.get_parent()
          }
          hidePanel()
        }} />
        {panelContainer as unknown as any}
      </box>
    </window>
  ) as unknown as Gtk.Widget

  // Mantener la ventana mapeada durante la salida permite completar el recorrido
  // hacia abajo antes de ocultarla realmente.
  orionVisible.subscribe(() => {
    if (orionVisible.get()) iniciarEntrada()
    else iniciarSalida()
  })

  // Compatibilidad con invocaciones manuales de `ags toggle orion`. El atajo
  // normal usa `ags request toggle-orion`, pero si GTK intenta ocultar la ventana
  // directamente la remapeamos en el mismo cambio y dejamos que el estado ejecute
  // la animación antes del cierre real.
  ;(win as any).connect("notify::visible", () => {
    const visible = (win as any).visible
    if (visible) {
      if (!orionVisible.get()) {
        preparePanelOpen()
        setOrionVisible(true)
      }
      return
    }

    if (orionVisible.get()) {
      ;(win as any).visible = true
      setOrionVisible(false)
    }
  })

  recalcularRegionEntrada = clipWindowInputToContent(win, panelInner, {
    radioCurvasInferioresLaterales: RADIO_CURVAS_LATERALES,
  })
  // El panel contextual cambia la anchura y la posición de `.orion-panel` sin
  // redimensionar la superficie anclada a ambos lados de la pantalla.
  rightPanelVisible.subscribe(() => recalcularRegionEntrada?.())

  return win
}
