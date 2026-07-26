// Barra de pestañas de Orion (Inicio/Apps/Flujos/…) con un indicador
// deslizante que se anima entre botones usando `Gtk.Overlay` + transform CSS
// en vez de reconstruirse — el mismo patrón de "medir, luego animar por
// transform" que usa la entrada de `Orion.tsx`.

import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import GLib from "gi://GLib"
import { activeSection, setSection, type SectionId } from "../../state"

interface SectionIndexItem {
  id: string
  label: string
  icon: string
  target: SectionId
}

// Índice único de Orion: solo las secciones con página real montada
// (ver `SECTION_COMPONENTS`). No añadas aquí un destino sin componente: la
// pestaña navegaría a un panel vacío.
const SECTIONS: SectionIndexItem[] = [
  { id: "inicio",    label: "Inicio",       icon: "go-home-symbolic",                       target: "inicio" },
  { id: "apps",      label: "Aplicaciones", icon: "view-app-grid-symbolic",                  target: "apps" },
  { id: "rice",      label: "Temas",        icon: "preferences-desktop-theme-symbolic",      target: "rice" },
  { id: "keybinds",  label: "Atajos",       icon: "input-keyboard-symbolic",                 target: "keybinds" },
]

export default function SectionIndex() {
  const root = new Gtk.Box({ cssClasses: ["section-index"], hexpand: true })
  const scroll = new Gtk.ScrolledWindow({ cssClasses: ["section-index-scroll"], hexpand: true })
  scroll.set_policy(Gtk.PolicyType.EXTERNAL, Gtk.PolicyType.NEVER)

  const controladorScroll = new Gtk.EventControllerScroll({
    flags: Gtk.EventControllerScrollFlags.VERTICAL,
  })
  controladorScroll.connect("scroll", (_controlador, _dx, dy) => {
    const ajuste = scroll.get_hadjustment()
    ajuste.set_value(ajuste.get_value() + dy * 40)
    return true
  })
  scroll.add_controller(controladorScroll)

  const DURACION_MOVIMIENTO_MS = 260
  const PREPARACION_MOVIMIENTO_MS = 32
  let temporizadorPreparacion: number | null = null
  let temporizadorFin: number | null = null
  let secuenciaAnimacion = 0
  let posicionActual = 0
  let posicionYActual = 0
  let anchoActual = 0
  let altoActual = 0
  let geometriaDisponible = false
  const [cssIndicador, establecerCssIndicador] = createState(".section-index-indicator {}")

  // La fila conserva el layout natural. El indicador se asigna mediante el
  // mecanismo nativo del Overlay y su movimiento se pinta con transform.
  const fila = new Gtk.Box({ cssClasses: ["section-index-row"], spacing: 2 })
  const capa = new Gtk.Overlay()
  capa.set_child(fila)
  const indicador = (
    <box cssClasses={["section-index-indicator"]} css={cssIndicador} />
  ) as unknown as Gtk.Widget
  indicador.set_can_target(false)
  capa.add_overlay(indicador)
  capa.set_clip_overlay(indicador, true)

  capa.connect("get-child-position", (_overlay, widget, asignacion) => {
    if (widget !== indicador || anchoActual <= 0 || altoActual <= 0) return false
    asignacion.x = Math.round(posicionActual)
    asignacion.y = Math.round(posicionYActual)
    asignacion.width = Math.max(1, Math.round(anchoActual))
    asignacion.height = Math.max(1, Math.round(altoActual))
    return true
  })

  const botones = new Map<SectionId, Gtk.Button>()
  for (const section of SECTIONS) {
    const boton = new Gtk.Button({
      cssClasses: ["section-index-btn"],
      tooltipText: section.label,
    })
    const contenido = new Gtk.Box({ spacing: 5 })
    contenido.append(new Gtk.Image({
      iconName: section.icon,
      pixelSize: 13,
      cssClasses: ["section-index-icon"],
    }))
    contenido.append(new Gtk.Label({ label: section.label }))
    boton.set_child(contenido)
    boton.connect("clicked", () => setSection(section.target))
    botones.set(section.target, boton)
    fila.append(boton)
  }

  scroll.set_child(capa)
  root.append(scroll)

  function medir(boton: Gtk.Button) {
    const resultado = boton.compute_bounds(fila)
    const valido = Array.isArray(resultado) ? resultado[0] : false
    const rect = Array.isArray(resultado) ? resultado[1] : null
    if (!valido || !rect || rect.size.width <= 0 || rect.size.height <= 0) return null
    return {
      x: rect.origin.x,
      y: rect.origin.y,
      ancho: rect.size.width,
      alto: rect.size.height,
    }
  }

  function detenerAnimacion() {
    if (temporizadorPreparacion !== null) {
      GLib.source_remove(temporizadorPreparacion)
      temporizadorPreparacion = null
    }
    if (temporizadorFin !== null) {
      GLib.source_remove(temporizadorFin)
      temporizadorFin = null
    }
  }

  function aplicarGeometria(x: number, y: number, ancho: number, alto: number) {
    posicionActual = x
    posicionYActual = y
    anchoActual = ancho
    altoActual = alto
    capa.queue_allocate()
  }

  function dejarIndicadorQuieto() {
    establecerCssIndicador(".section-index-indicator { transform: none; }")
  }

  function animarIndicador(
    xAnterior: number,
    anchoAnterior: number,
    geometria: { x: number; y: number; ancho: number; alto: number },
  ) {
    detenerAnimacion()
    const desplazamiento = xAnterior - geometria.x
    const escalaInicial = Math.max(0.35, anchoAnterior / Math.max(1, geometria.ancho))
    const origen = desplazamiento < 0 ? "left center" : "right center"
    const nombre = `indice-movil-${++secuenciaAnimacion}`
    const transformacionInicial = `translateX(${desplazamiento.toFixed(2)}px) scaleX(${escalaInicial.toFixed(4)})`

    // Igual que la entrada de Orion: primero GTK asigna el widget en el destino
    // mientras el transform lo mantiene visualmente en el origen.
    establecerCssIndicador(`
      .section-index-indicator {
        transform-origin: ${origen};
        transform: ${transformacionInicial};
      }
    `)
    aplicarGeometria(geometria.x, geometria.y, geometria.ancho, geometria.alto)

    temporizadorPreparacion = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      PREPARACION_MOVIMIENTO_MS,
      () => {
        establecerCssIndicador(`
          @keyframes ${nombre} {
            from { transform: ${transformacionInicial}; }
            58% { transform: translateX(${(desplazamiento * 0.22).toFixed(2)}px) scaleX(1.06); }
            to { transform: translateX(0) scaleX(1); }
          }
          .section-index-indicator {
            transform-origin: ${origen};
            animation: ${nombre} ${DURACION_MOVIMIENTO_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
          }
        `)
        temporizadorPreparacion = null
        temporizadorFin = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          DURACION_MOVIMIENTO_MS + 32,
          () => {
            dejarIndicadorQuieto()
            temporizadorFin = null
            return GLib.SOURCE_REMOVE
          },
        )
        return GLib.SOURCE_REMOVE
      },
    )
  }

  function moverIndicador(section: SectionId, animar: boolean) {
    const destino = botones.get(section)
    for (const [id, boton] of botones) {
      boton.set_css_classes(id === section
        ? ["section-index-btn", "active"]
        : ["section-index-btn"])
    }

    if (!destino) {
      detenerAnimacion()
      indicador.opacity = 0
      return
    }

    const geometria = medir(destino)
    if (!geometria) return
    indicador.opacity = 1

    if (!animar || anchoActual <= 0) {
      detenerAnimacion()
      aplicarGeometria(geometria.x, geometria.y, geometria.ancho, geometria.alto)
      dejarIndicadorQuieto()
      return
    }

    const xInicial = posicionActual
    const anchoInicial = anchoActual
    animarIndicador(xInicial, anchoInicial, geometria)
  }

  root.connect("map", () => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      geometriaDisponible = true
      moverIndicador(activeSection.get(), false)
      return GLib.SOURCE_REMOVE
    })
  })
  // Los Accessor de Gnim notifican sin entregar el valor al callback. Leerlo
  // explícitamente evita tratar `undefined` como una sección y ocultar el fondo.
  const desuscribir = activeSection.subscribe(() => {
    const section = activeSection.get()
    if (geometriaDisponible) moverIndicador(section, true)
    else {
      for (const [id, boton] of botones) {
        boton.set_css_classes(id === section
          ? ["section-index-btn", "active"]
          : ["section-index-btn"])
      }
    }
  })
  root.connect("destroy", () => {
    detenerAnimacion()
    if (typeof desuscribir === "function") desuscribir()
  })

  return root
}
