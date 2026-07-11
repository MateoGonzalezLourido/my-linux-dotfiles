import { createState } from "ags"
import GLib from "gi://GLib"

export const AVATAR_PATH = `${GLib.get_user_cache_dir()}/gigios/face.png`
export const [avatarRevision, setAvatarRevision] = createState(0)

export function refreshAvatar(): void {
  setAvatarRevision(avatarRevision.get() + 1)
}
