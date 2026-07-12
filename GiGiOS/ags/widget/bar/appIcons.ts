import GLib from "gi://GLib"

// Datos versionados del repo (ags/config/), no estado de usuario: se lee desde
// el árbol de AGS (~/.config/ags -> symlink a ~/GiGiOS/ags), NO desde ~/.config/gigios.
//
// OJO: este fichero NO EXISTE (ni ags/config/); getIcon() devuelve null siempre. Es un
// OVERRIDE opcional (clase -> glifo Nerd Font), no la fuente de iconos: quien resuelve
// el icono de verdad es games/icon.ts (entrada .desktop -> tema -> steam_icon_<appid>).
// Créalo solo si quieres forzar un glifo concreto para alguna clase.
const ICONS_PATH = `${GLib.get_user_config_dir()}/ags/config/app_icons.json`

let store: Record<string, string> | null = null

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
  return load()[key] ?? null
}
