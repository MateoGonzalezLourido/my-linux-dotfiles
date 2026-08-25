import SettingsTabs from "../../notificaciones/settings/SettingsTabs"
import SeccionAccesibilidad from "../accesibilidad/SeccionAccesibilidad"
import SeccionAtajos from "../atajos/SeccionAtajos"
import SeccionBarraEscritorios from "../barra/SeccionBarraEscritorios"
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
import textos from "../../../textos/ajustes/general.json" with { type: "json" }

export type IdSeccion =
  | "account" | "language" | "datetime" | "location"
  | "display" | "accessibility" | "personalization"
  | "mouse" | "touchpad" | "keyboard" | "printers"
  | "energy" | "games" | "bar" | "workspaces" | "orion" | "clipboard"
  | "startup"
  | "storage" | "cleanup"
  | "notifications" | "monitoring" | "scans" | "supervision" | "system"
  | "shortcuts"

export interface SeccionNavegacion {
  id: IdSeccion
  label: string
  icon: string
}

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
