import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import {
  searchResults,
  setSection,
  hidePanel,
  showAppContext,
  hideRightPanel,
} from "../../state"
import type { SearchResult } from "../../search"
import type {
  ElementoNavegacionBusqueda,
  NavegacionBusqueda,
} from "../NavegacionBusqueda"

function mostrarContextoApp(resultado: SearchResult): void {
  const nombreEjecutable = resultado.meta?.execName ?? ""
  showAppContext({
    id: resultado.id,
    name: resultado.title,
    iconName: resultado.iconName ?? "application-x-executable",
    gicon: resultado.icon ?? null,
    execRaw: resultado.meta?.exec ?? "",
    execName: nombreEjecutable,
    appId: resultado.meta?.appId ?? resultado.id,
    launch: () => resultado.action(),
  })
}

function activarResultado(resultado: SearchResult): void {
  if (resultado.navigateTo) {
    setSection(resultado.navigateTo)
    return
  }
  resultado.action()
  hidePanel()
}

function crearFila(
  resultado: SearchResult,
  navegacion: NavegacionBusqueda,
): { contenedor: Gtk.Box; navegable: ElementoNavegacionBusqueda } {
  const esApp = !!resultado.meta?.exec

  const contenedor = new Gtk.Box({ cssClasses: ["rx-result-row"] })
  const boton = new Gtk.Button({ cssClasses: ["rx-item"], hexpand: true })
  const fila = new Gtk.Box({ cssClasses: ["rx-row"], spacing: 12 })

  // Icono
  const contenedorIcono = new Gtk.Box({ cssClasses: ["rx-icon-wrap"], valign: Gtk.Align.CENTER })
  if (resultado.icon) {
    const imagen = Gtk.Image.new_from_gicon(resultado.icon)
    imagen.pixel_size = 26
    contenedorIcono.append(imagen)
  } else {
    contenedorIcono.append(new Gtk.Image({ iconName: resultado.iconName ?? "application-x-executable", pixelSize: 26 }))
  }
  fila.append(contenedorIcono)

  // Texto
  const columnaTexto = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, hexpand: true })
  columnaTexto.append(new Gtk.Label({ label: resultado.title, cssClasses: ["rx-title"], halign: Gtk.Align.START, ellipsize: 3 }))
  if (resultado.subtitle) {
    columnaTexto.append(new Gtk.Label({ label: resultado.subtitle, cssClasses: ["rx-subtitle"], halign: Gtk.Align.START, ellipsize: 3 }))
  }
  fila.append(columnaTexto)
  boton.set_child(fila)

  const navegable: ElementoNavegacionBusqueda = {
    marcarSeleccionado: (seleccionado) => {
      if (seleccionado) boton.add_css_class("seleccionado")
      else boton.remove_css_class("seleccionado")
    },
    previsualizar: () => {
      if (esApp) mostrarContextoApp(resultado)
      else hideRightPanel()
    },
    activar: () => activarResultado(resultado),
  }

  // Ratón y accesibilidad también entran por el modelo único; el foco de
  // GTK nunca pinta una selección paralela por su cuenta.
  boton.connect("notify::has-focus", () => {
    if (boton.has_focus) navegacion.seleccionarResultado(navegable, false)
  })

  let suprimirClic = false
  boton.connect("clicked", () => {
    navegacion.seleccionarResultado(navegable)
    if (suprimirClic) { suprimirClic = false; return }
    if (resultado.navigateTo) {
      setSection(resultado.navigateTo)
    } else if (!esApp) {
      resultado.action()
      hidePanel()
    } else {
      mostrarContextoApp(resultado)
    }
  })

  if (esApp) {
    const gesto = new Gtk.GestureClick()
    gesto.set_button(1)
    gesto.propagation_phase = Gtk.PropagationPhase.CAPTURE
    gesto.connect("pressed", (_gesto, pulsaciones) => {
      if (pulsaciones !== 2) return
      navegacion.seleccionarResultado(navegable, false)
      suprimirClic = true
      // Al ocultarse la ventana, GTK puede omitir la señal "clicked" final.
      // Soltar la guarda por separado conserva el siguiente clic normal.
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
        suprimirClic = false
        return GLib.SOURCE_REMOVE
      })
      resultado.action()
      hidePanel()
    })
    boton.add_controller(gesto)
  }

  contenedor.append(boton)
  return { contenedor, navegable }
}

export function ReactiveSection(
  navegacion: NavegacionBusqueda,
) {
  const contenido = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["rx-content"] })

  const etiquetaVacia = new Gtk.Label({ label: "Sin resultados", cssClasses: ["rx-empty"] })
  etiquetaVacia.visible = false
  contenido.append(etiquetaVacia)

  function reconstruir(resultados: SearchResult[]) {
    let hijo = contenido.get_first_child()
    while (hijo) {
      const siguiente = hijo.get_next_sibling()
      if (hijo !== etiquetaVacia) contenido.remove(hijo)
      hijo = siguiente
    }
    if (resultados.length === 0) {
      navegacion.establecerResultados([])
      etiquetaVacia.visible = true
      return
    }
    etiquetaVacia.visible = false
    const navegables: ElementoNavegacionBusqueda[] = []
    for (const resultado of resultados) {
      const { contenedor, navegable } = crearFila(resultado, navegacion)
      contenido.append(contenedor)
      navegables.push(navegable)
    }
    navegacion.establecerResultados(navegables)
  }

  searchResults.subscribe(() => reconstruir(searchResults.get()))
  reconstruir(searchResults.get())

  return contenido
}
