import { createPoll } from "ags/time"
import { execAsync } from "ags/process"
import { With } from "ags"

export default function Recording() {
  const active = createPoll(false, 2000, async () => {
    try { await execAsync(["pgrep", "-x", "wf-recorder"]); return true }
    catch { return false }
  })

  return (
    <With value={active}>
      {(a) => a && (
        <button cssName="recording" onClicked={() => execAsync(["pkill", "wf-recorder"])}>
          <label label="󰑊" />
        </button>
      )}
    </With>
  )
}
