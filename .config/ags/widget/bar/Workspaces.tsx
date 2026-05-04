import AstalHyprland from "gi://AstalHyprland"
import { createState, For } from "ags"
import { Gtk } from "ags/gtk4"

import { barVisible } from "../state.tsx"

interface AppIcons {
  [key: string]: string;
}

const APP_ICONS: AppIcons = {
  // Navegadores
  "firefox": "󰈹", "google-chrome": "󰊯", "chromium": "󰊯",
  "brave-browser": "󰖟", "opera": "󰋠", "vivaldi": "󰖟",
  "tor-browser": "󰻪", "microsoft-edge": "󰇩",

  // Terminales
  "kitty": "󰄛", "alacritty": "󰖳", "konsole": "󰆍",

  // Editores / IDEs
  "code": "󰨞", "code-oss": "󰨞", "cursor": "󰨞",
  "neovim": "󚣔", "vim": "", "nvim": "󚣔",
  "emacs": "󱩡", "sublime-text": "󰑷", "gedit": "󰤌",
  "kate": "󰤌", "nano": "",

  // Gestores de archivos
  "thunar": "󰉋", "nautilus": "󰉋", "dolphin": "󰉋",
  "ranger": "󰉋", "nemo": "󰉋", "pcmanfm": "󰉋",

  // Comunicación
  "discord": "󰙯", "vesktop": "󰙯", "webcord": "󰙯",
  "telegram-desktop": "󰔁", "signal-desktop": "󰍡",
  "slack": "󰒱", "teams": "󰊻", "thunderbird": "󰇮",
  "evolution": "󰇮", "whatsapp-nativefier": "󰖣",
  "element": "󰭹", "nheko": "󰭹",

  // Música / Multimedia
  "spotify": "󰓇", "vlc": "󰕼", "mpv": "󰎁",
  "rhythmbox": "󰎆", "clementine": "󰽴", "deadbeef": "󰽴",
  "audacity": "󰙩", "obs": "󰐌", "kdenlive": "󰃽",
  "handbrake": "󰃽", "gimp": "󰃡", "inkscape": "󰸌",
  "blender": "󰂫", "darktable": "󰄀",

  // Ofimática
  "libreoffice-writer": "󱎒", "libreoffice-calc": "󱎕",
  "libreoffice-impress": "󱎐", "libreoffice": "󱎒",
  "onlyoffice": "󱎒", "okular": "󰈦", "evince": "󰈦",
  "zathura": "󰈦",

  // Notas / Productividad
  "obsidian": "󰂺", "notion": "󰎠", "logseq": "󰂺",
  "joplin": "󰎠", "standard-notes": "󰎠",

  // Desarrollo
  "github-desktop": "󰊤", "gitkraken": "󰊤",
  "postman": "󰰾", "insomnia": "󰰾",
  "dbeaver": "󰆼", "datagrip": "󰆼",
  "docker-desktop": "󰡨", "android-studio": "󰀲",
  "jetbrains-idea": "󰺷", "jetbrains-pycharm": "󰌠",
  "jetbrains-webstorm": "󰖟",

  // Sistema / Utilidades
  "pavucontrol": "󰕾", "blueman-manager": "󰂯",
  "nm-connection-editor": "󰤨", "gnome-system-monitor": "󰓅",
  "htop": "󰓅", "btop": "󰓅", "mission-center": "󰓅",
  "gparted": "󱊞", "timeshift": "󰁯",
  "gnome-disks": "󰋊", "baobab": "󰋊",
  "flameshot": "󰄀", "spectacle": "󰄀",
  "copyq": "󰅎", "keepassxc": "󰷡",
  "bitwarden": "󰷡", "1password": "󰷡",

  // Gaming
  "steam": "󰓓", "lutris": "󰺵", "heroic": "󰺵",
  "bottles": "󰹞", "gamemode": "󰺵",
  "prismlauncher": "󰍳", "minecraft": "󰍳",

  // Configuración
  "nwg-look": "󰔎", "qt5ct": "󰔎", "lxappearance": "󰔎",
  "hyprland-share-picker": "󱣡",

  // Miscelánea
  "qbittorrent": "󰋊", "transmission": "󰋊",
  "calibre": "󰂺", "foliate": "󰂺",
  "zoom": "󰍡", "skype": "󰒯",
  "virtualbox": "󰪫", "virt-manager": "󰪫",
};

const getIcons = (clients: any[]): string[] => {
  return [...(clients || [])]
    .filter(c => c.class)
    .map(c => {
      const cls: string = c.class.toLowerCase()
      //hay un bug de firefo, se duplica raro el icono, asi que forzamos el icono de firefox para cualquier clase que lo contenga (funcionar funcionalmente pero no es lo ideal, habria que investigar por que se duplica asi y arreglarlo de raiz)
      if (cls.includes("firefox")) return APP_ICONS["firefox"]
      return APP_ICONS[cls] || "󰣆"
    })
    .filter((icon, index, self) => self.indexOf(icon) === index)
}

function WsButton({ ws, focusedId }: { ws: any, focusedId: any }) {
  const [hovered, setHovered] = createState<boolean>(false)

  const iconString = focusedId((fId: number) => {
    const isHovered: boolean = hovered()

    // REGLA DE ORO: Si hay 5 o menos workspaces, mostramos todo siempre
    if (!ws.shouldDeduplicate) return ws.allIcons

    // Si hay más de 5, aplicamos la de-duplicación inteligente
    return (fId === ws.id || isHovered) ? ws.allIcons : ws.uniqueIcons
  })

  return (
    <button
      cssClasses={focusedId((id: number) => id === ws.id ? ["focused"] : [])}
      onClicked={() => ws.focus()}
      valign={Gtk.Align.CENTER}
    >
      <Gtk.EventControllerMotion
        onEnter={() => setHovered(true)}
        onLeave={() => setHovered(false)}
      />
      <box spacing={0} css="padding: 0 4px;">
        <label cssClasses={["ws-id"]} label={`${ws.id}`} />
        <revealer
          revealChild={iconString((s: string) => s.length > 0)}
          transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
          transitionDuration={250}
        >
          <label
            cssClasses={["ws-icons"]}
            label={iconString}
            css="margin-left: 6px;"
          />
        </revealer>
      </box>
    </button>
  )
}
const [cacheLastTimeRendered, setCacheLastTimeRendered] = createState<any[]>([])//hay que crealo signal para no romper el render
export default function Workspaces() {
  const hypr = AstalHyprland.get_default()

  const [wss, setWss] = createState<any[]>([])
  const [focusedId, setFocusedId] = createState<number>(hypr.focusedWorkspace.id)

  const update = () => {
    const allWorkspaces = hypr.get_workspaces()
    const fId = hypr.focusedWorkspace.id
    setFocusedId(fId)

    const sorted = [...allWorkspaces].sort((a, b) => a.id - b.id)
    const globalIcons = new Set<string>()

    // 1. Calculamos los datos básicos e iconos únicos
    const workspacesData = sorted.map(ws => {
      const clients = ws.get_clients ? ws.get_clients() : (ws as any).clients
      const current = getIcons(clients)
      const unique = current.filter(icon => !globalIcons.has(icon))
      unique.forEach(icon => globalIcons.add(icon))

      return {
        id: ws.id,
        focus: () => ws.focus(),
        hasClients: clients.length > 0,
        allIcons: current.slice(0, 3).join(" "),
        uniqueIcons: unique.slice(0, 3).join(" ")
      }
    })

    // 2. Filtramos los que vamos a mostrar realmente
    const visibleWss = workspacesData.filter(ws => ws.hasClients || ws.id === fId)

    // 3. REGRA DE LOS 5: Solo de-duplicamos si hay más de 5 workspaces visibles
    const shouldDeduplicate = visibleWss.length > 5

    // Añadimos esta propiedad a cada objeto para que el botón sepa qué hacer
    const newWss = visibleWss.map(ws => ({ ...ws, shouldDeduplicate }))
    setWss(newWss)    //guardamos el ultimo render en cache para congelar el render cuando la barra no este visible
    if (barVisible()) setCacheLastTimeRendered(newWss)  // ← el valor nuevo, no wss()
  }

  // Nos suscribimos a los cambios relevantes de Hyprland para actualizar la lista de workspaces sin timers
  hypr.connect("notify::workspaces", update)
  hypr.connect("notify::focused-workspace", update)
  hypr.connect("notify::clients", update)

  update()

  return (
    <box cssClasses={["Workspaces"]} spacing={4}>
      <For each={() => barVisible() ? wss() : cacheLastTimeRendered()}>
        {(ws) => <WsButton ws={ws} focusedId={focusedId} />}
      </For>
    </box>
  )
}
