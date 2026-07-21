import AstalTray from "gi://AstalTray"
import { createBinding, createComputed, For, With } from "ags"
import { Gtk } from "ags/gtk4"

import { hiddenTrayApps, trayOverflowAt } from "../ajustes/trayApps"
import BotonItemTray from "./tray/BotonItem"
import OverflowTray from "./tray/Overflow"
import type { ControlVisibilidadBarra } from "./visibilidad"

/** Raíz reactiva del tray. Las ramas inline y overflow tienen scopes separados;
 * al cambiar el umbral, cada menú abierto libera su retención antes de desmontar. */
export default function SystemTray({ visibilidad }: { visibilidad: ControlVisibilidadBarra }) {
  const tray = AstalTray.get_default()
  const itemsCrudos = createBinding(tray, "items")
  const items = createComputed(() =>
    itemsCrudos().filter((item: AstalTray.TrayItem) => !hiddenTrayApps().includes(item.id)),
  )
  const usarOverflow = createComputed(() => items().length >= trayOverflowAt())

  return (
    <box spacing={2}>
      <With value={usarOverflow}>
        {(overflowActivo) => overflowActivo ? (
          <OverflowTray items={items} visibilidad={visibilidad} />
        ) : (
          <box spacing={0}>
            <For each={items}>{(item) => <BotonItemTray item={item} visibilidad={visibilidad} />}</For>
          </box>
        )}
      </With>
    </box>
  )
}
