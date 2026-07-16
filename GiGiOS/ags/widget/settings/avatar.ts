import { createState } from "ags"
import GLib from "gi://GLib"

// XDG_DATA_HOME, no el cache: la foto se elige en Ajustes y no se regenera desde
// ningún master, así que en ~/.cache un limpiador la borraría para siempre. La
// comparten hyprlock (hyprlock.conf) y bin/link.sh (que migra la ruta vieja).
export const AVATAR_PATH = `${GLib.get_user_data_dir()}/gigios/face.png`
export const [avatarRevision, setAvatarRevision] = createState(0)

export function refreshAvatar(): void {
  setAvatarRevision(avatarRevision.get() + 1)
}
