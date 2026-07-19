import { Gtk } from "ags/gtk4"

type PropiedadesTituloAjuste = {
  label: any
  cssClasses?: string[]
  halign?: Gtk.Align
  [propiedad: string]: any
}

/** Etiqueta principal compartida por los controles de Ajustes. */
export default function TituloAjuste({
  cssClasses = [],
  halign = Gtk.Align.START,
  ...propiedades
}: PropiedadesTituloAjuste) {
  return (
    <label
      cssClasses={["sp-field-label", ...cssClasses]}
      halign={halign}
      {...propiedades}
    />
  )
}
