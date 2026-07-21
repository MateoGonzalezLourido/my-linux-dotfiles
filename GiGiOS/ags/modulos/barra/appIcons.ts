import GLib from "gi://GLib"

// Mapa versionado clase -> glifo Nerd Font. Vive directamente en el árbol GiGiOS;
// no es estado de usuario ni depende del symlink ~/.config/ags.
const ICONS_PATH = `${GLib.get_home_dir()}/GiGiOS/ags/config/app_icons.json`

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

export function getIcon(...appClasses: Array<string | null | undefined>): string | null {
  const icons = load()

  for (const appClass of appClasses) {
    const cls = (appClass ?? "").trim().toLowerCase()
    if (!cls) continue

    // Hyprland puede publicar la clase como id completo de escritorio
    // (org.kde.dolphin, dev.vencord.Vesktop) o como ejecutable de Wine.
    const withoutExe = cls.replace(/\.exe$/, "")
    const short = withoutExe.slice(withoutExe.lastIndexOf(".") + 1)
    const candidates = cls.includes("firefox")
      ? ["firefox", cls, withoutExe, short]
      : [cls, withoutExe, short]

    for (const key of [...new Set(candidates)]) {
      const icon = icons[key]
      if (icon) return icon
    }
  }
  return null
}
