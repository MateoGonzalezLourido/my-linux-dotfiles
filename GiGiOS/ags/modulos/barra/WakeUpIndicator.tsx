// modulos/barra/WakeUpIndicator.tsx
// Icono de la barra visible solo mientras el "Wake up" está activo. Sin él, un Wake
// up sin límite es invisible: el PC deja de suspenderse para siempre y el menú de
// funciones (que hay que abrir a propósito) es el único sitio donde se ve por qué.
//
// A diferencia de ScreencastIndicator/UpdatesButton, aquí NO hay Gio.FileMonitor: el
// estado nace en AGS (functions/wakeup.ts) y wakeup.json es solo el canal de salida
// hacia bash. Se lee el estado directamente.

import { Gtk } from "ags/gtk4"
import { createComputed } from "ags"
import { wakeUpRemaining, wakeUpScreen, wakeUpActive } from "./functions/wakeup"
import { tooltipText } from "./functions/wakeupTime"

export default function WakeUpIndicator() {
  const tooltip = createComputed(
    [wakeUpRemaining, wakeUpScreen],
    (remaining: number | null, screen: boolean) => tooltipText(remaining, screen),
  )

  return (
    <box
      visible={wakeUpActive}
      valign={Gtk.Align.CENTER}
      cssClasses={["wakeup-indicator"]}
      tooltipText={tooltip}
    >
      <label label="󰅶" />
    </box>
  )
}
