import { With } from "ags"
import { Gtk } from "ags/gtk4"
import {
  fijarMantenerPantallaActiva,
  fijarMinutosMantenerDespierto,
  mantenerPantallaActiva,
  minutosMantenerDespierto,
} from "../../../servicios/energia/mantenerDespierto"

function EntradaMinutos() {
  let entrada: Gtk.Entry

  const confirmar = () => {
    fijarMinutosMantenerDespierto(entrada.text)
    entrada.text = minutosMantenerDespierto.get()
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
      $={(self: Gtk.Entry) => { entrada = self; self.text = minutosMantenerDespierto.get() }}
      onActivate={confirmar}
    >
      <Gtk.EventControllerFocus onLeave={confirmar} />
    </Gtk.Entry>
  )
}

export default function OpcionesMantenerDespierto() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["fn-menu-expand"]} spacing={2}>
      <box cssClasses={["fn-menu-subrow"]} spacing={6} valign={Gtk.Align.CENTER}>
        <label cssClasses={["fn-menu-sublabel"]} label="Minutos" xalign={0} hexpand />
        <EntradaMinutos />
      </box>

      <button
        cssClasses={["fn-menu-subbutton"]}
        focusable={false}
        tooltipText={"También impide que la pantalla se apague y bloquee.\nSin esto, solo se evita la suspensión."}
        onClicked={() => fijarMantenerPantallaActiva(!mantenerPantallaActiva.get())}
      >
        <box cssClasses={["fn-menu-subrow"]} spacing={6}>
          <label cssClasses={["fn-menu-sublabel"]} label="Pantalla" xalign={0} hexpand />
          <With value={mantenerPantallaActiva}>
            {(activa: boolean) => (
              <box cssClasses={activa ? ["fn-menu-state", "on"] : ["fn-menu-state"]}>
                <label label={activa ? "ON" : "OFF"} />
              </box>
            )}
          </With>
        </box>
      </button>
    </box>
  )
}
