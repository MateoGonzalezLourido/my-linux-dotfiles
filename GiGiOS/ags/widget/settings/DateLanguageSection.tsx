// widget/settings/DateLanguageSection.tsx
// Sección "Fecha e idioma" del panel de ajustes (widget/SettingsPanel.tsx).
// Reúne idioma del sistema, teclado, fecha/hora y ubicación. La lógica de
// sistema vive en ./datetime.ts; el teclado se reutiliza de ../devices/service
// (mismo escritor de input-settings.conf, para no duplicarlo).
import { Gtk } from "ags/gtk4"
import Interruptor from "../Interruptor"
import { BotonAjustes, EntradaTextoAjustes, FilaAjuste, TarjetaAjustes, TituloAjuste, TituloSeccion } from "./componentes"
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
        <TituloSeccion titulo="Fecha e idioma" />

        {/* ── Idioma ─────────────────────────────────────────────────── */}
        <TarjetaAjustes titulo="Idioma" icono="󰗊">
          <FilaAjuste titulo="Idioma del sistema" informacion="Idioma que usarán las apps. Se aplica al reiniciar la sesión; si el idioma no está generado, pedirá contraseña para instalarlo.">
            <box cssClasses={["dev-select"]}>
              <DisplaySelect
                current={snapshot(s => localeLabel(s.locale))}
                options={locales(list => list.map(l => ({ value: l, label: localeLabel(l), active: l === snapshot.get().locale })))}
                onSelect={(v) => applyLocale(v)}
              />
            </box>
          </FilaAjuste>
        </TarjetaAjustes>

        {/* ── Teclado (reutiliza el servicio de Dispositivos) ─────────── */}
        <TarjetaAjustes titulo="Teclado" icono="󰌌">
          <FilaAjuste titulo="Distribución" informacion="Idioma del teclado. Se aplica al instante.">
            <box cssClasses={["dev-select"]}>
              <DisplaySelect
                current={deviceSettings(s => KB_LAYOUTS.find(l => l.value === s.kbLayout)?.label ?? s.kbLayout)}
                options={deviceSettings(s => KB_LAYOUTS.map(l => ({ ...l, active: l.value === s.kbLayout })))}
                onSelect={(v) => updateDeviceSettings({ kbLayout: v })}
              />
            </box>
          </FilaAjuste>
          <FilaAjuste titulo="Variante" informacion="Variante de la distribución seleccionada.">
            <box cssClasses={["dev-select"]}>
              <DisplaySelect
                current={deviceSettings(s => KB_VARIANTS.find(l => l.value === s.kbVariant)?.label ?? s.kbVariant)}
                options={deviceSettings(s => KB_VARIANTS.map(l => ({ ...l, active: l.value === s.kbVariant })))}
                onSelect={(v) => updateDeviceSettings({ kbVariant: v })}
              />
            </box>
          </FilaAjuste>
        </TarjetaAjustes>

        {/* ── Fecha y hora ────────────────────────────────────────────── */}
        <TarjetaAjustes titulo="Fecha y hora" icono="󰥔">
          <FilaAjuste titulo="Formato de hora" informacion="Cómo se muestra el reloj de la barra.">
            <Segmented
              options={[{ value: "24h", label: "24 h" }, { value: "12h", label: "12 h" }]}
              current={timeFormat}
              onSelect={(v) => setTimeFormat(v as TimeFormat)}
            />
          </FilaAjuste>
          <FilaAjuste titulo="Sincronización automática (NTP)" informacion="Ajusta la hora por red. Pide contraseña.">
            <Interruptor activo={snapshot(s => s.ntp)} alAlternar={() => setNtp(!snapshot.get().ntp)} />
          </FilaAjuste>
          <FilaAjuste titulo="Zona horaria automática" informacion="Usa tu ubicación para elegir la zona horaria.">
            <Interruptor activo={prefs(p => p.autoTimezone)} alAlternar={() => setAutoTimezone(!prefs.get().autoTimezone)} />
          </FilaAjuste>
          <With value={prefs(p => p.autoTimezone)}>
            {(auto: boolean) => auto ? <box /> : (
              <FilaAjuste titulo="Zona horaria" informacion="Selecciónala manualmente. Pide contraseña.">
                <box cssClasses={["dev-select", "dl-tz-select"]}>
                  <DisplaySelect
                    current={snapshot(s => s.timezone || "—")}
                    options={timezones(list => list.map(t => ({ value: t, label: t, active: t === snapshot.get().timezone })))}
                    onSelect={(v) => applyTimezone(v)}
                  />
                </box>
              </FilaAjuste>
            )}
          </With>
          <With value={snapshot(s => s.ntp)}>
            {(ntp: boolean) => ntp ? <box /> : (
              <FilaAjuste titulo="Ajustar hora manualmente" informacion="Formato: AAAA-MM-DD HH:MM. Pide contraseña.">
                <box spacing={8} valign={Gtk.Align.CENTER}>
                  <EntradaTextoAjustes placeholderText="2026-07-10 14:30"
                    onChanged={(e: Gtk.Entry) => setManualTimeInput(e.get_text())}
                    onActivate={() => setManualTime(manualTime.get())} />
                  <BotonAjustes label="Aplicar" onClicked={() => setManualTime(manualTime.get())} />
                </box>
              </FilaAjuste>
            )}
          </With>
        </TarjetaAjustes>

        {/* ── Ubicación ───────────────────────────────────────────────── */}
        <TarjetaAjustes titulo="Ubicación" icono="󰍎">
          <FilaAjuste
            titulo="Permitir ubicación a las apps"
            informacion={snapshot(s => s.geoclueAvailable
              ? "Controla el servicio del sistema (GeoClue). Pide contraseña."
              : "GeoClue no está instalado: solo afecta a los widgets de GiGiOS.")}
          >
            <Interruptor activo={snapshot(s => !s.geoclueBlocked)} alAlternar={() => setLocationBlocked(!snapshot.get().geoclueBlocked)} />
          </FilaAjuste>

          <FilaAjuste titulo="Origen de la ubicación" informacion="Automática (por IP) o elegida manualmente.">
            <Segmented
              options={[{ value: "auto", label: "Auto" }, { value: "manual", label: "Manual" }]}
              current={prefs(p => p.source)}
              onSelect={(v) => setLocationSource(v as any)}
            />
          </FilaAjuste>

          <box cssClasses={["dev-row"]} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            <box spacing={10} valign={Gtk.Align.CENTER}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
                <TituloAjuste label="Ubicación actual" halign={Gtk.Align.START} />
                <label cssClasses={["account-notice"]} label={prefs(p => p.location.name || "Sin determinar")} halign={Gtk.Align.START} wrap xalign={0} maxWidthChars={48} />
              </box>
              <With value={prefs(p => p.source)}>
                {(src: string) => src === "auto"
                  ? <BotonAjustes label={busy(b => b ? "…" : "Actualizar")} onClicked={() => refreshAutoLocation()} />
                  : <box />}
              </With>
            </box>

            <With value={prefs(p => p.source)}>
              {(src: string) => src !== "manual" ? <box /> : (
                <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                  <box spacing={8}>
                    <EntradaTextoAjustes placeholderText="Buscar ciudad…" hexpand
                      onChanged={(e: Gtk.Entry) => setCityQuery(e.get_text())}
                      onActivate={doSearch} />
                    <BotonAjustes label="Buscar" onClicked={doSearch} />
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
        </TarjetaAjustes>
      </box>
    </overlay>
  )
}
