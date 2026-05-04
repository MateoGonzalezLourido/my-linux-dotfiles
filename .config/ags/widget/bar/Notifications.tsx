import AstalNotifd from "gi://AstalNotifd"
import { createBinding } from "ags"

export default function Notifications() {
  const notifd = AstalNotifd.get_default()
  const notifs = createBinding(notifd, "notifications")
  const dnd = createBinding(notifd, "dontDisturb")

  if (notifs.length > 0) {
    return (
      <button
        cssClasses={["notifications"]}
        onClicked={() => { notifd.dontDisturb = !notifd.dontDisturb }}
      >
        <box spacing={3}>
          <label
            cssClasses={notifs((n) => n.length > 0 ? ["icon-active"] : ["icon-desactive"])}
            label={dnd((d) => d ? "󰂛" : "󰂚")}
          />

          <label
            cssClasses={["label-number-notis"]}
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

