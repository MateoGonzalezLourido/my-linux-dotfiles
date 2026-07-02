import { execAsync } from "ags/process"
import { Gtk } from "ags/gtk4"

export default function Functions() {
  return (
    <button
      cssClasses={["bar-pill-btn"]}
      css=""
      valign={Gtk.Align.CENTER}
      onClicked={() => execAsync(["bash", "-c", `${SRC}/scripts/functions.sh`])}
    >
      <box cssClasses={["bar-pill", "own-functions"]} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
        <label label="󰣇" halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} hexpand />
      </box>
    </button>
  )
}
