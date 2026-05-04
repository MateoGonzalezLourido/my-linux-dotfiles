import { execAsync } from "ags/process"
import { Gtk } from "ags/gtk4"

export default function Functions() {
  return (
    <button
      cssClasses={["own-functions"]}
      css=""
      valign={Gtk.Align.CENTER}
      onClicked={() => execAsync(["bash", "-c", `${SRC}/scripts/functions.sh`])}
    >
      <label label="󰣇" />
    </button>
  )
}
