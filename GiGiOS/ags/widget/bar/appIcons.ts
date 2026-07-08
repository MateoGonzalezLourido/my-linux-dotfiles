import GLib from "gi://GLib"

const ICONS_PATH = `${GLib.get_user_config_dir()}/gigios/app_icons.json`
const CACHE_MAX = 50

let store: Record<string, string> | null = null
const lru = new Map<string, string>()

function load(): Record<string, string> {
  if (store !== null) return store
  try {
    const [ok, bytes] = GLib.file_get_contents(ICONS_PATH)
    if (ok) store = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>
  } catch (_) {}
  store ??= {}
  return store
}

export function getIcon(appClass: string): string | null {
  const cls = appClass.toLowerCase()
  const key = cls.includes("firefox") ? "firefox" : cls

  if (lru.has(key)) {
    const val = lru.get(key)!
    lru.delete(key)
    lru.set(key, val)
    return val
  }

  const icon = load()[key]
  if (!icon) return null

  if (lru.size >= CACHE_MAX) lru.delete(lru.keys().next().value!)
  lru.set(key, icon)
  return icon
}
