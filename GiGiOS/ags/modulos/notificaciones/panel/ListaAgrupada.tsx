import { Gtk } from "ags/gtk4"
import { createComputed, createState, For, onCleanup } from "ags"
import {
  activeAppFilter,
  notifications,
  type StoredNotification,
} from "../store"
import GrupoAplicacion from "./GrupoAplicacion"
import { type PropiedadesListaNotificaciones } from "./ListaPlana"

interface GrupoNotificaciones {
  appName: string
  notificaciones: StoredNotification[]
}

function agruparNotificaciones(): GrupoNotificaciones[] {
  const grupos = new Map<string, StoredNotification[]>()
  notifications.get().forEach((notificacion) => {
    const grupo = grupos.get(notificacion.appName) ?? []
    grupo.push(notificacion)
    grupos.set(notificacion.appName, grupo)
  })
  return Array.from(grupos, ([appName, notificaciones]) => ({
    appName,
    notificaciones: notificaciones.slice().reverse(),
  }))
}

export default function ListaAgrupada({
  conservarScroll,
  limite,
}: PropiedadesListaNotificaciones) {
  // Solo existe mientras el panel está abierto en modo agrupado.
  const [grupos, setGrupos] = createState<GrupoNotificaciones[]>(agruparNotificaciones())
  onCleanup(notifications.subscribe(() => {
    conservarScroll(() => setGrupos(agruparNotificaciones()))
  }))

  // En esta vista el límite cuenta grupos, no notificaciones individuales.
  const montados = createComputed([grupos, limite], (lista, cantidad) =>
    lista.slice(0, cantidad))

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <For each={montados}>
        {({ appName, notificaciones }: GrupoNotificaciones) => (
          <box visible={activeAppFilter((filtro) => filtro === "all" || filtro === appName)}>
            <GrupoAplicacion appName={appName} notificaciones={notificaciones} />
          </box>
        )}
      </For>
    </box>
  )
}
