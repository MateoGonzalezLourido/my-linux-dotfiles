import { powerMenuVisible, setPowerMenuVisible } from "../state"

export default function PowerButton() {
  return (
    <button
      cssClasses={["bt-power"]}
      onClicked={() => setPowerMenuVisible(!powerMenuVisible())}
    >
      <label label="󰐥" />
    </button>
  )
}

