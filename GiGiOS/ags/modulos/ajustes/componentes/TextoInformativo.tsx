import { Gtk } from "ags/gtk4"

type PropiedadesTextoInformativo = {
  label: any
  cssClasses?: string[]
  halign?: Gtk.Align
  [propiedad: string]: any
}

/** Texto secundario compartido para descripciones y avisos de Ajustes. */
export default function TextoInformativo({
  cssClasses = [],
  halign = Gtk.Align.START,
  ...propiedades
}: PropiedadesTextoInformativo) {
  return (
    <label
      cssClasses={["sp-field-hint", ...cssClasses]}
      halign={halign}
      {...propiedades}
    />
  )
}
