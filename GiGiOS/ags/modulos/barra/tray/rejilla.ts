export function agruparEnFilas<T>(elementos: readonly T[], tamano: number): T[][] {
  const longitud = Math.max(1, Math.floor(tamano))
  const filas: T[][] = []
  for (let index = 0; index < elementos.length; index += longitud) {
    filas.push(elementos.slice(index, index + longitud))
  }
  return filas
}
