import { createState, createEffect, With } from "ags"
import { execAsync } from "ags/process"
import { widgetsRefresh } from "../state"

export default function Recording() {
  const [active, setActive] = createState(false)

  const poll = async () => {
    try { await execAsync(["pgrep", "-x", "wf-recorder"]); setActive(true) }
    catch { setActive(false) }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  let wasVisible = false

  createEffect(() => {
    const visible = widgetsRefresh()
    if (visible && !wasVisible) {
      poll()
      timer = setInterval(poll, 2000)
    } else if (!visible && wasVisible) {
      if (timer !== null) { clearInterval(timer); timer = null }
    }
    wasVisible = visible
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
