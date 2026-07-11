// widget/settings/DateLanguageSection.tsx
// Sección "Fecha e idioma" del panel de ajustes (widget/SettingsPanel.tsx).
// Reúne idioma del sistema, teclado, fecha/hora y ubicación. La lógica de
// sistema vive en ./datetime.ts; el teclado se reutiliza de ../devices/service
// (mismo escritor de input-settings.conf, para no duplicarlo).
import { Gtk } from "ags/gtk4"
import { createState, For, With } from "ags"
import { DisplaySelect } from "../display/controls"
import { timeFormat, setTimeFormat, type TimeFormat } from "./preferences"
import { deviceSettings, updateDeviceSettings } from "../devices/service"
import {
  snapshot, prefs, busy, refresh,
  listLocales, listTimezones, applyLocale, applyTimezone, setNtp, setManualTime,
  setLocationBlocked, setLocationSource, setAutoTimezone,
  refreshAutoLocation, searchCity, setManualLocation, type CityResult,
} from "./datetime"

// Distribuciones de teclado (mismas opciones que Dispositivos, un único origen).
const KB_LAYOUTS = [
  { value: "es", label: "Español" }, { value: "latam", label: "Latinoamericano" },
  { value: "us", label: "Inglés (EE. UU.)" }, { value: "gb", label: "Inglés (Reino Unido)" },
  { value: "fr", label: "Francés" }, { value: "de", label: "Alemán" },
  { value: "pt", label: "Portugués" }, { value: "it", label: "Italiano" },
]
const KB_VARIANTS = [
  { value: "", label: "Predeterminada" }, { value: "nodeadkeys", label: "Sin teclas muertas" },
  { value: "dvorak", label: "Dvorak" }, { value: "colemak", label: "Colemak" },
]

// Nombre legible de un locale: "es_ES.UTF-8" → "Español (ES)".
const LANG_NAMES: Record<string, string> = {
  es: "Español", en: "Inglés", fr: "Francés", de: "Alemán", pt: "Portugués",
  it: "Italiano", ca: "Catalán", gl: "Gallego", eu: "Euskera", nl: "Neerlandés",
  ru: "Ruso", pl: "Polaco", ja: "Japonés", zh: "Chino", ko: "Coreano", ar: "Árabe",
  sv: "Sueco", no: "Noruego", nb: "Noruego (Bokmål)", nn: "Noruego (Nynorsk)",
  da: "Danés", fi: "Finés", cs: "Checo", sk: "Eslovaco", hu: "Húngaro",
  ro: "Rumano", bg: "Búlgaro", el: "Griego", tr: "Turco", uk: "Ucraniano",
  he: "Hebreo", hi: "Hindi", th: "Tailandés", vi: "Vietnamita", id: "Indonesio",
  ms: "Malayo", fa: "Persa", cy: "Galés", ga: "Irlandés", is: "Islandés",
  hr: "Croata", sr: "Serbio", sl: "Esloveno", et: "Estonio", lv: "Letón",
  lt: "Lituano", mk: "Macedonio", sq: "Albanés", af: "Afrikáans", sw: "Suajili",
  bn: "Bengalí", ta: "Tamil", te: "Telugu", ml: "Malayalam", kn: "Canarés",
  mr: "Maratí", gu: "Guyaratí", pa: "Panyabí", ur: "Urdu", ka: "Georgiano",
  hy: "Armenio", az: "Azerí", kk: "Kazajo", uz: "Uzbeko", mn: "Mongol",
  km: "Jemer", lo: "Lao", my: "Birmano", si: "Cingalés", ne: "Nepalí",
  am: "Amárico", be: "Bielorruso",
}
function localeLabel(locale: string): string {
  const [lang, rest] = locale.split("_")
  const country = (rest ?? "").split(".")[0]
  const name = LANG_NAMES[lang] ?? lang
  return country ? `${name} (${country})` : name
}

// ── Piezas reutilizables ───────────────────────────────────────────────────────
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

function Row({ label, hint, children }: { label: string, hint?: any, children: any }) {
  return (
    <box cssClasses={["dev-row"]} spacing={14} valign={Gtk.Align.CENTER}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
        <label cssClasses={["sp-field-label"]} label={label} halign={Gtk.Align.START} />
        {hint != null ? <label cssClasses={["sp-field-hint"]} label={hint} halign={Gtk.Align.START} wrap xalign={0} maxWidthChars={52} /> : <box />}
      </box>
      {children}
    </box>
  )
}

function Toggle({ active, onToggle }: { active: any, onToggle: () => void }) {
  return (
    <button cssClasses={active((v: boolean) => v ? ["qs-toggle", "on"] : ["qs-toggle"])} valign={Gtk.Align.CENTER} onClicked={onToggle}>
      <box cssClasses={["qs-toggle-track"]}>
        <box cssClasses={active((v: boolean) => v ? ["qs-toggle-dot", "on"] : ["qs-toggle-dot"])} />
      </box>
    </button>
  )
}

// Control segmentado (2+ opciones exclusivas) para elecciones binarias.
function Segmented({ options, current, onSelect }: {
  options: { value: string, label: string }[], current: any, onSelect: (v: string) => void,
}) {
  return (
    <box cssClasses={["dl-seg"]} valign={Gtk.Align.CENTER}>
      {options.map(o => (
        <button
          cssClasses={current((c: string) => c === o.value ? ["dl-seg-btn", "active"] : ["dl-seg-btn"])}
          onClicked={() => onSelect(o.value)}
        ><label label={o.label} /></button>
      ))}
    </box>
  )
}

export default function DateLanguageSection() {
  const [locales, setLocales] = createState<string[]>([])
  const [timezones, setTimezones] = createState<string[]>([])
  const [cityQuery, setCityQuery] = createState("")
  const [results, setResults] = createState<CityResult[]>([])
  const [manualTime, setManualTimeInput] = createState("")

  // Carga inicial: estado del sistema + listas de los selectores.
  refresh()
  listLocales().then(setLocales)
  listTimezones().then(setTimezones)

  const doSearch = () => {
    const q = cityQuery.get()
    if (!q.trim()) return setResults([])
    searchCity(q).then(setResults)
  }

  return (
    <overlay cssClasses={["display-select-host"]}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <label cssClasses={["sp-section-title"]} label="✦ Fecha e idioma" halign={Gtk.Align.START} />
          <label cssClasses={["sp-field-hint"]} label={snapshot(s => s.localTime || "Idioma, teclado, hora y ubicación")} halign={Gtk.Align.START} />
        </box>

        {/* ── Idioma ─────────────────────────────────────────────────── */}
        <Card title="Idioma" icon="󰗊">
          <Row label="Idioma del sistema" hint="Idioma que usarán las apps. Se aplica al reiniciar la sesión; si el idioma no está generado, pedirá contraseña para instalarlo.">
            <box cssClasses={["dev-select"]}>
              <DisplaySelect
                current={snapshot(s => localeLabel(s.locale))}
                options={locales(list => list.map(l => ({ value: l, label: localeLabel(l), active: l === snapshot.get().locale })))}
                onSelect={(v) => applyLocale(v)}
              />
            </box>
          </Row>
        </Card>

        {/* ── Teclado (reutiliza el servicio de Dispositivos) ─────────── */}
        <Card title="Teclado" icon="󰌌">
          <Row label="Distribución" hint="Idioma del teclado. Se aplica al instante.">
            <box cssClasses={["dev-select"]}>
              <DisplaySelect
                current={deviceSettings(s => KB_LAYOUTS.find(l => l.value === s.kbLayout)?.label ?? s.kbLayout)}
                options={deviceSettings(s => KB_LAYOUTS.map(l => ({ ...l, active: l.value === s.kbLayout })))}
                onSelect={(v) => updateDeviceSettings({ kbLayout: v })}
              />
            </box>
          </Row>
          <Row label="Variante" hint="Variante de la distribución seleccionada.">
            <box cssClasses={["dev-select"]}>
              <DisplaySelect
                current={deviceSettings(s => KB_VARIANTS.find(l => l.value === s.kbVariant)?.label ?? s.kbVariant)}
                options={deviceSettings(s => KB_VARIANTS.map(l => ({ ...l, active: l.value === s.kbVariant })))}
                onSelect={(v) => updateDeviceSettings({ kbVariant: v })}
              />
            </box>
          </Row>
        </Card>

        {/* ── Fecha y hora ────────────────────────────────────────────── */}
        <Card title="Fecha y hora" icon="󰥔">
          <Row label="Formato de hora" hint="Cómo se muestra el reloj de la barra.">
            <Segmented
              options={[{ value: "24h", label: "24 h" }, { value: "12h", label: "12 h" }]}
              current={timeFormat}
              onSelect={(v) => setTimeFormat(v as TimeFormat)}
            />
          </Row>
          <Row label="Sincronización automática (NTP)" hint="Ajusta la hora por red. Pide contraseña.">
            <Toggle active={snapshot(s => s.ntp)} onToggle={() => setNtp(!snapshot.get().ntp)} />
          </Row>
          <Row label="Zona horaria automática" hint="Usa tu ubicación para elegir la zona horaria.">
            <Toggle active={prefs(p => p.autoTimezone)} onToggle={() => setAutoTimezone(!prefs.get().autoTimezone)} />
          </Row>
          <With value={prefs(p => p.autoTimezone)}>
            {(auto: boolean) => auto ? <box /> : (
              <Row label="Zona horaria" hint="Selecciónala manualmente. Pide contraseña.">
                <box cssClasses={["dev-select", "dl-tz-select"]}>
                  <DisplaySelect
                    current={snapshot(s => s.timezone || "—")}
                    options={timezones(list => list.map(t => ({ value: t, label: t, active: t === snapshot.get().timezone })))}
                    onSelect={(v) => applyTimezone(v)}
                  />
                </box>
              </Row>
            )}
          </With>
          <With value={snapshot(s => s.ntp)}>
            {(ntp: boolean) => ntp ? <box /> : (
              <Row label="Ajustar hora manualmente" hint="Formato: AAAA-MM-DD HH:MM. Pide contraseña.">
                <box spacing={8} valign={Gtk.Align.CENTER}>
                  <Gtk.Entry cssClasses={["account-entry"]} placeholderText="2026-07-10 14:30"
                    onChanged={(e: Gtk.Entry) => setManualTimeInput(e.get_text())}
                    onActivate={() => setManualTime(manualTime.get())} />
                  <button cssClasses={["account-secondary-btn"]} label="Aplicar" onClicked={() => setManualTime(manualTime.get())} />
                </box>
              </Row>
            )}
          </With>
        </Card>

        {/* ── Ubicación ───────────────────────────────────────────────── */}
        <Card title="Ubicación" icon="󰍎">
          <Row
            label="Permitir ubicación a las apps"
            hint={snapshot(s => s.geoclueAvailable
              ? "Controla el servicio del sistema (GeoClue). Pide contraseña."
              : "GeoClue no está instalado: solo afecta a los widgets de GiGiOS.")}
          >
            <Toggle active={snapshot(s => !s.geoclueBlocked)} onToggle={() => setLocationBlocked(!snapshot.get().geoclueBlocked)} />
          </Row>

          <Row label="Origen de la ubicación" hint="Automática (por IP) o elegida manualmente.">
            <Segmented
              options={[{ value: "auto", label: "Auto" }, { value: "manual", label: "Manual" }]}
              current={prefs(p => p.source)}
              onSelect={(v) => setLocationSource(v as any)}
            />
          </Row>

          <box cssClasses={["dev-row"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            <box spacing={10} valign={Gtk.Align.CENTER}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
                <label cssClasses={["sp-field-label"]} label="Ubicación actual" halign={Gtk.Align.START} />
                <label cssClasses={["account-notice"]} label={prefs(p => p.location.name || "Sin determinar")} halign={Gtk.Align.START} wrap xalign={0} maxWidthChars={48} />
              </box>
              <With value={prefs(p => p.source)}>
                {(src: string) => src === "auto"
                  ? <button cssClasses={["account-secondary-btn"]} label={busy(b => b ? "…" : "Actualizar")} onClicked={() => refreshAutoLocation()} />
                  : <box />}
              </With>
            </box>

            <With value={prefs(p => p.source)}>
              {(src: string) => src !== "manual" ? <box /> : (
                <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                  <box spacing={8}>
                    <Gtk.Entry cssClasses={["account-entry"]} placeholderText="Buscar ciudad…" hexpand
                      onChanged={(e: Gtk.Entry) => setCityQuery(e.get_text())}
                      onActivate={doSearch} />
                    <button cssClasses={["account-secondary-btn"]} label="Buscar" onClicked={doSearch} />
                  </box>
                  <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                    <For each={results}>
                      {(r: CityResult) => (
                        <button cssClasses={["dl-city-result"]} onClicked={() => { setManualLocation(r); setResults([]) }}>
                          <label label={r.name} halign={Gtk.Align.START} hexpand xalign={0} />
                        </button>
                      )}
                    </For>
                  </box>
                </box>
              )}
            </With>
          </box>
        </Card>
      </box>
    </overlay>
  )
}
