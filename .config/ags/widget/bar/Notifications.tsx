import AstalNotifd from "gi://AstalNotifd"
import { createBinding } from "ags"

const BTN = "border: none; padding: 0 6px; margin: 0 1px;"
const ICON_DIM = "font-family: 'JetBrainsMono Nerd Font'; font-size: 14px; color: rgba(226,226,226,0.45);"
const ICON_ACTIVE = "font-family: 'JetBrainsMono Nerd Font'; font-size: 14px; color: #cba6f7;"
const BADGE_CSS = "font-family: 'JetBrains Mono'; font-size: 10px; color: #cba6f7; font-weight: 700;"

export default function Notifications() {
  const notifd = AstalNotifd.get_default()
  const notifs = createBinding(notifd, "notifications")
  const dnd = createBinding(notifd, "dontDisturb")

  if (notifs.length > 0) {
    return (
      <button
        css={BTN}
        onClicked={() => { notifd.dontDisturb = !notifd.dontDisturb }}
      >
        <box spacing={3}>
          <label
            css={notifs((n) => n.length > 0 ? ICON_ACTIVE : ICON_DIM)}
            label={dnd((d) => d ? "󰂛" : "󰂚")}
          />

          <label
            css={BADGE_CSS}
            label={notifs((n) => n.length > 0 ? `${n.length}` : "")}
            visible={notifs((n) => n.length > 0)}
          />
        </box>
      </button>
    )
  }
  else {
    return (``)
  }
}

