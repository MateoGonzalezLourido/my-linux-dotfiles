import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import { DisplaySelect } from "../display/controls"
import {
  deviceSettings, updateDeviceSettings, resetDeviceSettings,
  type DeviceSettings,
} from "../devices/service"
import {
  printerStatus, printerBusy, refresh as refreshPrinters,
  setCupsEnabled, openCupsWeb,
} from "../devices/printers"

type Key = keyof DeviceSettings

function ToggleRow({ setting, label, hint }: { setting: Key, label: string, hint: string }) {
  const active = deviceSettings((s) => Boolean(s[setting]))
  return (
    <box cssClasses={["dev-row"]} spacing={12} valign={Gtk.Align.CENTER}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
        <label cssClasses={["sp-field-label"]} label={label} halign={Gtk.Align.START} />
        <label cssClasses={["sp-field-hint"]} label={hint} halign={Gtk.Align.START} wrap xalign={0} maxWidthChars={54} />
      </box>
      <button cssClasses={active((v) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
        onClicked={() => updateDeviceSettings({ [setting]: !Boolean(deviceSettings.get()[setting]) })}>
        <box cssClasses={["qs-toggle-track"]}>
          <box cssClasses={active((v) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
        </box>
      </button>
    </box>
  )
}

function SliderRow({ setting, label, hint, min, max, step, format }: {
  setting: Key, label: string, hint: string, min: number, max: number, step: number,
  format: (n: number) => string,
}) {
  const adjustment = new Gtk.Adjustment({ lower: min, upper: max, stepIncrement: step, pageIncrement: step * 5 })
  adjustment.value = Number(deviceSettings.get()[setting])
  const scale = new Gtk.Scale({ orientation: Gtk.Orientation.HORIZONTAL, adjustment, drawValue: false, hexpand: true })
  scale.cssClasses = ["qs-slider", "dev-slider"]
  scale.connect("change-value", (_s, _scroll, value) => {
    updateDeviceSettings({ [setting]: Math.round(value / step) * step })
    return false
  })
  const unsub = deviceSettings.subscribe(() => { adjustment.value = Number(deviceSettings.get()[setting]) })
  scale.connect("destroy", () => { if (typeof unsub === "function") unsub() })
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={7} cssClasses={["dev-row"]}>
      <box spacing={8}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label cssClasses={["sp-field-label"]} label={label} halign={Gtk.Align.START} />
          <label cssClasses={["sp-field-hint"]} label={hint} halign={Gtk.Align.START} />
        </box>
        <label cssClasses={["sp-field-value", "dev-value"]} label={deviceSettings((s) => format(Number(s[setting])))} />
      </box>
      {scale}
    </box>
  )
}

function SelectRow({ setting, label, hint, choices, reload = false }: {
  setting: Key, label: string, hint: string, choices: { value: string | number, label: string }[], reload?: boolean,
}) {
  const current = deviceSettings((s) => choices.find(c => String(c.value) === String(s[setting]))?.label ?? String(s[setting]))
  const options = deviceSettings((s) => choices.map(c => ({ ...c, value: String(c.value), active: String(c.value) === String(s[setting]) })))
  return (
    <box cssClasses={["dev-row"]} spacing={14} valign={Gtk.Align.CENTER}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
        <label cssClasses={["sp-field-label"]} label={label} halign={Gtk.Align.START} />
        <label cssClasses={["sp-field-hint"]} label={hint} halign={Gtk.Align.START} />
      </box>
      <box cssClasses={["dev-select"]}>
        <DisplaySelect current={current} options={options} onSelect={(v) => {
          const choice = choices.find(c => String(c.value) === v)
          if (choice) updateDeviceSettings({ [setting]: choice.value } as Partial<DeviceSettings>, reload)
        }} />
      </box>
    </box>
  )
}

function Card({ title, icon, children }: { title: string, icon: string, children: any }) {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["dev-card"]}>
      <box spacing={8} cssClasses={["dev-card-header"]}>
        <label cssClasses={["dev-card-icon"]} label={icon} />
        <label cssClasses={["sp-subsection-title"]} label={title} halign={Gtk.Align.START} />
      </box>
      {children}
    </box>
  )
}

// Bloque de impresoras: un interruptor maestro para CUPS, con estado en vivo y
// acceso al panel web. La lógica de sistema vive en ../devices/printers.
function PrintersCard() {
  const stateLabel = printerStatus((s) => !s.available ? "No instalado" : s.active ? "Activo" : "Inactivo")
  const dotClass = printerStatus((s) => !s.available ? ["dev-status-dot"] : s.active ? ["dev-status-dot", "on"] : ["dev-status-dot", "off"])
  const dotToggle = printerStatus((s) => s.enabled ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])
  return (
    <Card title="Impresoras" icon="󰐪">
      <box cssClasses={["dev-row"]} spacing={12} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label cssClasses={["sp-field-label"]} label="Servicio de impresión (CUPS)" halign={Gtk.Align.START} />
          <label cssClasses={["sp-field-hint"]}
            label={printerStatus((s) => !s.available
              ? "CUPS no está instalado en este sistema"
              : "Activa la impresión y su arranque automático")}
            halign={Gtk.Align.START} wrap xalign={0} maxWidthChars={54} />
        </box>
        <button
          cssClasses={printerStatus((s) => s.enabled ? ["qs-toggle", "on"] : ["qs-toggle"])}
          sensitive={printerStatus((s) => s.available)}
          onClicked={() => { if (!printerBusy.get()) setCupsEnabled(!printerStatus.get().enabled) }}>
          <box cssClasses={["qs-toggle-track"]}>
            <box cssClasses={dotToggle} />
          </box>
        </button>
      </box>

      <box cssClasses={["dev-row"]} spacing={10} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label cssClasses={["sp-field-label"]} label="Estado" halign={Gtk.Align.START} />
        </box>
        <box spacing={7} valign={Gtk.Align.CENTER}>
          <box cssClasses={dotClass} valign={Gtk.Align.CENTER} />
          <label cssClasses={["sp-field-value", "dev-value"]} label={stateLabel} />
        </box>
      </box>

      <box visible={printerStatus((s) => s.active)} cssClasses={["dev-row"]} spacing={10} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label cssClasses={["sp-field-label"]} label="Configuración de impresoras" halign={Gtk.Align.START} />
          <label cssClasses={["sp-field-hint"]} label="Añade o gestiona impresoras en el panel web de CUPS" halign={Gtk.Align.START} wrap xalign={0} maxWidthChars={54} />
        </box>
        <button cssClasses={["dev-reset"]} onClicked={() => openCupsWeb()}>
          <label label="Abrir ↗" />
        </button>
      </box>
    </Card>
  )
}

export default function DevicesSection() {
  const [confirmReset, setConfirmReset] = createState(false)
  refreshPrinters()
  return (
    <overlay cssClasses={["display-select-host"]}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <label cssClasses={["sp-section-title"]} label="✦ Dispositivos" halign={Gtk.Align.START} />
          <label cssClasses={["sp-field-hint"]} label="Ratón, touchpad, teclado y gestos · los cambios se aplican al instante" halign={Gtk.Align.START} />
        </box>

        <Card title="Ratón" icon="󰍽">
          <SliderRow setting="sensitivity" label="Velocidad del puntero" hint="Ajuste de sensibilidad de Hyprland" min={-1} max={1} step={0.05} format={v => `${v > 0 ? "+" : ""}${v.toFixed(2)}`} />
          <SelectRow setting="accelProfile" label="Aceleración" hint="Adaptativa para uso general; plana para precisión" choices={[{ value: "adaptive", label: "Adaptativa" }, { value: "flat", label: "Plana" }]} />
          <SliderRow setting="mouseScrollFactor" label="Velocidad de desplazamiento" hint="Multiplicador de la rueda" min={0.1} max={3} step={0.1} format={v => `${v.toFixed(1)}×`} />
          <ToggleRow setting="forceNoAccel" label="Movimiento sin aceleración" hint="Fuerza una relación directa con el movimiento físico" />
          <ToggleRow setting="leftHanded" label="Modo zurdo" hint="Intercambia los botones principal y secundario" />
          <ToggleRow setting="mouseNaturalScroll" label="Desplazamiento natural" hint="El contenido sigue la dirección de la rueda" />
        </Card>

        <Card title="Touchpad" icon="󰟸">
          <SliderRow setting="touchpadScrollFactor" label="Velocidad de desplazamiento" hint="Sensibilidad del gesto de dos dedos" min={0.1} max={3} step={0.1} format={v => `${v.toFixed(1)}×`} />
          <ToggleRow setting="touchpadNaturalScroll" label="Desplazamiento natural" hint="Mueve el contenido en la dirección de los dedos" />
          <ToggleRow setting="tapToClick" label="Tocar para hacer clic" hint="Un toque equivale al botón principal" />
          <SelectRow setting="tapButtonMap" label="Mapa de toques" hint="Acción al tocar con dos y tres dedos" choices={[{ value: "lrm", label: "2: derecho · 3: medio" }, { value: "lmr", label: "2: medio · 3: derecho" }]} />
          <ToggleRow setting="disableWhileTyping" label="Desactivar mientras se escribe" hint="Evita movimientos y clics accidentales" />
          <ToggleRow setting="clickfinger" label="Clic por número de dedos" hint="Dos dedos hacen clic derecho y tres, clic central" />
          <ToggleRow setting="middleEmulation" label="Emular botón central" hint="Pulsa ambos botones a la vez para un clic central" />
          <ToggleRow setting="dragLock" label="Bloqueo de arrastre" hint="Permite levantar el dedo durante un arrastre por toque" />
        </Card>

        <Card title="Teclado" icon="󰌌">
          <SelectRow setting="kbLayout" label="Distribución" hint="Mapa principal del teclado" choices={[{ value: "es", label: "Español" }, { value: "latam", label: "Latinoamericano" }, { value: "us", label: "Inglés (EE. UU.)" }, { value: "gb", label: "Inglés (Reino Unido)" }, { value: "fr", label: "Francés" }, { value: "de", label: "Alemán" }, { value: "pt", label: "Portugués" }, { value: "it", label: "Italiano" }]} />
          <SelectRow setting="kbVariant" label="Variante" hint="Variante de la distribución seleccionada" choices={[{ value: "", label: "Predeterminada" }, { value: "nodeadkeys", label: "Sin teclas muertas" }, { value: "dvorak", label: "Dvorak" }, { value: "colemak", label: "Colemak" }]} />
          <SliderRow setting="repeatRate" label="Velocidad de repetición" hint="Repeticiones por segundo al mantener una tecla" min={1} max={60} step={1} format={v => `${v} /s`} />
          <SliderRow setting="repeatDelay" label="Espera antes de repetir" hint="Tiempo hasta que empieza la repetición" min={100} max={1200} step={50} format={v => `${v} ms`} />
          <ToggleRow setting="numlock" label="Bloqueo numérico al iniciar" hint="Activa Num Lock también en la pantalla de bloqueo" />
        </Card>

        <Card title="Puntero" icon="󰆽">
          <SelectRow setting="followMouse" label="Foco bajo el puntero" hint="Cómo cambia el foco al mover el ratón" choices={[{ value: 0, label: "Solo al hacer clic" }, { value: 1, label: "Seguir al puntero" }, { value: 2, label: "Foco libre" }, { value: 3, label: "Seguir sin cambiar teclado" }]} />
        </Card>

        <PrintersCard />

        <box cssClasses={["dev-reset-row"]} spacing={10} valign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
            <label cssClasses={["sp-field-label"]} label="Restablecer dispositivos" halign={Gtk.Align.START} />
            <label cssClasses={["sp-field-hint"]} label="Recupera los valores predeterminados de GiGiOS" halign={Gtk.Align.START} />
          </box>
          <button cssClasses={confirmReset((v) => v ? ["dev-reset", "confirm"] : ["dev-reset"])} onClicked={() => {
            if (confirmReset.get()) { resetDeviceSettings(); setConfirmReset(false) }
            else setConfirmReset(true)
          }}><label label={confirmReset((v) => v ? "Confirmar" : "Restablecer")} /></button>
        </box>
      </box>
    </overlay>
  )
}
