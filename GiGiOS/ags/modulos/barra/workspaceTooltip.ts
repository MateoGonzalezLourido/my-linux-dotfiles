export interface WorkspaceTooltipInput {
  appName?: string | null
  className?: string | null
  initialClass?: string | null
  title?: string | null
}

const SEPARATOR = "(?:[-—–|·:])"
const TERMINAL_CLASS = /(?:^|[.\s_-])(kitty|foot|alacritty|wezterm|ghostty|konsole|terminal|xterm)(?:$|[.\s_-])/i

function oneLine(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function comparable(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function classLabel(value: string | null | undefined): string {
  const raw = oneLine(value).replace(/\.desktop$/i, "").replace(/\.exe$/i, "")
  const short = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw
  return short
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(" ")
}

function aliasesFor(input: WorkspaceTooltipInput, appName: string): string[] {
  const aliases = [
    appName,
    classLabel(input.className),
    classLabel(input.initialClass),
  ].map(oneLine).filter((value) => value.length >= 2)

  return [...new Set(aliases)].sort((a, b) => b.length - a.length)
}

function stripAppDecoration(title: string, aliases: string[]): string {
  let result = title

  // Los navegadores y editores suelen publicar "documento - nombre de app".
  // Se elimina únicamente el nombre si está en un extremo y separado, para no
  // estropear títulos que casualmente contienen el nombre de la aplicación.
  for (let pass = 0; pass < 2; pass++) {
    for (const alias of aliases) {
      const escaped = escapeRegex(alias)
      result = result
        .replace(new RegExp(`^${escaped}\\s*${SEPARATOR}\\s*`, "iu"), "")
        .replace(new RegExp(`\\s*${SEPARATOR}\\s*${escaped}$`, "iu"), "")
        .trim()
    }
  }

  return result
}

function terminalContext(title: string, input: WorkspaceTooltipInput): string {
  const classes = `${input.className ?? ""} ${input.initialClass ?? ""}`
  if (!TERMINAL_CLASS.test(classes)) return title

  // "usuario@equipo:~/proyecto" aporta mucho ruido. El directorio actual es la
  // parte útil y, normalmente, basta con su último componente.
  const match = /^(?:[^@:\s]+@)?[^:\s]+:\s*(~?(?:\/[^\s]+)+|~)\s*$/.exec(title)
  if (!match) return title
  const path = match[1].replace(/\/$/, "")
  if (path === "~") return path
  return path.slice(path.lastIndexOf("/") + 1) || path
}

function truncate(value: string, max = 44): string {
  const chars = Array.from(value)
  if (chars.length <= max) return value

  const cut = chars.slice(0, max - 1).join("")
  const wordBoundary = cut.lastIndexOf(" ")
  const readable = wordBoundary >= Math.floor(max * 0.65) ? cut.slice(0, wordBoundary) : cut
  return `${readable.trimEnd()}…`
}

/** Tooltip corto para un icono de ventana: aplicación y contexto en líneas separadas. */
export function buildWorkspaceTooltip(input: WorkspaceTooltipInput): string {
  const appName = oneLine(input.appName) || classLabel(input.className) || classLabel(input.initialClass) || "Aplicación"
  const rawTitle = oneLine(input.title)
  if (!rawTitle) return appName

  let context = stripAppDecoration(rawTitle, aliasesFor(input, appName))
  context = terminalContext(context, input)

  if (!context || comparable(context) === comparable(appName)) return appName
  return `${appName}\n${truncate(context)}`
}
