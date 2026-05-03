import AstalMpris from "gi://AstalMpris"
import { createBinding } from "ags"

function truncate(s: string, n = 30) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

export default function MediaPlayer() {
  const mpris = AstalMpris.get_default()
  if (!mpris) return <box />

  const players = createBinding(mpris, "players")

  return (
    <box
      cssName="media"
      visible={players((ps) => ps.length > 0)}
      spacing={4}
    >
      <label cssName="media-icon" label="󰎈" />
      <label cssName="media-title" label={players((ps) => {
        const p = ps[0]
        if (!p) return ""
        const artist = p.artist ?? ""
        const title  = p.title  ?? ""
        return truncate(artist ? `${artist} — ${title}` : title)
      })} />
      <button onClicked={() => players()[0]?.previous()}>
        <label label="󰒮" />
      </button>
      <button onClicked={() => players()[0]?.playPause()}>
        <label label={players((ps) =>
          ps[0]?.playbackStatus === AstalMpris.PlaybackStatus.PLAYING ? "󰏤" : "󰐊"
        )} />
      </button>
      <button onClicked={() => players()[0]?.next()}>
        <label label="󰒭" />
      </button>
    </box>
  )
}

