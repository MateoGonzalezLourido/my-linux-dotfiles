// Invalidación del catálogo de aplicaciones de Orion.
//
// Hay DOS cachés de `.desktop` en el módulo y ninguna caduca sola: `_appCache`
// en `components/sections/AppsSection.tsx` (la rejilla) y `_cache` en
// `search/handlers/apps.ts` (el buscador). Se poblaron pensando en un catálogo
// que solo cambia entre sesiones, cosa que dejó de ser cierta en cuanto Orion
// puede desinstalar: sin esto, la app recién borrada seguía saliendo en la
// rejilla y en la búsqueda hasta reiniciar el shell — y al pulsarla, sin dar
// ningún error, no se abría nada.
//
// Este módulo es solo el punto de encuentro (y no importa GTK a propósito): así
// `RightPanel` avisa sin depender de la sección ni del buscador, que es lo que
// habría creado un ciclo de imports entre los tres.

type Invalidador = () => void

const invalidadores: Invalidador[] = []

/**
 * Registra un consumidor del catálogo. Cada uno se encarga de tirar su caché y,
 * si tiene UI montada, de volver a pintarla.
 */
export function registrarInvalidadorCatalogo(fn: Invalidador): void {
  invalidadores.push(fn)
}

/**
 * Avisa de que la lista de apps instaladas ya no es la que había.
 *
 * Cada invalidador va en su propio try: uno que falle (una sección a medio
 * desmontar) no puede dejar sin refrescar a los demás.
 */
export function invalidarCatalogoApps(): void {
  for (const fn of invalidadores) {
    try { fn() } catch (_) {}
  }
}
