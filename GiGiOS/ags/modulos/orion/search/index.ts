import { SearchEngine } from "./engine"
import { appsHandler } from "./handlers/apps"
import { keybindsHandler } from "./handlers/keybinds"

export const searchEngine = new SearchEngine()

// Order matters: inline handlers are checked first by their defaultFor, not by registration order,
// but register inline handlers first so they appear visibly first in potential debug output.
searchEngine.register(keybindsHandler)
searchEngine.register(appsHandler)

export type { SearchResult, SearchHandler, SearchContext } from "./types"
