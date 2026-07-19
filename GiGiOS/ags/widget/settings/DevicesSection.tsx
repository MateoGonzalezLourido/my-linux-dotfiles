import { Gtk } from "ags/gtk4"
import { createState } from "ags"
import { DisplaySelect } from "../display/controls"
import { conectarCambioDeslizador } from "../deslizador"
import Interruptor from "../Interruptor"
import { EncabezadoAjuste, FilaAjuste, TarjetaAjustes, TituloSeccion } from "./componentes"
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
    <FilaAjuste titulo={label} informacion={hint} spacing={12} maxCaracteresInformacion={54}>
      <Interruptor
        activo={active}
        alAlternar={() => updateDeviceSettings({ [setting]: !Boolean(deviceSettings.get()[setting]) })}
      />
    </FilaAjuste>
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
  conectarCambioDeslizador(scale, (value) =>
    updateDeviceSettings({ [setting]: Math.round(value / step) * step }))
  const unsub = deviceSettings.subscribe(() => { adjustment.value = Number(deviceSettings.get()[setting]) })
  scale.connect("destroy", () => { if (typeof unsub === "function") unsub() })
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={7} cssClasses={["dev-row"]}>
      <box spacing={8}>
        <EncabezadoAjuste titulo={label} informacion={hint} />
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
    <FilaAjuste titulo={label} informacion={hint}>
      <box cssClasses={["dev-select"]}>
        <DisplaySelect current={current} options={options} onSelect={(v) => {
          const choice = choices.find(c => String(c.value) === v)
          if (choice) updateDeviceSettings({ [setting]: choice.value } as Partial<DeviceSettings>, reload)
        }} />
      </box>
    </FilaAjuste>
  )
}

// Bloque de impresoras: un interruptor maestro para CUPS, con estado en vivo y
// acceso al panel web. La lógica de sistema vive en ../devices/printers.
function PrintersCard() {
  const stateLabel = printerStatus((s) => !s.available ? "No instalado" : s.active ? "Activo" : "Inactivo")
  const dotClass = printerStatus((s) => !s.available ? ["dev-status-dot"] : s.active ? ["dev-status-dot", "on"] : ["dev-status-dot", "off"])
  const impresionActiva = printerStatus((s) => s.enabled)
  return (
    <TarjetaAjustes titulo="Impresoras" icono="󰐪">
      <FilaAjuste
        titulo="Servicio de impresión (CUPS)"
        informacion={printerStatus((s) => !s.available
              ? "CUPS no está instalado en este sistema"
              : "Activa la impresión y su arranque automático")}
        spacing={12}
        maxCaracteresInformacion={54}
      >
        <Interruptor
          activo={impresionActiva}
          sensible={printerStatus((s) => s.available)}
          alAlternar={() => { if (!printerBusy.get()) setCupsEnabled(!printerStatus.get().enabled) }}
        />
      </FilaAjuste>

      <FilaAjuste titulo="Estado" spacing={10}>
        <box spacing={7} valign={Gtk.Align.CENTER}>
          <box cssClasses={dotClass} valign={Gtk.Align.CENTER} />
          <label cssClasses={["sp-field-value", "dev-value"]} label={stateLabel} />
        </box>
      </FilaAjuste>

      <FilaAjuste
        visible={printerStatus((s) => s.active)}
        titulo="Configuración de impresoras"
        informacion="Añade o gestiona impresoras en el panel web de CUPS"
        spacing={10}
        maxCaracteresInformacion={54}
      >
        <button cssClasses={["dev-reset"]} onClicked={() => openCupsWeb()}>
          <label label="Abrir ↗" />
        </button>
      </FilaAjuste>
    </TarjetaAjustes>
  )
}

export default function DevicesSection() {
  const [confirmReset, setConfirmReset] = createState(false)
  refreshPrinters()
  return (
    <overlay cssClasses={["display-select-host"]}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
        <TituloSeccion titulo="Dispositivos" />

        <TarjetaAjustes titulo="Ratón" icono="󰍽">
          <SliderRow setting="sensitivity" label="Velocidad del puntero" hint="Ajuste de sensibilidad de Hyprland" min={-1} max={1} step={0.05} format={v => `${v > 0 ? "+" : ""}${v.toFixed(2)}`} />
          <SelectRow setting="accelProfile" label="Aceleración" hint="Adaptativa para uso general; plana para precisión" choices={[{ value: "adaptive", label: "Adaptativa" }, { value: "flat", label: "Plana" }]} />
          <SliderRow setting="mouseScrollFactor" label="Velocidad de desplazamiento" hint="Multiplicador de la rueda" min={0.1} max={3} step={0.1} format={v => `${v.toFixed(1)}×`} />
          <ToggleRow setting="forceNoAccel" label="Movimiento sin aceleración" hint="Fuerza una relación directa con el movimiento físico" />
          <ToggleRow setting="leftHanded" label="Modo zurdo" hint="Intercambia los botones principal y secundario" />
          <ToggleRow setting="mouseNaturalScroll" label="Desplazamiento natural" hint="El contenido sigue la dirección de la rueda" />
        </TarjetaAjustes>

        <TarjetaAjustes titulo="Touchpad" icono="󰟸">
          <SliderRow setting="touchpadScrollFactor" label="Velocidad de desplazamiento" hint="Sensibilidad del gesto de dos dedos" min={0.1} max={3} step={0.1} format={v => `${v.toFixed(1)}×`} />
          <ToggleRow setting="touchpadNaturalScroll" label="Desplazamiento natural" hint="Mueve el contenido en la dirección de los dedos" />
          <ToggleRow setting="tapToClick" label="Tocar para hacer clic" hint="Un toque equivale al botón principal" />
          <SelectRow setting="tapButtonMap" label="Mapa de toques" hint="Acción al tocar con dos y tres dedos" choices={[{ value: "lrm", label: "2: derecho · 3: medio" }, { value: "lmr", label: "2: medio · 3: derecho" }]} />
          <ToggleRow setting="disableWhileTyping" label="Desactivar mientras se escribe" hint="Evita movimientos y clics accidentales" />
          <ToggleRow setting="clickfinger" label="Clic por número de dedos" hint="Dos dedos hacen clic derecho y tres, clic central" />
          <ToggleRow setting="middleEmulation" label="Emular botón central" hint="Pulsa ambos botones a la vez para un clic central" />
          <ToggleRow setting="dragLock" label="Bloqueo de arrastre" hint="Permite levantar el dedo durante un arrastre por toque" />
        </TarjetaAjustes>

        <TarjetaAjustes titulo="Teclado" icono="󰌌">
          <SelectRow setting="kbLayout" label="Distribución" hint="Mapa principal del teclado" choices={[{ value: "es", label: "Español" }, { value: "latam", label: "Latinoamericano" }, { value: "us", label: "Inglés (EE. UU.)" }, { value: "gb", label: "Inglés (Reino Unido)" }, { value: "fr", label: "Francés" }, { value: "de", label: "Alemán" }, { value: "pt", label: "Portugués" }, { value: "it", label: "Italiano" }]} />
          <SelectRow setting="kbVariant" label="Variante" hint="Variante de la distribución seleccionada" choices={[{ value: "", label: "Predeterminada" }, { value: "nodeadkeys", label: "Sin teclas muertas" }, { value: "dvorak", label: "Dvorak" }, { value: "colemak", label: "Colemak" }]} />
          <SliderRow setting="repeatRate" label="Velocidad de repetición" hint="Repeticiones por segundo al mantener una tecla" min={1} max={60} step={1} format={v => `${v} /s`} />
          <SliderRow setting="repeatDelay" label="Espera antes de repetir" hint="Tiempo hasta que empieza la repetición" min={100} max={1200} step={50} format={v => `${v} ms`} />
          <ToggleRow setting="numlock" label="Bloqueo numérico al iniciar" hint="Activa Num Lock también en la pantalla de bloqueo" />
        </TarjetaAjustes>

        <TarjetaAjustes titulo="Puntero" icono="󰆽">
          <SliderRow setting="tamanoCursor" label="Tamaño del puntero" hint="Tamaño visual del cursor" min={16} max={64} step={1} format={v => `${v} px`} />
          <SelectRow setting="followMouse" label="Foco bajo el puntero" hint="Cómo cambia el foco al mover el ratón" choices={[{ value: 0, label: "Solo al hacer clic" }, { value: 1, label: "Seguir al puntero" }, { value: 2, label: "Foco libre" }, { value: 3, label: "Seguir sin cambiar teclado" }]} />
        </TarjetaAjustes>

        <PrintersCard />

        <box cssClasses={["dev-reset-row"]} spacing={10} valign={Gtk.Align.CENTER}>
          <EncabezadoAjuste
            titulo="Restablecer dispositivos"
            informacion="Recupera los valores predeterminados de GiGiOS"
          />
          <button cssClasses={confirmReset((v) => v ? ["dev-reset", "confirm"] : ["dev-reset"])} onClicked={() => {
            if (confirmReset.get()) { resetDeviceSettings(); setConfirmReset(false) }
            else setConfirmReset(true)
          }}><label label={confirmReset((v) => v ? "Confirmar" : "Restablecer")} /></button>
        </box>
      </box>
    </overlay>
  )
}
