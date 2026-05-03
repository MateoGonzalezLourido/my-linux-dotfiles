import { execAsync } from "ags/process"

export default function PowerButton() {
  return (
    <button
      cssClasses={["bt-power"]}
      onClicked={() => execAsync(["bash", "-c", `${SRC}/scripts/powermenu.sh`])}
    >
      <label label="󰐥" />
    </button>
  )
}

