import { Gtk } from "ags/gtk4"

type PropiedadesTituloSeccion = {
  titulo: string
  cssClasses?: string[]
  halign?: Gtk.Align
  [propiedad: string]: any
}

/** Título principal compartido por todas las secciones de Ajustes. */
export default function TituloSeccion({
  titulo,
  cssClasses = [],
  halign = Gtk.Align.START,
  ...propiedades
}: PropiedadesTituloSeccion) {
  return (
    <label
      cssClasses={["sp-section-title", ...cssClasses]}
      label={`✦ ${titulo}`}
      halign={halign}
      {...propiedades}
    />
  )
}
