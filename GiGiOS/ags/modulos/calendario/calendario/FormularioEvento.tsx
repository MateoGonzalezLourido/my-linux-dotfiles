import { Gtk } from "ags/gtk4"
import { COLORES_EVENTO, COLOR_HEX } from "../dominio/tipos.ts"
import type { BorradorEvento } from "../dominio/tipos.ts"
import { errorDeCampo, validarEvento } from "../dominio/validacion.ts"
import {
  actualizarEvento,
  cerrarEdicion,
  crearEvento,
  edicion,
} from "../estado.ts"
import { crearCampoFecha, crearCampoHora } from "./campos.tsx"

/**
 * Editor de eventos, mostrado como overlay sobre el panel.
 *
 * **El formulario NO es reactivo respecto al estado global, y eso es deliberado.** Se construye una
 * vez al abrirse, con una copia local del borrador, y solo escribe en el estado al guardar. Si cada
 * tecla actualizara `edicion`, el `<With>` que monta este componente lo destruiría y reconstruiría
 * en mitad del evento de teclado — que es literalmente el fallo que hizo caer el shell entero al
 * editar las franjas horarias de Ajustes > Pantalla (ver `ags/CLAUDE.md`). Aquí el estado global se
 * entera al final; lo que se ve mientras tanto vive en los propios widgets.
 *
 * Lo único que sí reacciona es el mensaje de validación, que es una etiqueta y no reconstruye nada.
 */
export function FormularioEvento(): Gtk.Widget {
  const actual = edicion.get()
  if (!actual) return new Gtk.Box()

  // Copia local: cancelar debe dejar el original intacto.
  const borrador: BorradorEvento = {
    ...actual.borrador,
    inicio: { ...actual.borrador.inicio },
    fin: { ...actual.borrador.fin },
  }

  const errorTitulo = new Gtk.Label({ label: "" })
  errorTitulo.set_css_classes(["cal-form-error"])
  errorTitulo.set_halign(Gtk.Align.START)
  errorTitulo.set_visible(false)

  const errorFechas = new Gtk.Label({ label: "" })
  errorFechas.set_css_classes(["cal-form-error"])
  errorFechas.set_halign(Gtk.Align.START)
  errorFechas.set_wrap(true)
  errorFechas.set_visible(false)

  const botonGuardar = new Gtk.Button()
  botonGuardar.set_css_classes(["cal-btn", "primario"])
  botonGuardar.set_child(new Gtk.Label({ label: actual.modo === "crear" ? "Crear" : "Guardar" }))

  // El error del título no se enseña hasta que el usuario ha escrito algo o ha intentado guardar.
  // Abrir un formulario vacío con un «El título no puede estar vacío» ya puesto regaña por no haber
  // hecho todavía nada; el botón deshabilitado ya dice que falta algo.
  let tituloTocado = false

  function revalidar() {
    const errores = validarEvento(borrador)
    const deTitulo = tituloTocado ? errorDeCampo(errores, "titulo") : null
    errorTitulo.set_label(deTitulo ?? "")
    errorTitulo.set_visible(deTitulo !== null)

    const deFechas = errorDeCampo(errores, "fin") ?? errorDeCampo(errores, "inicio")
    errorFechas.set_label(deFechas ?? "")
    errorFechas.set_visible(deFechas !== null)

    botonGuardar.set_sensitive(errores.length === 0)
  }

  // ── Título ────────────────────────────────────────────────────────────────
  const entradaTitulo = new Gtk.Entry({ text: borrador.titulo })
  entradaTitulo.set_css_classes(["cal-form-entry", "cal-title-entry"])
  entradaTitulo.set_placeholder_text("Título del evento")
  entradaTitulo.set_hexpand(true)
  entradaTitulo.connect("changed", () => {
    borrador.titulo = entradaTitulo.get_text()
    tituloTocado = true
    revalidar()
  })

  // ── Fechas y horas ────────────────────────────────────────────────────────
  const fechaInicio = crearCampoFecha(borrador.inicio.fecha, (iso) => {
    borrador.inicio.fecha = iso
    // Mover el inicio por delante del fin arrastra el fin con él: es lo que se espera al cambiar el
    // día de una cita, y evita dejar el formulario en error por un paso intermedio.
    if (borrador.fin.fecha < iso) {
      borrador.fin.fecha = iso
      fechaFin.establecer(iso)
    }
    revalidar()
  })
  const horaInicio = crearCampoHora(borrador.inicio.hora ?? "09:00", (h) => {
    borrador.inicio.hora = h
    revalidar()
  })
  const fechaFin = crearCampoFecha(borrador.fin.fecha, (iso) => {
    borrador.fin.fecha = iso
    revalidar()
  })
  const horaFin = crearCampoHora(borrador.fin.hora ?? "10:00", (h) => {
    borrador.fin.hora = h
    revalidar()
  })

  // ── Día completo ──────────────────────────────────────────────────────────
  const interruptorDia = new Gtk.Switch({ active: borrador.todoElDia })
  interruptorDia.set_valign(Gtk.Align.CENTER)

  function aplicarTodoElDia(activo: boolean) {
    borrador.todoElDia = activo
    horaInicio.setSensible(!activo)
    horaFin.setSensible(!activo)
    if (activo) {
      // Las horas se BORRAN del borrador, no solo se ocultan: dejarlas puestas escribiría en disco
      // un evento «de día completo» con hora, que al releerlo vuelve a ser un evento con hora.
      delete borrador.inicio.hora
      delete borrador.fin.hora
    } else {
      borrador.inicio.hora = horaInicio.obtener()
      borrador.fin.hora = horaFin.obtener()
    }
    revalidar()
  }
  interruptorDia.connect("notify::active", () => aplicarTodoElDia(interruptorDia.get_active()))

  // ── Color ─────────────────────────────────────────────────────────────────
  const filaColores = new Gtk.Box({ spacing: 6 })
  filaColores.set_css_classes(["cal-color-row"])
  const botonesColor = new Map<string, Gtk.Button>()
  for (const color of COLORES_EVENTO) {
    const boton = new Gtk.Button()
    boton.set_css_classes(color === borrador.color ? ["cal-color-swatch", "active"] : ["cal-color-swatch"])
    // El color se pinta inline porque los seis hex viven en `dominio/tipos.ts`, que es también quien
    // los da a los puntos de la rejilla: una segunda copia en SCSS se desincronizaría.
    boton.set_child(
      (
        <box
          cssClasses={["cal-color-muestra"]}
          css={`background-color: ${COLOR_HEX[color]};`}
          widthRequest={18}
          heightRequest={18}
        />
      ) as unknown as Gtk.Widget,
    )
    boton.set_tooltip_text(color)
    boton.connect("clicked", () => {
      borrador.color = color
      for (const [c, b] of botonesColor) {
        b.set_css_classes(c === color ? ["cal-color-swatch", "active"] : ["cal-color-swatch"])
      }
    })
    botonesColor.set(color, boton)
    filaColores.append(boton)
  }

  // ── Descripción y ubicación ───────────────────────────────────────────────
  const entradaUbicacion = new Gtk.Entry({ text: borrador.ubicacion ?? "" })
  entradaUbicacion.set_css_classes(["cal-form-entry"])
  entradaUbicacion.set_placeholder_text("Ubicación (opcional)")
  entradaUbicacion.set_hexpand(true)
  entradaUbicacion.connect("changed", () => {
    const t = entradaUbicacion.get_text().trim()
    if (t === "") delete borrador.ubicacion
    else borrador.ubicacion = t
  })

  const entradaDescripcion = new Gtk.Entry({ text: borrador.descripcion ?? "" })
  entradaDescripcion.set_css_classes(["cal-form-entry"])
  entradaDescripcion.set_placeholder_text("Descripción (opcional)")
  entradaDescripcion.set_hexpand(true)
  entradaDescripcion.connect("changed", () => {
    const t = entradaDescripcion.get_text().trim()
    if (t === "") delete borrador.descripcion
    else borrador.descripcion = t
  })

  function guardar() {
    if (validarEvento(borrador).length > 0) {
      // Intentar guardar cuenta como haber interactuado: aquí el error sí hay que explicarlo.
      tituloTocado = true
      revalidar()
      return
    }
    if (actual!.modo === "crear") crearEvento(borrador)
    else if (actual!.id) actualizarEvento(actual!.id, borrador)
    cerrarEdicion()
  }

  botonGuardar.connect("clicked", guardar)
  entradaTitulo.connect("activate", guardar)

  aplicarTodoElDia(borrador.todoElDia)
  revalidar()

  const fila = (etiqueta: string, ...hijos: Gtk.Widget[]) =>
    (
      <box cssClasses={["cal-form-row"]} spacing={8}>
        <label cssClasses={["cal-form-label"]} label={etiqueta} halign={Gtk.Align.START} valign={Gtk.Align.CENTER} />
        {hijos}
      </box>
    ) as unknown as Gtk.Widget

  return (
    <box cssClasses={["cal-dialog-backdrop"]} hexpand vexpand halign={Gtk.Align.FILL} valign={Gtk.Align.FILL}>
      <box
        cssClasses={["cal-dialog-card"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={10}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        hexpand
      >
        <box cssClasses={["cal-dialog-header"]}>
          <label
            cssClasses={["cal-dialog-title"]}
            label={actual.modo === "crear" ? "Nuevo evento" : "Editar evento"}
            hexpand
            halign={Gtk.Align.START}
          />
          <button cssClasses={["cal-icon-btn"]} onClicked={() => cerrarEdicion()}>
            <label label="✕" />
          </button>
        </box>

        {entradaTitulo}
        {errorTitulo}

        {fila("Empieza", fechaInicio.widget, horaInicio.widget)}
        {fila("Termina", fechaFin.widget, horaFin.widget)}
        {errorFechas}

        <box cssClasses={["cal-form-row"]} spacing={8}>
          <label cssClasses={["cal-form-label"]} label="Todo el día" halign={Gtk.Align.START} hexpand />
          {interruptorDia}
        </box>

        {fila("Color", filaColores)}
        {entradaUbicacion}
        {entradaDescripcion}

        <box cssClasses={["cal-dialog-actions"]} spacing={8} halign={Gtk.Align.END}>
          <button cssClasses={["cal-btn"]} onClicked={() => cerrarEdicion()}>
            <label label="Cancelar" />
          </button>
          {botonGuardar}
        </box>
      </box>
    </box>
  ) as unknown as Gtk.Widget
}
