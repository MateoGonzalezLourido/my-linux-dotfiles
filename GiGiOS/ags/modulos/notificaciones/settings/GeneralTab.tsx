import { Gtk } from "ags/gtk4"
import AutoDndSetting from "../../ajustes/AutoDndSetting"

/** Preferencias generales que afectan a la entrega de los avisos. */
export default function GeneralTab() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={10} hexpand>
      <AutoDndSetting />
    </box>
  )
}
