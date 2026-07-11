// widget/settings/SecuritySection.tsx
// Sección "Seguridad" del panel de ajustes general (widget/SettingsPanel.tsx).
// Un toggle por cada tipo de evento que vigila hypr/scripts/oom-monitor.sh.
// Los cambios se persisten en security.json (ver securityPrefs.ts). El script
// bash lee los toggles de EVENTOS una sola vez al arrancar (solo surten efecto
// tras reiniciar — de ahí el aviso destacado arriba); en cambio los ajustes de
// "recursos del escáner de descargas" (DownloadResourcesSection) los relee en
// cada barrido y se aplican en vivo. Mismo estilo de toggle que EnergySection.
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import {
  SECURITY_ITEMS, securityEnabled, setSecurityEnabled, type SecurityKey,
  DL_PAUSE_ITEMS, dlPauseEnabled, setDlPauseEnabled,
  dlMaxScanGB, setDlMaxScanGB,
} from "./securityPrefs"

type Item = { key: SecurityKey; label: string; hint: string }

// Fila de interruptor presentacional, reutilizada por los toggles de eventos y
// por las pausas del escáner de descargas: recibe el estado reactivo y el
// callback de conmutación, sin acoplarse a una fuente concreta.
function SwitchRow({ label, hint, state, onToggle }: {
  label: string
  hint: string
  state: ReturnType<typeof securityEnabled>
  onToggle: () => void
}) {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={6} cssClasses={["sp-field"]} hexpand>
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand halign={Gtk.Align.START}>
          <label cssClasses={["sp-field-label"]} label={label} halign={Gtk.Align.START} />
          <label
            cssClasses={["sp-field-hint"]}
            label={hint}
            halign={Gtk.Align.START}
            wrap={true}
            maxWidthChars={62}
            xalign={0}
          />
        </box>
        <button
          cssClasses={state((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])}
          valign={Gtk.Align.CENTER}
          onClicked={onToggle}
        >
          <box cssClasses={["qs-toggle-track"]}>
            <box cssClasses={state((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
          </box>
        </button>
      </box>
    </box>
  )
}

function ToggleRow({ item }: { item: Item }) {
  const state = securityEnabled(item.key)
  return <SwitchRow label={item.label} hint={item.hint} state={state}
    onToggle={() => setSecurityEnabled(item.key, !state.get())} />
}

// Subsección "recursos" del escáner de descargas: pausas (ahorro/batería/juego),
// tope de tamaño en GB y botón de escaneo forzado. Solo visible con el escáner de
// descargas activo. Estos ajustes se aplican en vivo (el bash los relee en cada
// barrido), no requieren reinicio.
function DownloadResourcesSection() {
  let gbRef: Gtk.Entry
  const applyGb = () => {
    const raw = (gbRef?.get_text() ?? "").trim().replace(",", ".")
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n > 0) setDlMaxScanGB(n)
    gbRef.set_text(String(dlMaxScanGB.get()))
  }
  const forceScan = () => {
    execAsync([`${GLib.get_user_config_dir()}/hypr/scripts/scan-downloads.sh`]).catch(() => {})
  }
  return (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      cssClasses={["sp-field"]}
      hexpand
      visible={securityEnabled("downloadScan")((v: boolean) => v)}
    >
      <label cssClasses={["sp-subsection-title"]} label="Escáner de descargas: recursos" halign={Gtk.Align.START} />
      <label
        cssClasses={["sp-field-hint"]}
        label={"El análisis va siempre a prioridad baja (nice+ionice). Aquí pausas cuándo se ejecuta y hasta qué tamaño. Se aplica sin reiniciar."}
        halign={Gtk.Align.START}
        wrap={true}
        maxWidthChars={62}
        xalign={0}
      />
      {DL_PAUSE_ITEMS.map((it) => {
        const st = dlPauseEnabled(it.key)
        return <SwitchRow label={it.label} hint={it.hint} state={st}
          onToggle={() => setDlPauseEnabled(it.key, !st.get())} />
      })}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
        <label cssClasses={["sp-field-label"]} label="No analizar archivos ≥ (GB)" halign={Gtk.Align.START} />
        <box spacing={6} valign={Gtk.Align.CENTER}>
          <entry
            cssClasses={["sp-num-input"]}
            hexpand
            placeholderText="1"
            $={(self: Gtk.Entry) => { gbRef = self; self.set_text(String(dlMaxScanGB.get())) }}
            onActivate={applyGb}
          />
          <button cssClasses={["sp-add-rule"]} onClicked={applyGb} valign={Gtk.Align.CENTER}>
            <label label="Guardar" />
          </button>
        </box>
      </box>
      <button cssClasses={["sp-add-rule"]} onClicked={forceScan} halign={Gtk.Align.START}>
        <label label="🔍 Escanear Descargas ahora" />
      </button>
    </box>
  )
}

// Campo para lanzar un archivo cualquiera aislado por su ruta. Se ejecuta
// hypr/scripts/run-untrusted.sh, que analiza (ClamAV) y contiene (Firejail).
// Solo visible si el "Lanzador aislado" está activado.
function SandboxLaunchRow() {
  let entryRef: Gtk.Entry
  const run = () => {
    const p = entryRef?.get_text().trim()
    if (!p) return
    execAsync([`${GLib.get_user_config_dir()}/hypr/scripts/run-untrusted.sh`, p]).catch(() => {})
    entryRef.set_text("")
  }
  return (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={6}
      cssClasses={["sp-field"]}
      hexpand
      visible={securityEnabled("sandboxLaunch")((v: boolean) => v)}
    >
      <label cssClasses={["sp-subsection-title"]} label="Lanzar un archivo aislado" halign={Gtk.Align.START} />
      <label
        cssClasses={["sp-field-hint"]}
        label={"Escribe la ruta de un ejecutable y se lanzará en una jaula Firejail\n(tras analizarlo con ClamAV si está instalado)."}
        halign={Gtk.Align.START}
        wrap={true}
        maxWidthChars={62}
        xalign={0}
      />
      <box spacing={6} valign={Gtk.Align.CENTER}>
        <entry
          cssClasses={["sp-num-input"]}
          hexpand
          placeholderText="/home/…/Descargas/juego.exe"
          $={(self: Gtk.Entry) => { entryRef = self }}
          onActivate={run}
        />
        <button cssClasses={["sp-add-rule"]} onClicked={run} valign={Gtk.Align.CENTER}>
          <label label="🛡️ Lanzar aislado" />
        </button>
      </box>
    </box>
  )
}

// Campo para analizar cualquier archivo (o carpeta) con ClamAV a demanda, sin
// tope de tamaño. Ejecuta hypr/scripts/scan-file.sh. Pensado para los archivos
// grandes que el escáner automático de descargas se salta. Solo visible si el
// "Escaneo de descargas" está activado.
function ScanFileRow() {
  let entryRef: Gtk.Entry
  const run = () => {
    const p = entryRef?.get_text().trim()
    if (!p) return
    execAsync([`${GLib.get_user_config_dir()}/hypr/scripts/scan-file.sh`, p]).catch(() => {})
    entryRef.set_text("")
  }
  return (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={6}
      cssClasses={["sp-field"]}
      hexpand
      visible={securityEnabled("downloadScan")((v: boolean) => v)}
    >
      <label cssClasses={["sp-subsection-title"]} label="Analizar un archivo con ClamAV" halign={Gtk.Align.START} />
      <label
        cssClasses={["sp-field-hint"]}
        label={"Escribe la ruta de un archivo (o carpeta) y se analizará con ClamAV,\nsin límite de tamaño. Útil para lo que el escaneo automático se salta por grande."}
        halign={Gtk.Align.START}
        wrap={true}
        maxWidthChars={62}
        xalign={0}
      />
      <box spacing={6} valign={Gtk.Align.CENTER}>
        <entry
          cssClasses={["sp-num-input"]}
          hexpand
          placeholderText="/home/…/Descargas/juego.rar"
          $={(self: Gtk.Entry) => { entryRef = self }}
          onActivate={run}
        />
        <button cssClasses={["sp-add-rule"]} onClicked={run} valign={Gtk.Align.CENTER}>
          <label label="🔍 Escanear" />
        </button>
      </box>
    </box>
  )
}

export default function SecuritySection() {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section"]} hexpand>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
        <label cssClasses={["sp-section-title"]} label="✦ Seguridad" halign={Gtk.Align.START} />
        <label
          cssClasses={["sp-field-hint"]}
          label={"Cada opción controla un tipo de evento que vigila el monitor de seguridad.\nLos cambios se aplican al reiniciar el sistema."}
          halign={Gtk.Align.START}
          wrap={true}
          maxWidthChars={70}
          xalign={0}
        />
      </box>
      {SECURITY_ITEMS.map((item) => <ToggleRow item={item} />)}
      <DownloadResourcesSection />
      <SandboxLaunchRow />
      <ScanFileRow />
    </box>
  )
}
