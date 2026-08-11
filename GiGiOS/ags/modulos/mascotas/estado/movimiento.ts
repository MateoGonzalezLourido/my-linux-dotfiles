// Modelo de movimiento puro del lagarto: aceleración/frenado suaves, paradas
// aleatorias y giros aleatorios en mitad del recorrido (no solo al chocar con
// un borde). `azar` se inyecta para poder testear las ramas aleatorias de
// forma determinista; en producción es `Math.random`.
export type EstadoAndar = "caminando" | "parado"

export interface EstadoMovimiento {
  x: number
  direccion: 1 | -1
  vx: number
  estado: EstadoAndar
  ticksParado: number
  distanciaAcumulada: number
  fotograma: 0 | 1
}

export function estadoInicial(): EstadoMovimiento {
  return {
    x: 0,
    direccion: 1,
    vx: 0,
    estado: "caminando",
    ticksParado: 0,
    distanciaAcumulada: 0,
    fotograma: 0,
  }
}

/** Mismo estado inicial, pero con posición y sentido al azar dentro de
 * [minX, maxX]. Para que cada aparición de la mascota (se activa y desactiva
 * con la actividad del escritorio) no arranque siempre en el mismo punto
 * mirando hacia el mismo lado. `minX` por defecto 0 cubre el caso normal
 * (todo el ancho disponible); solo hace falta cuando ya hay un panel
 * ocupando parte de la pantalla al aparecer (ver estado/paneles.ts). */
export function estadoAleatorio(maxX: number, azar: () => number = Math.random, minX = 0): EstadoMovimiento {
  const limiteMax = Math.max(minX, maxX)
  return {
    ...estadoInicial(),
    x: limiteMax > minX ? minX + azar() * (limiteMax - minX) : minX,
    direccion: azar() < 0.5 ? 1 : -1,
  }
}

export interface ParametrosMovimiento {
  /** Velocidad de crucero, en px por tick. */
  velocidadMax: number
  /** Cuánto se acerca `vx` a su objetivo en cada tick (rampa de aceleración/frenado). */
  aceleracion: number
  /** Probabilidad por tick de iniciar una parada mientras camina a velocidad de crucero. */
  probParada: number
  /** Probabilidad por tick de invertir el sentido a media marcha (no al chocar con un borde). */
  probGiro: number
  paradaTicksMin: number
  paradaTicksMax: number
  /** Distancia acumulada (px) que dispara el cambio de fotograma de las patas. */
  umbralFotograma: number
}

// Más tranquilo que un paseo cualquiera: crucero lento, rampa suave, paradas
// largas y poco frecuentes, y casi ningún giro a media marcha (el sentido
// cambia sobre todo al chocar con un borde, no porque decida girarse solo).
export const PARAMETROS_PREDETERMINADOS: ParametrosMovimiento = {
  velocidadMax: 0.9,
  aceleracion: 0.07,
  probParada: 0.004,
  probGiro: 0.0006,
  paradaTicksMin: 20,
  paradaTicksMax: 70,
  umbralFotograma: 2.2,
}

function amortiguar(actual: number, objetivo: number, paso: number): number {
  const delta = objetivo - actual
  if (Math.abs(delta) <= paso) return objetivo
  return actual + Math.sign(delta) * paso
}

function enteroAleatorioCon(azar: () => number, min: number, max: number): number {
  return Math.floor(min + azar() * (max - min + 1))
}

/** Un paso del modelo. No muta `estado`: devuelve el siguiente. `minX` (0 por
 * defecto) desplaza el borde izquierdo del recorrido: lo usa la mascota
 * cuando un panel anclado a la izquierda (el calendario) le tiene vetada esa
 * franja mientras está abierto (ver estado/paneles.ts). */
export function avanzarPaso(
  estado: EstadoMovimiento,
  maxX: number,
  params: ParametrosMovimiento = PARAMETROS_PREDETERMINADOS,
  azar: () => number = Math.random,
  minX = 0,
): EstadoMovimiento {
  let { x, direccion, vx, estado: fase, ticksParado, distanciaAcumulada, fotograma } = estado
  const limiteMax = Math.max(minX, maxX)

  if (fase === "parado") {
    vx = amortiguar(vx, 0, params.aceleracion)
    ticksParado--
    if (ticksParado <= 0) fase = "caminando"
  } else {
    vx = amortiguar(vx, direccion * params.velocidadMax, params.aceleracion)
    // Las decisiones aleatorias solo se toman a velocidad de crucero: decidir
    // pararse o girar en plena rampa de aceleración se vería como un tirón.
    if (Math.abs(vx) > params.velocidadMax * 0.8) {
      if (azar() < params.probParada) {
        fase = "parado"
        ticksParado = enteroAleatorioCon(azar, params.paradaTicksMin, params.paradaTicksMax)
      } else if (azar() < params.probGiro) {
        direccion = direccion === 1 ? -1 : 1
      }
    }
  }

  x += vx
  if (x <= minX) {
    x = minX
    direccion = 1
    vx = 0
    fase = "parado"
    ticksParado = enteroAleatorioCon(azar, params.paradaTicksMin, params.paradaTicksMax)
  } else if (x >= limiteMax) {
    x = limiteMax
    direccion = -1
    vx = 0
    fase = "parado"
    ticksParado = enteroAleatorioCon(azar, params.paradaTicksMin, params.paradaTicksMax)
  }

  // Las patas solo se animan si de verdad hay movimiento apreciable: paradas
  // (incluida la del frenado, que tarda unos ticks en llegar a 0) se congelan.
  if (Math.abs(vx) > 0.15) {
    distanciaAcumulada += Math.abs(vx)
    if (distanciaAcumulada >= params.umbralFotograma) {
      distanciaAcumulada -= params.umbralFotograma
      fotograma = fotograma === 0 ? 1 : 0
    }
  }

  return { x, direccion, vx, estado: fase, ticksParado, distanciaAcumulada, fotograma }
}
