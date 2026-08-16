/** La escala del volumen de ENTRADA, que no es la misma que la de salida.
 *
 * Puro y sin GI: se prueba con `node --test`.
 *
 * ── Por qué el micrófono tiene su propia escala ──────────────────────────────
 *
 * En este equipo (Realtek ALC897, mic frontal) PipeWire combina "Capture" +
 * "Front Mic Boost" en una única curva cúbica cuyo 100% ronda +60 dB de
 * ganancia analógica total — mucho más de lo que necesita un micro de sobremesa
 * a distancia normal, y la causa medida de la saturación al subir el slider. Por
 * eso el 0-100 % que ve el usuario se remapea a `0..MIC_SAFE_MAX` de la curva
 * real, calibrado grabando voz y midiendo el pico en dBFS: el 100 % de la UI es
 * "el máximo seguro medido", nunca el máximo físico. (El comentario original
 * remitía a `GiGiOS/CLAUDE.md` para esta calibración y **allí nunca estuvo**;
 * este fichero es hoy el sitio donde vive.)
 *
 * ── Y por qué la conversión vive AQUÍ y no en cada sitio ─────────────────────
 *
 * Porque el precio de no compartirla ya se pagó dos veces. La constante estaba
 * exportada desde `QuickSettings.tsx` (4400 líneas de GTK) y la fórmula iba
 * abierta en código en cada consumidor, así que era **posible** —y pasó— que un
 * sitio pintara el valor crudo: la pastilla "Micrófono" de Quick Settings decía
 * **40** con el mismo micro que su propio submenú enseñaba como **100**, porque
 * la pastilla hacía `Math.round(v * 100)` sobre la fracción cruda de PipeWire y
 * el submenú dividía antes por `MIC_SAFE_MAX`. El fallo es silencioso por
 * naturaleza (dos números plausibles, ningún error) y solo se ve poniendo las
 * dos vistas una al lado de la otra.
 *
 * **Regla: ningún sitio nuevo puede escribir `volume * 100` para un micrófono.**
 * Todo lo que enseñe o acepte un porcentaje de entrada pasa por aquí.
 */

/** Techo del volumen de entrada, en fracción cruda de PipeWire (0-1). */
export const MIC_SAFE_MAX = 0.40

/** Fracción cruda de PipeWire → fracción que ve el usuario (0..1).
 *
 * Se recorta a 1 porque el valor crudo puede venir por encima del techo: lo
 * pone cualquier otra herramienta (pavucontrol, `wpctl set-volume`) o un preset
 * guardado antes de que existiera el techo. Enseñar "250 %" sería peor que
 * enseñar "100 %" — el slider ya no puede subir más de ahí. */
export function fraccionMostradaMic(crudo: number): number {
  if (!Number.isFinite(crudo) || crudo <= 0) return 0
  return Math.min(1, crudo / MIC_SAFE_MAX)
}

/** Fracción cruda de PipeWire → el entero 0..100 que se pinta. */
export function porcentajeMic(crudo: number): number {
  return Math.round(fraccionMostradaMic(crudo) * 100)
}

/** El 0..100 que toca el usuario → fracción cruda que se le escribe al endpoint. */
export function crudoDesdePorcentajeMic(porcentaje: number): number {
  if (!Number.isFinite(porcentaje)) return 0
  const p = Math.max(0, Math.min(100, porcentaje))
  return (p / 100) * MIC_SAFE_MAX
}
