export interface PositionedClient {
  x?: number | null
  y?: number | null
  address?: string | null
}

const coordinate = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER

/** Orden de lectura de la disposición: filas de arriba abajo y, en cada fila,
 *  ventanas de izquierda a derecha. La dirección desempata ventanas superpuestas
 *  sin depender del orden interno (HashTable) con el que Astal entrega la lista. */
export function orderWorkspaceClients<T extends PositionedClient>(clients: Iterable<T> | null | undefined): T[] {
  return [...(clients ?? [])].sort((a, b) =>
    coordinate(a.y) - coordinate(b.y) ||
    coordinate(a.x) - coordinate(b.x) ||
    (a.address ?? "").localeCompare(b.address ?? ""),
  )
}

export interface WorkspaceRef {
  id: number
}

/** Devuelve el historial con el workspace indicado como el más reciente. */
export function rememberRecentWorkspace(recentIds: Iterable<number>, workspaceId: number): number[] {
  if (!Number.isFinite(workspaceId) || workspaceId <= 0 || workspaceId >= 9000) return [...recentIds]
  return [workspaceId, ...[...recentIds].filter((id) => id !== workspaceId)]
}

/** Conserva los workspaces usados más recientemente y completa los huecos con
 *  los demás candidatos. La salida se ordena por ID para que los botones no
 *  cambien de posición cada vez que se enfoca otro workspace. */
export function selectRecentWorkspaces<T extends WorkspaceRef>(
  workspaces: Iterable<T> | null | undefined,
  recentIds: Iterable<number> | null | undefined,
  focusedId: number,
  requestedLimit: number,
): T[] {
  const sorted = [...(workspaces ?? [])].sort((a, b) => a.id - b.id)
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.round(requestedLimit))
    : 1
  if (sorted.length <= limit) return sorted

  const byId = new Map(sorted.map((workspace) => [workspace.id, workspace]))
  const selectedIds: number[] = []
  const addIfAvailable = (id: number) => {
    if (byId.has(id) && !selectedIds.includes(id)) selectedIds.push(id)
  }

  addIfAvailable(focusedId)
  for (const id of recentIds ?? []) addIfAvailable(id)
  for (const workspace of sorted) addIfAvailable(workspace.id)

  const visible = new Set(selectedIds.slice(0, limit))
  return sorted.filter((workspace) => visible.has(workspace.id))
}
