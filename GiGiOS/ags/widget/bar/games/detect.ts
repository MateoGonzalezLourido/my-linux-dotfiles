// Heurística pura de detección de juegos. Sin imports de GTK/GLib — testeada con
// node:test. La "evidencia" del sistema (categorías del .desktop, ruta del proceso)
// la recoge ./evidence.ts y se pasa aquí; los llamadores que puedan tocar disco
// deben usar isGameClient() de ./evidence.ts, no isGame() a pelo.
//
// Orden de decisión (lo negativo va primero, a propósito):
//   1. Lanzadores (Steam, Lutris, Heroic…) → NO, aunque su .desktop diga Categories=Game.
//   2. Apps que nunca son un juego (Discord, navegadores, media, terminales…) → NO.
//   3. Instaladores/desinstaladores de wine/proton → NO (instalar no es jugar).
//   4. Señales fuertes de clase (steam_app_, gamescope, wine/proton, *.exe) → SÍ.
//   5. Ruta del proceso (steamapps/, proton, lutris, heroic…) → SÍ.
//   6. Entrada .desktop conocida: Categories contiene Game → SÍ; conocida y sin Game → NO.
//   7. Último recurso: fullscreen REAL de una app que el escritorio no conoce → SÍ.

export interface GameClientLike {
  class?: string | null
  initialClass?: string | null
  initial_class?: string | null
  title?: string | null
  /** Astal/Hyprland `Fullscreen`: 0 = none, 1 = MAXIMIZADO, 2 = fullscreen real. */
  fullscreen?: number | null
}

export interface GameEvidence {
  /** Categorías freedesktop del .desktop que casa con la ventana. `null`/`[]` = app
   *  desconocida para el escritorio (típico de juegos de Steam/wine, que no instalan
   *  entrada). Un array no vacío SIN "game" es una prueba fuerte de que NO es un juego. */
  categories?: readonly string[] | null
  /** Destino de /proc/<pid>/exe, en minúsculas. */
  exe?: string | null
  /** /proc/<pid>/cmdline, en minúsculas. */
  cmdline?: string | null
}

/** Valor de `Fullscreen` que significa pantalla completa de verdad. El 1 es MAXIMIZADO:
 *  tratarlo como fullscreen era lo que hacía pasar por juego a cualquier ventana
 *  maximizada (Discord, el caso que disparó este arreglo). */
export const FULLSCREEN_REAL = 2

// Subcadenas que, en la clase, marcan la ventana como juego. ".exe" va aparte (sufijo):
// las ventanas de wine usan el nombre del binario.
const CLASS_SIGNALS = ["steam_app_", "gamescope", "wine", "proton"]

// Lanzadores y utilidades del ecosistema gaming: la ventana es el lanzador, no el
// juego. Se comprueban ANTES que CLASS_SIGNALS a propósito — "protontricks" contiene
// "proton" y "winetricks"/"winecfg" contienen "wine".
const LAUNCHER_CLASSES = [
  "steam", "steamwebhelper", "lutris", "heroic", "bottles", "playonlinux",
  "itch", "minigalaxy", "gamehub", "protontricks", "winetricks", "winecfg",
]

// Apps que nunca son un juego, aunque estén maximizadas o en pantalla completa.
const NON_GAME_CLASSES = [
  // navegadores
  "firefox", "chrome", "chromium", "brave", "brave-browser", "zen", "librewolf",
  "vivaldi", "opera", "epiphany", "waterfox", "tor-browser",
  // comunicación (Discord maximizado era el falso positivo original)
  "discord", "vesktop", "webcord", "armcord", "telegram", "org.telegram.desktop",
  "slack", "teams", "whatsapp", "signal", "element", "thunderbird", "zoom", "skype",
  // media
  "mpv", "vlc", "imv", "feh", "eog", "loupe", "gwenview", "mpvpaper", "spotify",
  "celluloid", "totem", "rhythmbox",
  // terminales
  "kitty", "foot", "alacritty", "wezterm", "konsole", "ghostty", "st",
  "gnome-terminal", "xterm", "urxvt", "terminator", "tilix",
  // editores / dev / trabajo
  "code", "code-oss", "vscodium", "cursor", "zed", "emacs", "sublime_text",
  "libreoffice", "obsidian",
  // sistema / captura
  "obs", "nautilus", "thunar", "pcmanfm", "gimp", "blender",
]

/** "org.telegram.desktop" → "desktop"; "net.lutris.Lutris" → "lutris"; los *.exe se
 *  dejan intactos (el punto forma parte del nombre del binario de wine). */
function baseClass(cls: string): string {
  if (!cls || cls.endsWith(".exe")) return cls
  const i = cls.lastIndexOf(".")
  return i >= 0 ? cls.slice(i + 1) : cls
}

/** Coincidencia por nombre, no por subcadena suelta: la clase entera o su último
 *  segmento debe ser la entrada, o llevarla como palabra separada por guiones
 *  ("google-chrome" → "chrome", "firefox-esr" → "firefox"). Con `includes()` a secas,
 *  "st" (el terminal) casaba dentro de "counter-strike" y lo descartaba como juego. */
function inList(cls: string, list: readonly string[]): boolean {
  if (!cls) return false
  const candidates = [cls, baseClass(cls)]
  return list.some((e) =>
    candidates.some((c) => c === e || c.startsWith(`${e}-`) || c.endsWith(`-${e}`)),
  )
}

function classSignal(cls: string): boolean {
  if (!cls) return false
  if (cls.endsWith(".exe")) return true
  return CLASS_SIGNALS.some((sig) => cls.includes(sig))
}

// Rutas típicas de juego: Steam/Proton/Lutris/Heroic instalan fuera del PATH, así que
// el ejecutable delata al juego aunque su clase no diga nada.
const PROC_SIGNALS = [
  "/steamapps/", "steamapps/common", "/steam/steamapps", "/proton", "/wine",
  "/lutris/", "/heroic/", "/gamescope", "/games/", ".exe",
]

function procSignal(path: string | null | undefined): boolean {
  if (!path) return false
  return PROC_SIGNALS.some((sig) => path.includes(sig))
}

// Instaladores y desinstaladores de wine/proton. Caso real: el instalador de Voicemod
// (que ni siquiera es un juego) lanzado desde Steam — Steam le da a su ventana la clase
// `steam_proton`, la misma que a un juego, y su binario cuelga de
// …/compatibilitytools.d/proton-…/wine-preloader. O sea que la señal de clase Y la de
// proceso dicen las dos "juego". Lo que los delata es el título, y de refuerzo el
// binario temporal del instalador en el cmdline.
const INSTALLER_TITLE =
  /(^|\s)(instalar|instalaci[oó]n|install|installing|installer|setup|uninstall|desinstalar)(\s|$|[:\-–—])/i
const INSTALLER_CMD = /installer|setup\.exe|unins\d*\.exe|\\temp\\/i

function isInstallerLike(c: GameClientLike, ev?: GameEvidence | null): boolean {
  const title = c.title ?? ""
  if (title && INSTALLER_TITLE.test(title)) return true
  const cmd = ev?.cmdline ?? ""
  return !!cmd && INSTALLER_CMD.test(cmd)
}

export function isGame(c: GameClientLike | null | undefined, ev?: GameEvidence | null): boolean {
  if (!c) return false

  const cls = (c.class ?? "").toLowerCase()
  const initCls = (c.initialClass ?? c.initial_class ?? "").toLowerCase()
  if (!cls && !initCls) return false

  // 1. El lanzador no es el juego.
  if (inList(cls, LAUNCHER_CLASSES) || inList(initCls, LAUNCHER_CLASSES)) return false

  // 2. Apps que no son juegos ni en pantalla completa.
  if (inList(cls, NON_GAME_CLASSES) || inList(initCls, NON_GAME_CLASSES)) return false

  // 3. Instalar un juego (o cualquier cosa por Proton) no es jugar. Va ANTES de las
  //    señales fuertes: la ventana del instalador las cumple todas.
  if (isInstallerLike(c, ev)) return false

  // 4. Señales fuertes de clase.
  if (classSignal(cls) || classSignal(initCls)) return true

  // 5. Ruta del proceso.
  if (procSignal(ev?.exe) || procSignal(ev?.cmdline)) return true

  // 6. Entrada .desktop conocida: manda lo que diga Categories.
  const cats = ev?.categories
  if (cats && cats.length > 0) return cats.some((cat) => cat.toLowerCase() === "game")

  // 7. Sin nada más: pantalla completa REAL de una app que el escritorio no conoce.
  return (c.fullscreen ?? 0) >= FULLSCREEN_REAL
}
