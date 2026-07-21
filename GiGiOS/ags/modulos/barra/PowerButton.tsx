import { openPowerMenu } from "../../estado/shell"

export default function PowerButton() {
  return (
    <button
      cssClasses={["bt-power"]}
      onClicked={() => openPowerMenu()}
    >
      <label label="󰐥" />
    </button>
  )
}
