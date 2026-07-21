import { Gtk } from "ags/gtk4"

type PropiedadesTituloSubseccion = {
  label: any
  cssClasses?: string[]
  halign?: Gtk.Align
  [propiedad: string]: any
}

/** Título compartido para grupos internos de una sección de Ajustes. */
export default function TituloSubseccion({
  cssClasses = [],
  halign = Gtk.Align.START,
  ...propiedades
}: PropiedadesTituloSubseccion) {
  return (
    <label
      cssClasses={["sp-subsection-title", ...cssClasses]}
      halign={halign}
      {...propiedades}
    />
  )
}
