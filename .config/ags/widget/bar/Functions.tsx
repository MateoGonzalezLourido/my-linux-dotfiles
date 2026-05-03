import { execAsync } from "ags/process"
import { Gtk } from "ags/gtk4"

const ICON = "font-family: 'JetBrainsMono Nerd Font'; font-size: 16px; color: #89b4fa; border: none; background: transparent; padding: 0 4px;"

export default function Functions() {
  return (
    <button
      css="background: transparent; border: none; padding: 0 2px;"
      valign={Gtk.Align.CENTER}
      onClicked={() => execAsync(["bash", "-c", `${SRC}/scripts/functions.sh`])}
    >
      <label css={ICON} label="󰣇" />
    </button>
  )
}
