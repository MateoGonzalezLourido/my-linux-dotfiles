/**
 * notifications/store.ts
 * Estado global compartido para el sistema de notificaciones.
 * Mantiene la lista de notificaciones persistentes (aunque se descarten los popups),
 * configuración de apps, modo No Molestar, etc.
 */

import { createState } from "ags"
import GLib from "gi://GLib"
import type { NotifMeta } from "./rules/types.ts"
import { notifProcessingSuspended } from "../../servicios/energia/powerState.ts"
import { saveJsonAsync } from "./persist.ts"

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface StoredNotification {
  id: number
  appName: string
  appIcon: string
  summary: string
  body: string
  timestamp: number   // ms desde epoch
  read: boolean
  urgency: number     // 0=low, 1=normal, 2=critical
  actions: { id: string; label: string }[]
  /** `expire_timeout` del spec, en ms (0 = no expira). Lo usa NotificationPopup para
   *  alargar el popup cuando hay acciones que pulsar. */
  expireTimeout?: number
  image?: string      // artwork/image hint
  /** Hint `x-gigios-source`: los scripts de `hypr/scripts/` mandan "system"
   *  (`-h string:x-gigios-source:system`). Ausente en las notificaciones de apps normales.
   *  Lo consume el motor de reglas vía `NotifInput.source` / `match.source` — no se mira
   *  directamente en la UI, para que las reglas que lo usan se puedan desactivar de verdad. */
  source?: string
  meta: NotifMeta
}

export interface AppSettings {
  muted: boolean
  importance: "low" | "normal" | "urgent"
  showOnLockscreen: boolean
  color?: string // per-app accent override (hex). Overridden by rule color; overrides system default.
}

// ── Persistencia ──────────────────────────────────────────────────────────────

const NOTIF_STORE_PATH = `${GLib.get_user_config_dir()}/gigios/notifications.json`

/** Tope de la lista activa. Se aplica en memoria (ver `ingest.ts`), no solo al guardar. */
export const NOTIF_CAP = 200

const DEFAULT_META: NotifMeta = {
  lifetime: "persistent", clearOnBoot: false, noHistory: false,
  muteAudio: false, dontShow: false, dedupKey: "", conditions: [], matchedRules: [],
}

function withMeta(n: any): StoredNotification {
  return { ...n, meta: n.meta ?? { ...DEFAULT_META, dedupKey: `${(n.appName ?? "").toLowerCase()} ${(n.summary ?? "").toLowerCase()}` } }
}

function loadStore(): { notifications: StoredNotification[]; appSettings: Record<string, AppSettings> } {
  try {
    const [ok, content] = GLib.file_get_contents(NOTIF_STORE_PATH)
    if (ok) {
      const data = JSON.parse(new TextDecoder().decode(content))
      return {
        notifications: (data.notifications ?? []).map(withMeta),
        appSettings: data.appSettings ?? {},
      }
    }
  } catch (_) {}
  return { notifications: [], appSettings: {} }
}

let saveTimer: number | null = null
export function scheduleStoreSave() {
  if (saveTimer !== null) GLib.source_remove(saveTimer)
  saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
    saveJsonAsync(NOTIF_STORE_PATH, {
      notifications: notifications.get().slice(-NOTIF_CAP),
      appSettings: appSettings.get(),
    }, "store")
    saveTimer = null
    return GLib.SOURCE_REMOVE
  })
}

// ── Estado inicial ────────────────────────────────────────────────────────────

const initial = loadStore()

// Lista persistente de notificaciones (no se borra al descartar popups)
export const [notifications, setNotifications] = createState<StoredNotification[]>(initial.notifications)

// Configuración por app (silenciar, importancia, etc.)
export const [appSettings, setAppSettings] = createState<Record<string, AppSettings>>(initial.appSettings)

// Panel de notificaciones visible
export const [notifPanelVisible, setNotifPanelVisible] = createState(false)

// Filtro activo por app ("all" = todas)
export const [activeAppFilter, setActiveAppFilter] = createState<string>("all")

// Modo selección múltiple
export const [selectionMode, setSelectionMode] = createState(false)
export const [selectedIds, setSelectedIds] = createState<Set<number>>(new Set())

// Agrupación por app
export const [groupByApp, setGroupByApp] = createState(false)

// Ventana de ajustes (centrada) visible. Independiente del ciclo de vida del panel
// de notificaciones: cerrar el panel NO cierra los ajustes.
export const [notifSettingsVisible, setNotifSettingsVisible] = createState(false)

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Número de notificaciones no leídas */
export function getUnreadCount(): number {
  return notifications.get().filter(n => !n.read).length
}

/** Apps únicas que tienen notificaciones */
export function getAppsWithNotifs(): string[] {
  const apps = new Set<string>()
  notifications.get().forEach(n => apps.add(n.appName))
  return ["all", ...Array.from(apps)]
}

/** Devuelve el color semántico para una app */
export function getAppColor(appName: string): string {
  const name = appName.toLowerCase()
  if (name.includes("whatsapp") || name.includes("telegram") || name.includes("signal") || name.includes("discord") || name.includes("slack") || name.includes("messages") || name.includes("chat")) {
    return "#a6e3a1" // verde mensajería
  }
  if (name.includes("mail") || name.includes("thunderbird") || name.includes("outlook") || name.includes("gmail") || name.includes("email")) {
    return "#89b4fa" // azul email
  }
  if (name.includes("firefox") || name.includes("chrome") || name.includes("chromium") || name.includes("browser")) {
    return "#fab387" // naranja navegadores
  }
  if (name.includes("system") || name.includes("update") || name.includes("kernel") || name.includes("pacman") || name.includes("apt") || name.includes("dnf")) {
    return "#f9e2af" // amarillo sistema
  }
  if (name.includes("error") || name.includes("fail") || name.includes("alarm") || name.includes("critical")) {
    return "#f38ba8" // rojo error
  }
  if (name.includes("spotify") || name.includes("music") || name.includes("media") || name.includes("player")) {
    return "#94e2d5" // teal media
  }
  if (name.includes("vscode") || name.includes("code") || name.includes("terminal") || name.includes("git")) {
    return "#cba6f7" // violeta dev
  }
  // Color por hash del nombre (determinístico)
  const PALETTE = ["#89b4fa", "#a6e3a1", "#f9e2af", "#fab387", "#cba6f7", "#94e2d5", "#f38ba8"]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/**
 * Color de acento resuelto para una notificación concreta.
 * Prioridad: color de regla (meta.color) > color global de la app > color por defecto del sistema.
 * `settings` se pasa explícito para poder derivarlo de forma reactiva desde `appSettings`.
 */
export function resolveNotifColor(
  notif: { appName: string; meta?: { color?: string } },
  settings: Record<string, AppSettings> = appSettings.get(),
): string {
  return notif.meta?.color ?? settings[notif.appName]?.color ?? getAppColor(notif.appName)
}

/** Color global efectivo de una app (sin tener en cuenta reglas): override o por defecto. */
export function resolveAppColor(
  appName: string,
  settings: Record<string, AppSettings> = appSettings.get(),
): string {
  return settings[appName]?.color ?? getAppColor(appName)
}

/** Icono Nerd Font para una app */
export function getAppIcon(appName: string): string {
  const name = appName.toLowerCase()
  if (name.includes("whatsapp")) return "󰖣"
  if (name.includes("telegram")) return "󰊤"
  if (name.includes("discord")) return "󰙯"
  if (name.includes("slack")) return "󰒱"
  if (name.includes("signal")) return "󱔁"
  if (name.includes("firefox")) return "󰈹"
  if (name.includes("chrome") || name.includes("chromium")) return "󰊯"
  if (name.includes("mail") || name.includes("thunderbird") || name.includes("email") || name.includes("gmail")) return "󰇮"
  if (name.includes("spotify") || name.includes("music")) return "󰓇"
  if (name.includes("vscode") || name.includes("code")) return "󰨞"
  if (name.includes("terminal") || name.includes("bash") || name.includes("zsh")) return "󰆍"
  if (name.includes("git")) return "󰊢"
  if (name.includes("system") || name.includes("update") || name.includes("pacman") || name.includes("apt")) return "󰇱"
  if (name.includes("network") || name.includes("wifi") || name.includes("nm-applet")) return "󰤨"
  if (name.includes("bluetooth")) return "󰂯"
  if (name.includes("battery")) return "󰂄"
  if (name.includes("calendar")) return "󰃭"
  if (name.includes("file") || name.includes("nautilus") || name.includes("dolphin")) return "󰉋"
  return "󰂚" // campana genérica
}

/** Timestamp relativo legible */
export function getRelativeTime(timestamp: number): string {
  const diff = (Date.now() - timestamp) / 1000 // segundos
  if (diff < 60) return "ahora"
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

// ── Acciones ──────────────────────────────────────────────────────────────────

/** Marca una notificación como leída */
export function markRead(id: number): void {
  setNotifications(notifications.get().map(n => n.id === id ? { ...n, read: true } : n))
  scheduleStoreSave()
}

/** Marca todas como leídas */
export function markAllRead(): void {
  setNotifications(notifications.get().map(n => ({ ...n, read: true })))
  scheduleStoreSave()
}

/** Elimina una notificación */
export function removeNotification(id: number): void {
  setNotifications(notifications.get().filter(n => n.id !== id))
  // Quitar de seleccionados
  const sel = new Set(selectedIds.get())
  sel.delete(id)
  setSelectedIds(sel)
  scheduleStoreSave()
}

/** Elimina todas las notificaciones */
export function clearAllNotifications(): void {
  setNotifications([])
  setSelectedIds(new Set())
  scheduleStoreSave()
}

/** Elimina las notificaciones seleccionadas */
export function clearSelected(): void {
  const sel = selectedIds.get()
  setNotifications(notifications.get().filter(n => !sel.has(n.id)))
  setSelectedIds(new Set())
  scheduleStoreSave()
}

/** Actualiza ajustes de una app */
export function updateAppSettings(appName: string, patch: Partial<AppSettings>): void {
  const curr = appSettings.get()
  const existing: AppSettings = curr[appName] ?? { muted: false, importance: "normal", showOnLockscreen: true }
  setAppSettings({ ...curr, [appName]: { ...existing, ...patch } })
  scheduleStoreSave()
}

/** Abre el panel de notificaciones */
export function openNotifPanel(): void {
  setNotifPanelVisible(true)
}

/** Cierra el panel de notificaciones */
export function closeNotifPanel(): void {
  setNotifPanelVisible(false)
  setSelectionMode(false)
  setSelectedIds(new Set())
}

/** Toggle del panel de notificaciones */
export function toggleNotifPanel(): void {
  if (notifPanelVisible.get()) {
    closeNotifPanel()
  } else {
    openNotifPanel()
  }
}

/** Replace the entire active list (used by the cleanup engine). */
export function replaceNotifications(next: StoredNotification[]): void {
  setNotifications(next)
  scheduleStoreSave()
}

// ── Tick de tiempo (cada minuto) para actualizar timestamps relativos ──────────
// Su único consumidor son los "hace 5m" del panel de notificaciones, así que el
// timer solo corre mientras el panel está visible (y no en modo ahorro). Con el
// panel cerrado —el caso habitual— no hay ningún despertar por minuto. Al (re)abrir
// se hace un tick inmediato para poner al día los timestamps.

export const [timeTick, setTimeTick] = createState(0)

let tickTimer: number | null = null
const tickActive = () => notifPanelVisible.get() && !notifProcessingSuspended.get()

function syncTimeTick(): void {
  if (tickActive()) {
    if (tickTimer !== null) return
    setTimeTick(timeTick.get() + 1) // refresco inmediato al arrancar
    tickTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60000, () => {
      setTimeTick(timeTick.get() + 1)
      return GLib.SOURCE_CONTINUE
    })
  } else if (tickTimer !== null) {
    GLib.source_remove(tickTimer)
    tickTimer = null
  }
}

notifPanelVisible.subscribe(syncTimeTick)
notifProcessingSuspended.subscribe(syncTimeTick)
syncTimeTick()
