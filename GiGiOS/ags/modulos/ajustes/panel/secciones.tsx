import { createComputed, type Accessor } from "ags"
import SettingsTabs from "../../notificaciones/settings/SettingsTabs"
import SeccionAccesibilidad from "../accesibilidad/SeccionAccesibilidad"
import SeccionAtajos from "../atajos/SeccionAtajos"
import SeccionBarraEscritorios from "../barra/SeccionBarraEscritorios"
import SeccionCamara from "../camara/SeccionCamara"
import SeccionCuenta from "../cuenta/SeccionCuenta"
import SeccionAlmacenamiento from "../disco/SeccionAlmacenamiento"
import SeccionAppsInicio from "../inicio/SeccionAppsInicio"
import SeccionDispositivos from "../dispositivos/SeccionDispositivos"
import SeccionEnergia from "../energia/SeccionEnergia"
import SeccionFechaIdioma from "../fecha-idioma/SeccionFechaIdioma"
import SeccionJuegos from "../juegos/SeccionJuegos"
import SeccionPantalla from "../pantalla/SeccionPantalla"
import SeccionFuncionesShell from "../personalizacion/SeccionFuncionesShell"
import SeccionSeguridad from "../seguridad/SeccionSeguridad"
import SeccionSistema from "../sistema/SeccionSistema"
import { camaras } from "../../../servicios/camara/dispositivos"
import { estadoCamara } from "../../../servicios/camara/persistencia"
import { haySeccionCamara } from "../camara/camaraDatos"
import textos from "../../../textos/ajustes/general.json" with { type: "json" }
// El rótulo de Cámara vive con el resto de sus textos y no en `general.json`:
// es una sección nueva y así todo su idioma cae en un solo fichero.
import textosCamara from "../../../textos/ajustes/camara.json" with { type: "json" }

export type IdSeccion =
  | "account" | "language" | "datetime" | "location"
  | "display" | "accessibility" | "personalization"
  | "mouse" | "touchpad" | "keyboard" | "printers" | "camera"
  | "energy" | "games" | "bar" | "workspaces" | "orion" | "clipboard"
  | "startup"
  | "storage" | "cleanup"
  | "notifications" | "monitoring" | "scans" | "supervision" | "system"
  | "shortcuts"

export interface SeccionNavegacion {
  id: IdSeccion
  label: string
  icon: string
  /** Destinos que solo existen en algunas máquinas. Ausente = siempre visible.
   *  Es un accessor y no un booleano porque el hardware entra y sale en
   *  caliente: enchufar una webcam con Ajustes abierto tiene que hacer aparecer
   *  su destino sin reabrir la ventana. */
  visible?: Accessor<boolean>
}

/** Hay cámara enchufada, o ajustes guardados de alguna que lo estuvo.
 *
 *  Lo segundo importa: una webcam USB desenchufada cuyos controles siguen en
 *  `camara.json` tiene que poder OLVIDARSE desde la sección, y si el destino
 *  desapareciera con ella esos ajustes quedarían huérfanos —y se volverían a
 *  imponer al reenchufarla— sin ninguna forma de borrarlos que no fuera editar
 *  el JSON a mano. En un equipo que nunca ha visto una cámara (este sobremesa)
 *  no se cumple ninguna de las dos y el destino no se pinta. */
const hayCamaraConocida = createComputed([camaras, estadoCamara], haySeccionCamara)

export const SECCIONES_NAVEGACION: SeccionNavegacion[] = [
  { id: "account", label: textos.secciones.cuenta, icon: "󰀄" },
  { id: "language", label: textos.secciones.idiomaRegion, icon: "󰗊" },
  { id: "datetime", label: textos.secciones.fechaHora, icon: "󰃭" },
  { id: "location", label: textos.secciones.ubicacion, icon: "󰍎" },
  { id: "display", label: textos.secciones.pantalla, icon: "󰍹" },
  { id: "accessibility", label: textos.secciones.accesibilidad, icon: "󰦧" },
  { id: "personalization", label: textos.secciones.personalizacion, icon: "󰏘" },
  { id: "mouse", label: textos.secciones.ratonPuntero, icon: "󰍽" },
  { id: "touchpad", label: textos.secciones.touchpad, icon: "󰟸" },
  { id: "keyboard", label: textos.secciones.teclado, icon: "󰌌" },
  { id: "printers", label: textos.secciones.impresoras, icon: "󰐪" },
  { id: "camera", label: textosCamara.seccion.titulo, icon: "󰄀", visible: hayCamaraConocida },
  { id: "energy", label: textos.secciones.energia, icon: "󰁹" },
  { id: "games", label: textos.secciones.juegos, icon: "󰊴" },
  { id: "bar", label: textos.secciones.barra, icon: "󰍜" },
  { id: "workspaces", label: textos.secciones.workspaces, icon: "󰆾" },
  { id: "orion", label: textos.secciones.orion, icon: "󰆍" },
  { id: "clipboard", label: textos.secciones.portapapeles, icon: "󰅇" },
  { id: "startup", label: textos.secciones.appsInicio, icon: "󰐊" },
  { id: "storage", label: textos.secciones.almacenamiento, icon: "󰋊" },
  { id: "cleanup", label: textos.secciones.liberarEspacio, icon: "󰃢" },
  { id: "notifications", label: textos.secciones.notificaciones, icon: "󰂚" },
  { id: "monitoring", label: textos.secciones.vigilancia, icon: "󰒃" },
  { id: "scans", label: textos.secciones.escaneos, icon: "󰇚" },
  { id: "supervision", label: textos.secciones.supervision, icon: "󰓅" },
  { id: "system", label: textos.secciones.sistema, icon: "󰌢" },
  { id: "shortcuts", label: textos.secciones.atajos, icon: "󰘳" },
]

const FABRICAS_SECCION: Record<IdSeccion, () => unknown> = {
  account: () => <SeccionCuenta />,
  language: () => <SeccionFechaIdioma vista="idioma" />,
  datetime: () => <SeccionFechaIdioma vista="fecha" />,
  location: () => <SeccionFechaIdioma vista="ubicacion" />,
  display: () => <SeccionPantalla />,
  accessibility: () => <SeccionAccesibilidad />,
  personalization: () => <SeccionFuncionesShell vista="personalizacion" />,
  mouse: () => <SeccionDispositivos vista="raton" />,
  touchpad: () => <SeccionDispositivos vista="touchpad" />,
  keyboard: () => <SeccionDispositivos vista="teclado" />,
  printers: () => <SeccionDispositivos vista="impresoras" />,
  camera: () => <SeccionCamara />,
  energy: () => <SeccionEnergia />,
  games: () => <SeccionJuegos />,
  bar: () => <SeccionBarraEscritorios vista="barra" />,
  workspaces: () => <SeccionBarraEscritorios vista="workspaces" />,
  orion: () => <SeccionFuncionesShell vista="orion" />,
  clipboard: () => <SeccionFuncionesShell vista="portapapeles" />,
  startup: () => <SeccionAppsInicio />,
  storage: () => <SeccionAlmacenamiento vista="uso" />,
  cleanup: () => <SeccionAlmacenamiento vista="limpieza" />,
  notifications: () => <SettingsTabs />,
  monitoring: () => <SeccionSeguridad vista="vigilancia" />,
  scans: () => <SeccionSeguridad vista="escaneos" />,
  supervision: () => <SeccionSistema vista="supervision" />,
  system: () => <SeccionSistema vista="informacion" />,
  shortcuts: () => <SeccionAtajos />,
}

export function crearContenidoSeccion(id: IdSeccion): unknown {
  return FABRICAS_SECCION[id]()
}
