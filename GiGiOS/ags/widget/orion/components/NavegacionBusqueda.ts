export interface ElementoNavegacionBusqueda {
  marcarSeleccionado: (seleccionado: boolean) => void
  activar: () => void
  previsualizar?: () => void
}

type ZonaNavegacion = "resultados" | "submenu"

/**
 * Fuente única de verdad para la navegación del buscador de Orion.
 *
 * El foco de GTK permanece libre para la entrada de texto y la accesibilidad;
 * la selección visible y la activación dependen exclusivamente de este modelo.
 */
export class NavegacionBusqueda {
  private resultados: ElementoNavegacionBusqueda[] = []
  private acciones: ElementoNavegacionBusqueda[] = []
  private indiceResultado = -1
  private indiceAccion = -1
  private zona: ZonaNavegacion = "resultados"

  establecerResultados(resultados: ElementoNavegacionBusqueda[]): void {
    this.desmarcarTodos()
    this.resultados = resultados
    this.indiceResultado = resultados.length > 0 ? 0 : -1
    this.zona = "resultados"
    this.marcarResultadoActual()
  }

  establecerAcciones(acciones: ElementoNavegacionBusqueda[]): void {
    for (const accion of this.acciones) accion.marcarSeleccionado(false)
    this.acciones = acciones
    this.indiceAccion = acciones.length > 0 ? 0 : -1

    if (this.zona !== "submenu") return
    if (acciones.length === 0) {
      this.zona = "resultados"
      this.marcarResultadoActual()
      return
    }
    this.marcarAccionActual()
  }

  seleccionarResultado(
    resultado: ElementoNavegacionBusqueda,
    previsualizar = true,
  ): boolean {
    const indice = this.resultados.indexOf(resultado)
    if (indice < 0) return false
    this.seleccionarIndiceResultado(indice, previsualizar)
    return true
  }

  seleccionarAccion(accion: ElementoNavegacionBusqueda): boolean {
    const indice = this.acciones.indexOf(accion)
    if (indice < 0) return false

    this.desmarcarResultadoActual()
    this.desmarcarAccionActual()
    this.zona = "submenu"
    this.indiceAccion = indice
    this.marcarAccionActual()
    return true
  }

  moverResultados(direccion: 1 | -1): boolean {
    if (this.resultados.length === 0) return false
    const base = Math.max(0, this.indiceResultado)
    const siguiente = (base + direccion + this.resultados.length) % this.resultados.length
    this.seleccionarIndiceResultado(siguiente, true)
    return true
  }

  moverVertical(direccion: 1 | -1): boolean {
    if (this.zona === "resultados") return this.moverResultados(direccion)
    if (this.acciones.length === 0) return false

    this.desmarcarAccionActual()
    const base = Math.max(0, this.indiceAccion)
    this.indiceAccion = (base + direccion + this.acciones.length) % this.acciones.length
    this.marcarAccionActual()
    return true
  }

  entrarSubmenu(): boolean {
    if (this.indiceResultado < 0 || this.acciones.length === 0) return false
    this.desmarcarResultadoActual()
    this.desmarcarAccionActual()
    this.zona = "submenu"
    this.indiceAccion = 0
    this.marcarAccionActual()
    return true
  }

  salirSubmenu(): boolean {
    if (this.zona !== "submenu") return false
    this.desmarcarAccionActual()
    this.zona = "resultados"
    this.marcarResultadoActual()
    return true
  }

  activarSeleccionado(): boolean {
    const elemento = this.zona === "submenu"
      ? this.acciones[this.indiceAccion]
      : this.resultados[this.indiceResultado]
    if (!elemento) return false
    elemento.activar()
    return true
  }

  private seleccionarIndiceResultado(indice: number, previsualizar: boolean): void {
    const cambio = this.zona !== "resultados" || indice !== this.indiceResultado
    this.desmarcarAccionActual()
    this.desmarcarResultadoActual()
    this.zona = "resultados"
    this.indiceResultado = indice
    const resultado = this.resultados[indice]
    resultado?.marcarSeleccionado(true)
    if (cambio && previsualizar) resultado?.previsualizar?.()
  }

  private marcarResultadoActual(): void {
    this.resultados[this.indiceResultado]?.marcarSeleccionado(true)
  }

  private desmarcarResultadoActual(): void {
    this.resultados[this.indiceResultado]?.marcarSeleccionado(false)
  }

  private marcarAccionActual(): void {
    this.acciones[this.indiceAccion]?.marcarSeleccionado(true)
  }

  private desmarcarAccionActual(): void {
    this.acciones[this.indiceAccion]?.marcarSeleccionado(false)
  }

  private desmarcarTodos(): void {
    for (const resultado of this.resultados) resultado.marcarSeleccionado(false)
    for (const accion of this.acciones) accion.marcarSeleccionado(false)
  }
}
