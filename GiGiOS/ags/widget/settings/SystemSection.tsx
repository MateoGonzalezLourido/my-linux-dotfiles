// Información de hardware y software del equipo. Todos los comandos son
// opcionales: la sección sigue siendo útil en instalaciones mínimas.
//
// La sección se pinta LLENA en el primer frame, sin spinner. La recolección
// vive en `systemInfo.ts` y está partida en una mitad síncrona (/proc, /sys,
// ~1 ms) y un sondeo con subprocesos que se **cachea en disco**; al abrir se
// construye con el sondeo anterior y el nuevo se aplica por detrás.
//
// El sondeo NO se memoiza en RAM a propósito: mantenerlo vivo toda la sesión
// costaba ~8 KB retenidos para ahorrar un sondeo de 323 ms que además ocurre de
// fondo y no se ve. La caché de disco es la que hace el pintado instantáneo, y
// releerla cuesta una lectura de 8 KB que ya está en la caché de páginas.
import { Gtk } from "ags/gtk4"
import { With, createState, onCleanup } from "ags"
import { TituloSeccion, TituloSubseccion } from "./componentes"
import SupervisionSistema from "./SupervisionSistema"
import textos from "../../textos/ajustes/sistema.json" with { type: "json" }
import {
  construir, guardarCache, leerCache, sondear,
  type InfoGroup, type SystemSnapshot,
} from "./systemInfo"

function InfoGroupView({ group }: { group: InfoGroup }) {
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={0} cssClasses={["sys-card"]}>
      <box spacing={8} cssClasses={["sys-card-header"]}>
        <label cssClasses={["sys-card-icon"]} label={group.icon} />
        <TituloSubseccion cssClasses={["sys-card-title"]} label={group.title} hexpand halign={Gtk.Align.START} />
      </box>
      {group.items.map((item, i) => (
        <box cssClasses={i ? ["sys-row", "bordered"] : ["sys-row"]} spacing={20}>
          <label cssClasses={["sys-label"]} label={item.label} halign={Gtk.Align.START} valign={Gtk.Align.START} />
          <label cssClasses={["sys-value"]} label={item.value} hexpand halign={Gtk.Align.START}
            xalign={0} wrap={true} selectable={true} maxWidthChars={48} />
        </box>
      ))}
    </box>
  )
}

type VistaSistema = "informacion" | "supervision"

export default function SystemSection({ vista }: { vista: VistaSistema }) {
  if (vista === "supervision") {
    return (
      <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "dev-section"]} hexpand>
        <TituloSeccion titulo={textos.vistas.supervision} />
        <SupervisionSistema />
      </box>
    )
  }

  const [snapshot, setSnapshot] = createState<SystemSnapshot>(construir(leerCache()))

  // El sondeo de fondo puede terminar con la sección ya cerrada: sin la guarda,
  // `setSnapshot` reconstruiría widgets desmontados.
  let vivo = true
  onCleanup(() => { vivo = false })
  sondear().then(probe => {
    guardarCache(probe)
    if (vivo) setSnapshot(construir(probe))
  })

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={14} cssClasses={["sp-section", "sys-section"]} hexpand>
      <TituloSeccion titulo={textos.vistas.informacion} />
      <With value={snapshot}>
        {(data: SystemSnapshot) => data.groups.length
          ? <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
              {data.groups.map(group => <InfoGroupView group={group} />)}
            </box>
          : <box cssClasses={["sys-loading"]} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
              <Gtk.Spinner spinning={true} />
              <label label={textos.seccion.cargando} />
            </box>}
      </With>
    </box>
  )
}
