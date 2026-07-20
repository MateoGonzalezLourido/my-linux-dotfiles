// widget/settings/datetime.ts
//
// Lógica de la sección "Región, fecha y hora" (DateLanguageSection.tsx). Mantiene
// separada la parte de sistema (comandos, ficheros) de la vista JSX.
//
// Qué toca y con qué privilegios:
//   · Idioma del sistema (LANG)  → bloque gestionado en ~/.config/hypr/env.conf.
//     SIN contraseña; se aplica al reiniciar la sesión (igual que hace KDE).
//   · Zona horaria y NTP         → timedatectl. Pide contraseña vía polkit
//     (hyprpolkitagent), como cualquier ajuste de reloj del sistema.
//   · Ubicación (privacidad)     → enmascara/activa el servicio GeoClue para que
//     otras apps puedan o no leer tu ubicación (polkit). Si GeoClue no está
//     instalado, se cae a un flag local que respetan los widgets de GiGiOS.
//   · Ubicación (dato)           → automática por IP o manual por ciudad; se
//     guarda en ~/.config/gigios/datetime.json y alimenta la zona horaria auto.
//
// El teclado (distribución/variante) NO se gestiona aquí: es propiedad de
// widget/devices/service.ts (deviceSettings). La vista reutiliza ese servicio
// para no tener dos escritores del mismo input-settings.conf.

import GLib from "gi://GLib"
import { createState } from "ags"
import { execAsync } from "ags/process"

// ── Rutas ─────────────────────────────────────────────────────────────────────
const ENV_PATH = `${GLib.get_user_config_dir()}/hypr/env.conf`
const DATA_PATH = `${GLib.get_user_config_dir()}/gigios/datetime.json`
// Marcadores del bloque de idioma dentro de env.conf. Todo lo que haya entre
// ellos lo gestiona GiGiOS; el resto del archivo se respeta intacto.
const LOCALE_BEGIN = "# >>> GiGiOS idioma (no editar a mano) >>>"
const LOCALE_END = "# <<< GiGiOS idioma <<<"

// ── Tipos ───────────────────────────────────────────────────────────────────
export type LocationSource = "auto" | "manual"

export interface LocationData {
  name: string        // "Madrid, España" o "" si desconocida
  latitude: number | null
  longitude: number | null
  timezone: string    // "Europe/Madrid" o "" si no se pudo resolver
}

export interface DateTimeSnapshot {
  locale: string           // LANG efectivo, p. ej. "es_ES.UTF-8"
  timezone: string         // "Europe/Madrid"
  ntp: boolean             // sincronización automática por NTP
  geoclueAvailable: boolean
  geoclueBlocked: boolean  // true = las apps NO pueden leer la ubicación
}

// Preferencias de ubicación (persistidas por GiGiOS, no por el sistema).
export interface LocationPrefs {
  autoTimezone: boolean
  locationAllowed: boolean   // fallback local cuando GeoClue no existe
  source: LocationSource
  location: LocationData
}

const DEFAULT_PREFS: LocationPrefs = {
  autoTimezone: false,
  locationAllowed: true,
  source: "auto",
  location: { name: "", latitude: null, longitude: null, timezone: "" },
}

const EMPTY_SNAPSHOT: DateTimeSnapshot = {
  locale: "", timezone: "", ntp: false,
  geoclueAvailable: false, geoclueBlocked: false,
}

// ── Estado reactivo ───────────────────────────────────────────────────────────
const [snapshot, _setSnapshot] = createState<DateTimeSnapshot>(EMPTY_SNAPSHOT)
const [prefs, _setPrefs] = createState<LocationPrefs>(readPrefs())
// true mientras corre un comando que pide contraseña / red, para que la UI
// pueda mostrar un estado ocupado y evitar dobles clics.
const [busy, _setBusy] = createState(false)
export { snapshot, prefs, busy }

// ── Utilidades de shell ────────────────────────────────────────────────────────
function sh(script: string): Promise<string> {
  return execAsync(["bash", "-c", script]).then(o => o.trim()).catch(() => "")
}

function readFile(path: string): string {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    return ok ? new TextDecoder().decode(bytes) : ""
  } catch (_) { return "" }
}

// ── Persistencia de preferencias ───────────────────────────────────────────────
function readPrefs(): LocationPrefs {
  try {
    const raw = JSON.parse(readFile(DATA_PATH) || "{}")
    const loc = raw.location ?? {}
    return {
      autoTimezone: typeof raw.autoTimezone === "boolean" ? raw.autoTimezone : DEFAULT_PREFS.autoTimezone,
      locationAllowed: typeof raw.locationAllowed === "boolean" ? raw.locationAllowed : DEFAULT_PREFS.locationAllowed,
      source: raw.source === "manual" ? "manual" : "auto",
      location: {
        name: typeof loc.name === "string" ? loc.name : "",
        latitude: typeof loc.latitude === "number" ? loc.latitude : null,
        longitude: typeof loc.longitude === "number" ? loc.longitude : null,
        timezone: typeof loc.timezone === "string" ? loc.timezone : "",
      },
    }
  } catch (_) { return { ...DEFAULT_PREFS, location: { ...DEFAULT_PREFS.location } } }
}

function writePrefs(next: LocationPrefs) {
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(DATA_PATH), 0o755)
    GLib.file_set_contents(DATA_PATH, JSON.stringify(next, null, 2))
  } catch (e) { console.error("[datetime] no se pudo guardar:", e) }
}

function mutatePrefs(patch: Partial<LocationPrefs>) {
  const next = { ...prefs.get(), ...patch }
  _setPrefs(next)
  writePrefs(next)
}

// ── Lectura de estado del sistema ───────────────────────────────────────────────
// LANG efectivo: primero el bloque que gestionamos en env.conf (lo que se
// aplicará al reiniciar sesión), luego el entorno actual, luego localectl.
function readManagedLocale(): string {
  const env = readFile(ENV_PATH)
  const begin = env.indexOf(LOCALE_BEGIN)
  const end = env.indexOf(LOCALE_END)
  if (begin !== -1 && end > begin) {
    const block = env.slice(begin, end)
    const m = block.match(/env\s*=\s*LANG\s*,\s*(\S+)/)
    if (m) return m[1]
  }
  return ""
}

export async function refresh() {
  const [tz, ntp, geocluePath, geoclueMasked] = await Promise.all([
    sh("timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null"),
    sh("timedatectl show -p NTP --value 2>/dev/null"),
    sh("{ command -v geoclue >/dev/null 2>&1 || systemctl list-unit-files geoclue.service 2>/dev/null | grep -q geoclue; } && echo yes"),
    sh("systemctl is-enabled geoclue.service 2>/dev/null"),
  ])
  const locale = readManagedLocale() || GLib.getenv("LANG") || (await sh("localectl status 2>/dev/null | sed -nE 's/.*LANG=([^ ]+).*/\\1/p'")) || "C"
  const geoclueAvailable = geocluePath === "yes"
  _setSnapshot({
    locale,
    timezone: tz,
    ntp: ntp === "yes",
    geoclueAvailable,
    geoclueBlocked: geoclueAvailable ? geoclueMasked === "masked" : !prefs.get().locationAllowed,
  })
}

// ── Listas para los selectores ──────────────────────────────────────────────────
// Catálogo COMPLETO de idiomas del sistema, no solo los ya generados: leemos
// /usr/share/i18n/SUPPORTED (todas las locales que glibc puede generar). Así el
// usuario elige entre cientos, y applyLocale() genera el elegido si hace falta.
export function listLocales(): Promise<string[]> {
  const raw = readFile("/usr/share/i18n/SUPPORTED")
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split("\n")) {
    const name = line.trim().split(/\s+/)[0]
    // Solo nombres bien formados idioma_PAÍS.UTF-8 (descartamos variantes @… y no-UTF-8).
    if (!/^[a-z]{2,3}_[A-Z]{2}\.UTF-8$/.test(name)) continue
    if (!seen.has(name)) { seen.add(name); out.push(name) }
  }
  if (out.length) return Promise.resolve(out.sort())
  // Fallback (sistemas sin el catálogo): al menos las ya generadas.
  return sh("locale -a 2>/dev/null").then(r => r.split("\n")
    .map(l => l.trim()).filter(l => /utf-?8$/i.test(l) && l.includes("_"))
    .map(l => l.replace(/utf-?8$/i, "UTF-8")).sort())
}

// "es_ES.UTF-8" y "es_ES.utf8" son el mismo locale con distinta forma.
function normalizeLocaleName(s: string): string {
  return s.trim().toLowerCase().replace(/utf-?8/, "utf8")
}

export function listTimezones(): Promise<string[]> {
  return sh("timedatectl list-timezones 2>/dev/null").then(r => r.split("\n").map(s => s.trim()).filter(Boolean))
}

// ── Idioma del sistema ──────────────────────────────────────────────────────────
// Dos partes:
//   1. Escribir LANG/LC_ALL en el bloque gestionado de env.conf (SIN contraseña;
//      lo lee la sesión al reiniciar, como hace KDE).
//   2. Asegurar que el locale está GENERADO para que las apps puedan usarlo. Si
//      no aparece en `locale -a`, lo añadimos a /etc/locale.gen y corremos
//      locale-gen (esto sí pide contraseña vía polkit). Sin este paso, elegir un
//      idioma no generado no tendría efecto en las aplicaciones.
export async function applyLocale(lang: string) {
  const clean = lang.trim()
  if (!clean) return
  writeEnvLocale(clean)
  _setSnapshot({ ...snapshot.get(), locale: clean })
  const available = (await sh("locale -a 2>/dev/null")).split("\n").map(normalizeLocaleName)
  if (!available.includes(normalizeLocaleName(clean))) {
    const line = `${clean} UTF-8`
    // Descomenta la línea en locale.gen (o la añade) y regenera.
    const script =
      `L=${shellQuote(line)}; ` +
      `if grep -qxF "#$L" /etc/locale.gen; then sed -i "s|^#$L\\$|$L|" /etc/locale.gen; ` +
      `elif ! grep -qxF "$L" /etc/locale.gen; then printf '%s\\n' "$L" >> /etc/locale.gen; fi; ` +
      `locale-gen`
    await withBusy(() => execAsync(["pkexec", "bash", "-c", script]).catch(e => { console.error("[datetime] locale-gen:", e) }))
  }
}

// Comilla simple segura para incrustar un valor en un script bash.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// Escribe (o reemplaza) el bloque gestionado de idioma en env.conf. Sin root.
function writeEnvLocale(clean: string) {
  let env = readFile(ENV_PATH)
  // Quitar cualquier bloque gestionado previo (con o sin salto final).
  const begin = env.indexOf(LOCALE_BEGIN)
  if (begin !== -1) {
    const endIdx = env.indexOf(LOCALE_END, begin)
    if (endIdx !== -1) {
      let after = endIdx + LOCALE_END.length
      if (env[after] === "\n") after += 1
      env = env.slice(0, begin) + env.slice(after)
    }
  }
  env = env.replace(/\n{3,}$/,"\n").replace(/\s+$/, "")
  const block = `${LOCALE_BEGIN}\nenv = LANG,${clean}\nenv = LC_ALL,${clean}\n${LOCALE_END}\n`
  const next = env ? `${env}\n\n${block}` : block
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(ENV_PATH), 0o755)
    GLib.file_set_contents(ENV_PATH, next)
  } catch (e) { console.error("[datetime] no se pudo escribir env.conf:", e) }
}

// ── Zona horaria y NTP (piden contraseña vía polkit) ────────────────────────────
async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
  _setBusy(true)
  try { return await fn() } finally { _setBusy(false); await refresh() }
}

export function applyTimezone(tz: string) {
  const clean = tz.trim()
  if (!clean) return Promise.resolve()
  return withBusy(() => execAsync(["timedatectl", "set-timezone", clean]).catch(e => { console.error("[datetime] set-timezone:", e) }))
}

export function setNtp(on: boolean) {
  return withBusy(() => execAsync(["timedatectl", "set-ntp", on ? "true" : "false"]).catch(e => { console.error("[datetime] set-ntp:", e) }))
}

// Ajuste manual de la hora (solo tiene sentido con NTP desactivado).
// value: "YYYY-MM-DD HH:MM:SS"
export function setManualTime(value: string) {
  const clean = value.trim()
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(clean)) return Promise.resolve()
  const full = clean.length === 16 ? `${clean}:00` : clean
  return withBusy(() => execAsync(["timedatectl", "set-time", full]).catch(e => { console.error("[datetime] set-time:", e) }))
}

// ── Privacidad de ubicación ─────────────────────────────────────────────────────
// blocked=true → las apps NO pueden leer la ubicación. Con GeoClue instalado se
// enmascara el servicio (polkit). Sin GeoClue, se guarda un flag local.
export function setLocationBlocked(blocked: boolean) {
  if (!snapshot.get().geoclueAvailable) {
    mutatePrefs({ locationAllowed: !blocked })
    _setSnapshot({ ...snapshot.get(), geoclueBlocked: blocked })
    return Promise.resolve()
  }
  const cmd = blocked
    ? "systemctl mask --now geoclue.service"
    : "systemctl unmask geoclue.service"
  return withBusy(() => execAsync(["pkexec", "bash", "-c", cmd]).catch(e => { console.error("[datetime] geoclue:", e) }))
}

// ── Ubicación (dato) ────────────────────────────────────────────────────────────
export function setLocationSource(source: LocationSource) {
  mutatePrefs({ source })
  if (source === "auto") void refreshAutoLocation()
}

// Geolocalización aproximada por IP (sin clave, sin GPS). Respeta el bloqueo.
export async function refreshAutoLocation(): Promise<LocationData | null> {
  if (snapshot.get().geoclueBlocked || !prefs.get().locationAllowed) return null
  _setBusy(true)
  try {
    const raw = await sh("curl -fsS --max-time 6 https://ipapi.co/json/ 2>/dev/null")
    const j = JSON.parse(raw || "{}")
    if (!j || (!j.city && !j.timezone)) return null
    const data: LocationData = {
      name: [j.city, j.country_name].filter(Boolean).join(", "),
      latitude: typeof j.latitude === "number" ? j.latitude : null,
      longitude: typeof j.longitude === "number" ? j.longitude : null,
      timezone: typeof j.timezone === "string" ? j.timezone : "",
    }
    mutatePrefs({ location: data })
    if (prefs.get().autoTimezone && data.timezone) await applyTimezone(data.timezone)
    return data
  } catch (_) { return null }
  finally { _setBusy(false) }
}

// Búsqueda de ciudad para el modo manual (open-meteo, sin clave).
export interface CityResult { name: string; latitude: number; longitude: number; timezone: string }
export async function searchCity(query: string): Promise<CityResult[]> {
  const q = query.trim()
  if (!q) return []
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=es&format=json`
  const raw = await sh(`curl -fsS --max-time 6 '${url}' 2>/dev/null`)
  try {
    const j = JSON.parse(raw || "{}")
    return (j.results ?? []).map((r: any) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      latitude: r.latitude, longitude: r.longitude,
      timezone: r.timezone ?? "",
    }))
  } catch (_) { return [] }
}

export function setManualLocation(city: CityResult) {
  const data: LocationData = {
    name: city.name, latitude: city.latitude, longitude: city.longitude, timezone: city.timezone,
  }
  mutatePrefs({ source: "manual", location: data })
  if (prefs.get().autoTimezone && data.timezone) void applyTimezone(data.timezone)
}

export function setAutoTimezone(on: boolean) {
  mutatePrefs({ autoTimezone: on })
  if (on) {
    const loc = prefs.get().location
    if (loc.timezone) void applyTimezone(loc.timezone)
    else if (prefs.get().source === "auto") void refreshAutoLocation()
  }
}
