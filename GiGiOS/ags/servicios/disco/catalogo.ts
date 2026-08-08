// servicios/disco/catalogo.ts — qué categorías existen, qué acción limpia cada una y en qué
// grupo se pintan. Puro, sin GTK ni procesos.
//
// ES LA ÚNICA LISTA. `hypr/scripts/analizar-almacenamiento.sh` emite ids de categoría y
// `hypr/scripts/limpiar-almacenamiento.sh` acepta ids de acción; este fichero es el que los une
// con su nombre, su icono y su explicación. Una categoría que llegue del script y no esté aquí se
// IGNORA en vez de pintarse con el id crudo: un `cacheLoQueSea` en la interfaz no le dice nada a
// nadie, y el script puede ir por delante del shell tras una actualización a medias.
//
// ── El nivel de privilegio no es decorativo ──────────────────────────────────
// `privilegio` es lo que decide si una acción puede formar parte de la autolimpieza:
//   "usuario"  bajo $HOME, sin sudo
//   "helper"   root vía /usr/local/bin/gigios-limpieza con NOPASSWD → automatizable
//   "pkexec"   root con diálogo de contraseña → NUNCA automatizable
// `ACCIONES_AUTOMATIZABLES` sale de aquí en vez de estar escrita a mano, así que añadir una acción
// de pkexec no puede colarla por error en el lote desatendido — donde el diálogo aparecería solo,
// de madrugada, sin nadie que lo lea.
import textos from "../../textos/ajustes/almacenamiento.json" with { type: "json" }

export type IdCategoria =
  | "paquetes" | "cachePaquetes" | "cacheAur" | "huerfanos" | "registros"
  | "temporales" | "instantaneas" | "flatpak"
  | "cacheUsuario" | "miniaturas" | "cacheDesarrollo" | "papelera"
  | "descargas" | "documentos" | "imagenes" | "videos" | "musica" | "escritorio"

export type IdAccion =
  | "cachePaquetes" | "cachePaquetesTotal" | "cacheAur" | "huerfanos" | "registros"
  | "temporales" | "cacheUsuario" | "miniaturas" | "cacheDesarrollo" | "papelera"
  | "descargas" | "flatpak"

export type Privilegio = "usuario" | "helper" | "pkexec"

export interface Accion {
  id: IdAccion
  etiqueta: string
  descripcion: string
  privilegio: Privilegio
  /** Se pide confirmación antes de ejecutarla: borra algo que no se regenera solo. */
  peligrosa?: boolean
}

export interface Categoria {
  id: IdCategoria
  nombre: string
  descripcion: string
  icono: string
  grupo: "sistema" | "personal"
  /** Acción que la limpia, si la hay. Sin ella la fila es informativa. */
  accion?: IdAccion
}

const a = textos.acciones
const c = textos.categorias

export const ACCIONES: Accion[] = [
  { id: "cachePaquetes",      etiqueta: a.cachePaquetes.etiqueta,      descripcion: a.cachePaquetes.descripcion,      privilegio: "helper" },
  { id: "cachePaquetesTotal", etiqueta: a.cachePaquetesTotal.etiqueta, descripcion: a.cachePaquetesTotal.descripcion, privilegio: "pkexec", peligrosa: true },
  { id: "cacheAur",           etiqueta: a.cacheAur.etiqueta,           descripcion: a.cacheAur.descripcion,           privilegio: "usuario" },
  { id: "huerfanos",          etiqueta: a.huerfanos.etiqueta,          descripcion: a.huerfanos.descripcion,          privilegio: "helper", peligrosa: true },
  { id: "registros",          etiqueta: a.registros.etiqueta,          descripcion: a.registros.descripcion,          privilegio: "helper" },
  { id: "temporales",         etiqueta: a.temporales.etiqueta,         descripcion: a.temporales.descripcion,         privilegio: "helper" },
  { id: "cacheUsuario",       etiqueta: a.cacheUsuario.etiqueta,       descripcion: a.cacheUsuario.descripcion,       privilegio: "usuario" },
  { id: "miniaturas",         etiqueta: a.miniaturas.etiqueta,         descripcion: a.miniaturas.descripcion,         privilegio: "usuario" },
  { id: "cacheDesarrollo",    etiqueta: a.cacheDesarrollo.etiqueta,    descripcion: a.cacheDesarrollo.descripcion,    privilegio: "usuario" },
  { id: "papelera",           etiqueta: a.papelera.etiqueta,           descripcion: a.papelera.descripcion,           privilegio: "usuario" },
  { id: "descargas",          etiqueta: a.descargas.etiqueta,          descripcion: a.descargas.descripcion,          privilegio: "usuario", peligrosa: true },
  { id: "flatpak",            etiqueta: a.flatpak.etiqueta,            descripcion: a.flatpak.descripcion,            privilegio: "usuario" },
]

export const CATEGORIAS: Categoria[] = [
  { id: "paquetes",        nombre: c.paquetes.nombre,        descripcion: c.paquetes.descripcion,        icono: "󰏖", grupo: "sistema" },
  { id: "cachePaquetes",   nombre: c.cachePaquetes.nombre,   descripcion: c.cachePaquetes.descripcion,   icono: "󰆼", grupo: "sistema", accion: "cachePaquetes" },
  { id: "cacheAur",        nombre: c.cacheAur.nombre,        descripcion: c.cacheAur.descripcion,        icono: "󰣇", grupo: "sistema", accion: "cacheAur" },
  { id: "huerfanos",       nombre: c.huerfanos.nombre,       descripcion: c.huerfanos.descripcion,       icono: "󰅗", grupo: "sistema", accion: "huerfanos" },
  { id: "flatpak",         nombre: c.flatpak.nombre,         descripcion: c.flatpak.descripcion,         icono: "󰏔", grupo: "sistema", accion: "flatpak" },
  { id: "registros",       nombre: c.registros.nombre,       descripcion: c.registros.descripcion,       icono: "󰦪", grupo: "sistema", accion: "registros" },
  { id: "temporales",      nombre: c.temporales.nombre,      descripcion: c.temporales.descripcion,      icono: "󰉒", grupo: "sistema", accion: "temporales" },
  { id: "instantaneas",    nombre: c.instantaneas.nombre,    descripcion: c.instantaneas.descripcion,    icono: "󰆓", grupo: "sistema" },

  { id: "cacheUsuario",    nombre: c.cacheUsuario.nombre,    descripcion: c.cacheUsuario.descripcion,    icono: "󰆼", grupo: "personal", accion: "cacheUsuario" },
  { id: "miniaturas",      nombre: c.miniaturas.nombre,      descripcion: c.miniaturas.descripcion,      icono: "󰋩", grupo: "personal", accion: "miniaturas" },
  { id: "cacheDesarrollo", nombre: c.cacheDesarrollo.nombre, descripcion: c.cacheDesarrollo.descripcion, icono: "󰅩", grupo: "personal", accion: "cacheDesarrollo" },
  { id: "papelera",        nombre: c.papelera.nombre,        descripcion: c.papelera.descripcion,        icono: "󰩹", grupo: "personal", accion: "papelera" },
  { id: "descargas",       nombre: c.descargas.nombre,       descripcion: c.descargas.descripcion,       icono: "󰇚", grupo: "personal", accion: "descargas" },
  { id: "documentos",      nombre: c.documentos.nombre,      descripcion: c.documentos.descripcion,      icono: "󰈙", grupo: "personal" },
  { id: "imagenes",        nombre: c.imagenes.nombre,        descripcion: c.imagenes.descripcion,        icono: "󰋩", grupo: "personal" },
  { id: "videos",          nombre: c.videos.nombre,          descripcion: c.videos.descripcion,          icono: "󰕧", grupo: "personal" },
  { id: "musica",          nombre: c.musica.nombre,          descripcion: c.musica.descripcion,          icono: "󰝚", grupo: "personal" },
  { id: "escritorio",      nombre: c.escritorio.nombre,      descripcion: c.escritorio.descripcion,      icono: "󰇄", grupo: "personal" },
]

const POR_ID = new Map(CATEGORIAS.map(cat => [cat.id, cat]))
const ACCION_POR_ID = new Map(ACCIONES.map(acc => [acc.id, acc]))

export function categoria(id: string): Categoria | undefined {
  return POR_ID.get(id as IdCategoria)
}

export function accion(id: string): Accion | undefined {
  return ACCION_POR_ID.get(id as IdAccion)
}

/** Lo que puede correr sin nadie delante. Debe coincidir con `AUTOMATIZABLES` del monitor bash. */
export const ACCIONES_AUTOMATIZABLES: IdAccion[] = ACCIONES
  .filter(acc => acc.privilegio !== "pkexec")
  .map(acc => acc.id)

/**
 * Cuánto vale un análisis antes de repetirlo, en segundos.
 *
 * Sin esto, cada visita a la sección —y navegar entre «Almacenamiento» y «Liberar espacio» son
 * dos— relanzaba el análisis entero: ~0,6 s de reloj y ~0,7 s de CPU recorriendo el sistema de
 * ficheros para volver a medir lo que se midió hace diez segundos. Diez minutos es holgado para lo
 * que esto observa (una caché de paquetes no cambia sola) y corto frente a lo que sí lo invalida:
 * una limpieza, que fuerza el refresco por su cuenta, y el botón «Volver a analizar».
 */
export const FRESCURA_ANALISIS_S = 600

/** ¿Merece la pena volver a medir? Puro, para poder probar los bordes sin tocar el reloj real. */
export function analisisCaducado(epoch: number, ahoraS: number, frescuraS = FRESCURA_ANALISIS_S): boolean {
  // Sin análisis previo (`epoch: 0`) siempre caduca: no hay nada que enseñar.
  if (!epoch || !Number.isFinite(epoch)) return true
  // Un `epoch` en el futuro es un reloj que ha saltado hacia atrás (cambio de zona, NTP al
  // arrancar). Se trata como caducado en vez de dejar la sección congelada hasta que el reloj lo
  // alcance, que con un salto grande serían horas.
  if (epoch > ahoraS) return true
  return ahoraS - epoch >= frescuraS
}

export interface MedidaCategoria {
  id: string
  bytes: number | null
  detalle: string
  limpiable: boolean
}

export interface FilaCategoria {
  categoria: Categoria
  bytes: number | null
  detalle: string
}

/**
 * Ordena las medidas del script para pintarlas: descarta lo que no está catalogado, agrupa y pone
 * delante lo que más ocupa.
 *
 * Lo NO medido (`bytes: null`) va al final y no al principio, aunque `null` no se pueda comparar:
 * sin esto, `sort` con nulls los deja donde caigan y una fila con un "—" acababa encabezando el
 * desglose como si fuera la que más espacio consume.
 */
export function agrupar(medidas: MedidaCategoria[]): Record<"sistema" | "personal", FilaCategoria[]> {
  const filas: FilaCategoria[] = []
  for (const medida of medidas) {
    const cat = POR_ID.get(medida.id as IdCategoria)
    if (!cat) continue
    filas.push({ categoria: cat, bytes: medida.bytes, detalle: medida.detalle ?? "" })
  }
  const ordenar = (lista: FilaCategoria[]) =>
    [...lista].sort((x, y) => {
      if (x.bytes === null && y.bytes === null) return 0
      if (x.bytes === null) return 1
      if (y.bytes === null) return -1
      return y.bytes - x.bytes
    })
  return {
    sistema: ordenar(filas.filter(f => f.categoria.grupo === "sistema")),
    personal: ordenar(filas.filter(f => f.categoria.grupo === "personal")),
  }
}

/**
 * Cuánto se liberaría ejecutando un conjunto de acciones, según la última medida.
 *
 * Es una ESTIMACIÓN y por eso suma solo lo que tiene medida: las categorías sin acción asociada no
 * cuentan, y las no medidas tampoco. Sumarles un 0 daría una cifra que parece exacta y se queda
 * corta justo en el caso en que el usuario más necesita saberlo.
 */
export function estimarLiberable(medidas: MedidaCategoria[], acciones: IdAccion[]): number {
  const activas = new Set(acciones)
  let total = 0
  for (const medida of medidas) {
    const cat = POR_ID.get(medida.id as IdCategoria)
    if (!cat?.accion || !activas.has(cat.accion)) continue
    if (typeof medida.bytes === "number" && medida.bytes > 0) total += medida.bytes
  }
  return total
}
