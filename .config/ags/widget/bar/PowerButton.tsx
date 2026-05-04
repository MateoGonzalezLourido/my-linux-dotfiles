import { anyPanelVisible, setAnyPanelVisible } from "../state"

export default function PowerButton() {
  return (
    <button
      cssClasses={["bt-power"]}
      onClicked={() => setAnyPanelVisible(!anyPanelVisible())}
    >
      <label label="󰐥" />
    </button>
  )
}

