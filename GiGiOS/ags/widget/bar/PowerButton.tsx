import { openPowerMenu } from "../state"

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
