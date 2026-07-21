import type { NotifMeta } from "../rules/types.ts"

export interface StoredNotification {
  id: number
  appName: string
  appIcon: string
  summary: string
  body: string
  timestamp: number
  read: boolean
  urgency: number
  actions: { id: string; label: string }[]
  /** `expire_timeout` del spec, en ms (0 = no expira). */
  expireTimeout?: number
  image?: string
  /** Hint `x-gigios-source`, consumido por el motor de reglas. */
  source?: string
  meta: NotifMeta
}

export interface AppSettings {
  muted: boolean
  importance: "low" | "normal" | "urgent"
  showOnLockscreen: boolean
  color?: string
}
