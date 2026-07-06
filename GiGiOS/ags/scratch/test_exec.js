import { execAsync } from "ags/process"
console.log("Starting execAsync...")
execAsync(["bash", "-c", "timeout 5 bluetoothctl scan on"])
    .then(out => console.log("Success:", out))
    .catch(err => console.error("Error:", err))
