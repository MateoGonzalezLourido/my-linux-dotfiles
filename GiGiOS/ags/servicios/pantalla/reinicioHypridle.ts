import { execAsync } from "ags/process"

/** Rearma los listeners después de cambiar su configuración o liberar un veto. */
export function reiniciarHypridle(): Promise<string> {
  return execAsync(["bash", "-c", "pkill hypridle; hypridle &"])
}
