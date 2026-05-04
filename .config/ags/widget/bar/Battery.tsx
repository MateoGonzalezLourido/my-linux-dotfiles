import AstalBattery from "gi://AstalBattery"
import { createBinding } from "ags"
import { Gtk } from "ags/gtk4"

function batIcon(pct: number, charging: boolean) {
  if (charging) return "󰂄"
  if (pct > 90) return "󰁹"
  if (pct > 70) return "󰂀"
  if (pct > 40) return "󰁾"
  if (pct > 20) return "󰁼"
  return "󰁺"
}

export default function Battery() {
  const bat = AstalBattery.get_default()
  const pct = createBinding(bat, "percentage")

  return (
    <box 
      cssClasses={pct((p) => [
        "battery-pill",
        p * 100 < 20 ? "low" : p * 100 < 60 ? "medium" : "normal"
      ])}
      css={pct((p) => `
        background: linear-gradient(to right, 
          ${p * 100 < 20 ? "#f38ba8" : p * 100 < 60 ? "#f9e2af" : "#a6e3a1"} ${Math.round(p * 100)}%, 
          rgba(17, 17, 27, 0.6) ${Math.round(p * 100)}%
        );
        border-radius: 99px;
      `)}
    >
      <label
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        hexpand
        vexpand
        cssClasses={["battery-text"]}
        label={pct((p) => `${Math.round(p * 100)}%`)}
      />
    </box>
  )
}
