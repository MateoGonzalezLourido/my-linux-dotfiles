// Desplegable de la fila "Wake up" del menú de funciones: campo de minutos +
// interruptor "Pantalla". Se monta solo mientras la función está encendida
// (Functions.tsx), así que el menú sigue igual de compacto cuando está apagada.
//
// Va FUERA del <button> de la fila a propósito: dentro, cualquier clic en el campo
// o en el interruptor llegaría también al botón y apagaría el Wake up.

import { Gtk } from "ags/gtk4"
import { With } from "ags"
import {
  wakeUpMinutes, setWakeUpMinutes,
  wakeUpScreen, setWakeUpScreen,
} from "./wakeup"

// Campo de minutos. Vacío = sin límite, que es lo que dice el placeholder (∞).
// Confirma al pulsar Enter y al salir del campo, igual que InlineEditableValue.
function MinutesEntry() {
  let entry: Gtk.Entry

  const commit = () => {
    setWakeUpMinutes(entry.text)
    // Reescribe lo confirmado: parseMinutes normaliza ("007" → "7", "0" → vacío,
    // >24 h → tope), y el campo debe enseñar lo que de verdad se ha programado.
    entry.text = wakeUpMinutes.get()
  }

  return (
    <Gtk.Entry
      cssClasses={["fn-menu-minutes"]}
      maxLength={4}
      widthChars={1}
      maxWidthChars={4}
      widthRequest={38}
      heightRequest={16}
      xalign={1}
      placeholderText="∞"
      inputPurpose={Gtk.InputPurpose.DIGITS}
      tooltipText={"Minutos que el PC seguirá despierto.\nVacío = sin límite."}
      $={(self: Gtk.Entry) => { entry = self; self.text = wakeUpMinutes.get() }}
      onActivate={commit}
    >
      <Gtk.EventControllerFocus onLeave={commit} />
    </Gtk.Entry>
  )
}

export default function WakeUpOptions() {
  return (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["fn-menu-expand"]}
      spacing={2}
    >
      <box cssClasses={["fn-menu-subrow"]} spacing={6} valign={Gtk.Align.CENTER}>
        <label cssClasses={["fn-menu-sublabel"]} label="Minutos" xalign={0} hexpand />
        <MinutesEntry />
      </box>

      <button
        cssClasses={["fn-menu-subbutton"]}
        focusable={false}
        tooltipText={"También impide que la pantalla se apague y bloquee.\nSin esto, solo se evita la suspensión."}
        onClicked={() => setWakeUpScreen(!wakeUpScreen.get())}
      >
        <box cssClasses={["fn-menu-subrow"]} spacing={6}>
          <label cssClasses={["fn-menu-sublabel"]} label="Pantalla" xalign={0} hexpand />
          {/* El chip lleva su propia clase .on: el ON/OFF de las filas normales se
              colorea vía `.fn-menu-button.active .fn-menu-state`, y aquí el botón
              padre no es el que está activo — lo está esta subopción. Va el último
              del box para que, al remontarse el <With>, siga cayendo en su sitio. */}
          <With value={wakeUpScreen}>
            {(on: boolean) => (
              <box cssClasses={on ? ["fn-menu-state", "on"] : ["fn-menu-state"]}>
                <label label={on ? "ON" : "OFF"} />
              </box>
            )}
          </With>
        </box>
      </button>
    </box>
  )
}
