import { isAd } from "../spotify/parse.ts"

export type EstadoAnuncio = {
  esAnuncio: boolean
  indice: number
}

/** Mantiene la numeración de un bloque de anuncios sin contar dos veces la misma pista. */
export class ContadorAnuncios {
  private indice = 0
  private ultimoId: string | null = null

  actualizar(trackId: string | null | undefined): EstadoAnuncio {
    const id = String(trackId ?? "")
    if (!isAd(id)) {
      this.indice = 0
      this.ultimoId = null
      return { esAnuncio: false, indice: 0 }
    }

    if (id !== this.ultimoId) {
      this.indice += 1
      this.ultimoId = id
    }
    return { esAnuncio: true, indice: this.indice }
  }
}

/** Deriva una carátula para los clientes que solo publican la URL de YouTube. */
export function obtenerMiniaturaYoutube(url: string | null | undefined): string {
  if (!url) return ""
  const coincidencia = url.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/)
  return coincidencia ? `https://i.ytimg.com/vi/${coincidencia[1]}/hqdefault.jpg` : ""
}

export function esReproductorSpotify(reproductor: { bus_name?: string | null } | null | undefined): boolean {
  return String(reproductor?.bus_name ?? "").toLowerCase().includes("spotify")
}
