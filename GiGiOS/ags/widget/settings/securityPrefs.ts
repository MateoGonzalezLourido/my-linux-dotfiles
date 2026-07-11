// widget/settings/securityPrefs.ts
//
// Preferencias de la sección "Seguridad" del panel de ajustes general
// (widget/SettingsPanel.tsx). Cada clave activa/desactiva un tipo de evento que
// vigila hypr/scripts/oom-monitor.sh.
//
// IMPORTANTE: el script bash lee este archivo UNA sola vez al arrancar (nada de
// polling), igual que batteryMonitor/tempMonitor en preferences.ts. Por eso un
// cambio aquí solo surte efecto reiniciando el sistema (o relanzando el script);
// la UI lo avisa de forma destacada.
//
// Se persiste en su PROPIO archivo ~/.config/gigios/security.json para no
// mezclarlo con las preferencias de personalización (preferences.json).

import GLib from "gi://GLib"
import { createState } from "ags"

const SEC_PATH = `${GLib.get_user_config_dir()}/gigios/security.json`

export type SecurityKey =
  | "oomKiller" | "kernelPanic" | "hungTask" | "hwErrors" | "kernelModules"
  | "cpuThrottling" | "diskError" | "diskHealth" | "gpuError"
  | "serviceFailure" | "serviceHealth" | "sudoAuth" | "privEsc" | "ssh"
  | "appCrash" | "fileIntegrity" | "downloadScan" | "sandboxLaunch"

// Orden + metadatos de UI. El orden aquí es el orden en el que se pintan las
// filas. Todos por defecto ON = comportamiento actual del monitor.
export const SECURITY_ITEMS: { key: SecurityKey; label: string; hint: string }[] = [
  { key: "oomKiller",      label: "OOM Killer",                 hint: "Avisa cuando el kernel mata un proceso por quedarse sin memoria." },
  { key: "kernelPanic",    label: "Kernel panic",               hint: "Avisa ante un pánico del kernel (reinicio inminente)." },
  { key: "hungTask",       label: "Procesos colgados",          hint: "Detecta tareas bloqueadas demasiado tiempo (hung task)." },
  { key: "hwErrors",       label: "Errores de hardware",        hint: "Fallos de CPU o memoria del kernel (MCE, ECC, EDAC)." },
  { key: "kernelModules",  label: "Módulos del kernel",         hint: "Avisa al cargar módulos sin firmar o fuera del árbol (posible rootkit)." },
  { key: "cpuThrottling",  label: "CPU throttling",             hint: "Avisa cuando el kernel limita la CPU por temperatura." },
  { key: "diskError",      label: "Errores de disco",           hint: "Avisa ante errores de E/S del kernel." },
  { key: "diskHealth",     label: "Salud del disco (SMART)",    hint: "Sondea SMART y avisa si un disco se acerca a fallar. Requiere smartctl con permisos." },
  { key: "gpuError",       label: "Errores de GPU",             hint: "Avisa ante fallos de la GPU o del driver NVIDIA." },
  { key: "serviceFailure", label: "Servicios fallidos",         hint: "Avisa cuando un servicio de systemd no consigue arrancar." },
  { key: "serviceHealth",  label: "Servicios y crashes en cascada", hint: "Unidades que caen en estado «failed» en cualquier momento (watchdog, crash) y tormentas de coredumps." },
  { key: "sudoAuth",       label: "Fallos de sudo",             hint: "Avisa ante intentos fallidos de autenticación con sudo." },
  { key: "privEsc",        label: "Escalada de privilegios",    hint: "Uso de pkexec, fallos de su y autorizaciones polkit denegadas." },
  { key: "ssh",            label: "Sesiones SSH",               hint: "Avisa ante inicios de sesión SSH aceptados o fallidos." },
  { key: "appCrash",       label: "Crashes de aplicaciones",    hint: "Avisa cuando una app peta por segfault o vuelca core." },
  { key: "fileIntegrity",  label: "Integridad de archivos",     hint: "Vigila /etc (passwd, shadow, sudoers, ld.so.preload…), claves SSH, autostart y unidades systemd." },
  { key: "downloadScan",   label: "Escaneo de descargas",       hint: "Avisa de ejecutables nuevos en ~/Downloads y, si tienes ClamAV, los analiza en busca de malware." },
  { key: "sandboxLaunch",  label: "Lanzador aislado",           hint: "Ofrece lanzar los ejecutables detectados en una jaula Firejail (tras analizarlos con ClamAV). Abajo puedes lanzar cualquier archivo por ruta." },
]

const KEYS: SecurityKey[] = SECURITY_ITEMS.map((i) => i.key)

// Estado reactivo por clave (default = true = todo activado).
const states = {} as Record<SecurityKey, ReturnType<typeof createState<boolean>>>
for (const k of KEYS) states[k] = createState(true)

// ── Escáner de descargas: recursos y pausas ─────────────────────────────────
// Prefs heterogéneas (3 pausas + un número de GB) que se pintan en su PROPIA
// subsección de SecuritySection, no en la lista de eventos de arriba. A
// DIFERENCIA de los toggles de eventos, hypr/scripts/oom-monitor.sh relee estas
// EN CADA BARRIDO (no solo al arrancar): cambiarlas surte efecto sin reiniciar.
export type DlPauseKey = "dlPauseInPowerSave" | "dlPauseOnBattery" | "dlPauseWhileGaming"

export const DL_PAUSE_ITEMS: { key: DlPauseKey; label: string; hint: string }[] = [
  { key: "dlPauseInPowerSave", label: "Pausar en modo ahorro",  hint: "No analizar descargas mientras el ahorro de energía está activo (batería baja)." },
  { key: "dlPauseOnBattery",   label: "Pausar con batería",     hint: "No analizar descargas mientras estés desenchufado (con batería)." },
  { key: "dlPauseWhileGaming", label: "Pausar mientras juego",  hint: "No analizar descargas mientras haya un juego en marcha." },
]
const DL_PAUSE_KEYS = DL_PAUSE_ITEMS.map((i) => i.key)

// Default de las pausas = false (NO pausar: mismo comportamiento actual, el
// usuario las activa). Tope de tamaño en GB (default 1 GB).
const dlPauseStates = {} as Record<DlPauseKey, ReturnType<typeof createState<boolean>>>
for (const k of DL_PAUSE_KEYS) dlPauseStates[k] = createState(false)

const DL_MAX_GB_DEFAULT = 1
const [dlMaxScanGBState, _setDlMaxScanGB] = createState(DL_MAX_GB_DEFAULT)
/** Estado reactivo del tope de tamaño en GB (para binds en JSX). */
export const dlMaxScanGB = dlMaxScanGBState

// ── Carga inicial ─────────────────────────────────────────────────────────────
function load() {
  try {
    const [ok, content] = GLib.file_get_contents(SEC_PATH)
    if (!ok) return
    const saved = JSON.parse(new TextDecoder().decode(content))
    for (const k of KEYS) {
      if (typeof saved[k] === "boolean") states[k][1](saved[k])
    }
    for (const k of DL_PAUSE_KEYS) {
      if (typeof saved[k] === "boolean") dlPauseStates[k][1](saved[k])
    }
    if (typeof saved.dlMaxScanGB === "number" && saved.dlMaxScanGB > 0) _setDlMaxScanGB(saved.dlMaxScanGB)
  } catch (_) { /* ausente o corrupto → nos quedamos con los defaults (todo ON) */ }
}

// ── Persistencia ──────────────────────────────────────────────────────────────
function save() {
  try {
    const dir = GLib.path_get_dirname(SEC_PATH)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o755)
    const config: Record<string, boolean | number> = {}
    for (const k of KEYS) config[k] = states[k][0].get()
    for (const k of DL_PAUSE_KEYS) config[k] = dlPauseStates[k][0].get()
    config.dlMaxScanGB = dlMaxScanGBState.get()
    GLib.file_set_contents(SEC_PATH, JSON.stringify(config, null, 2))
  } catch (_) { /* un fallo de escritura no debe romper la UI */ }
}

// ── API pública ───────────────────────────────────────────────────────────────
/** Estado reactivo de una categoría (para binds en JSX). */
export function securityEnabled(k: SecurityKey) {
  return states[k][0]
}
/** Muta el estado de una categoría y persiste. */
export function setSecurityEnabled(k: SecurityKey, on: boolean) {
  states[k][1](on)
  save()
}

// ── API de pausas / tope del escáner de descargas ──────────────────────────
/** Estado reactivo de una pausa (para binds en JSX). */
export function dlPauseEnabled(k: DlPauseKey) {
  return dlPauseStates[k][0]
}
/** Muta una pausa y persiste. */
export function setDlPauseEnabled(k: DlPauseKey, on: boolean) {
  dlPauseStates[k][1](on)
  save()
}
/** Fija el tope de tamaño en GB (>0) y persiste; ignora valores inválidos. */
export function setDlMaxScanGB(v: number) {
  const n = Number.isFinite(v) && v > 0 ? v : DL_MAX_GB_DEFAULT
  _setDlMaxScanGB(n)
  save()
}

load()
