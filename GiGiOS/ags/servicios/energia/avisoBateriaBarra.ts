// servicios/energia/avisoBateriaBarra.ts
//
// «Mostrar la barra con la batería baja» (Ajustes > Barra > Comportamiento).
//
// Une los dos lados que ninguno de los dos módulos debe conocer del otro: el estado real
// de la batería (`powerState.ts`, que es quien habla con AstalBattery) y las tres
// preferencias del ajuste (`modulos/ajustes/preferences.ts`). Publica un solo booleano
// para que `Barra.tsx` no tenga que combinar siete accessors dentro de `checkVisibility()`.
//
// Vive en `servicios/` y no dentro de `modulos/barra/` porque importa la fachada de
// preferencias, y esa fachada ya importa de `servicios/energia/`: colgarlo del lado de la
// barra no cerraría ningún ciclo hoy, pero deja el cálculo donde vive el dato.
//
// Lo que NO hace, y es deliberado: seguir a `powerSaveActive`. Ese estado se enciende
// también con `forcePowerSave` —un interruptor a mano que funciona en un sobremesa sin
// batería y estando enchufado—, y el ajuste que pidió el usuario es «cuando la batería
// esté baja y no se esté cargando». Del modo ahorro se toma prestado el NÚMERO
// (`powerSaveThreshold`) cuando así se elige, nada más.
import { createComputed } from "ags"
import {
  bateriaCargando, bateriaNivel, bateriaPresente, powerSaveThreshold,
} from "./powerState"
import {
  barraAvisoBateria, barraAvisoBateriaPct, barraAvisoBateriaUsaUmbralAhorro,
} from "../../modulos/ajustes/preferences"

/** La barra debe estar abajo y dejar de auto-ocultarse: batería presente, descargando y
 *  por debajo del umbral elegido. */
export const barraFijaPorBateriaBaja = createComputed(
  [
    barraAvisoBateria, barraAvisoBateriaUsaUmbralAhorro, barraAvisoBateriaPct,
    powerSaveThreshold, bateriaPresente, bateriaCargando, bateriaNivel,
  ],
  (activo, usaUmbralAhorro, pctPropio, pctAhorro, presente, cargando, nivel) => {
    if (!activo || !presente || cargando) return false
    const umbral = usaUmbralAhorro ? pctAhorro : pctPropio
    // `nivel > 0` descarta la lectura transitoria de 0 del proxy de upower antes de tener
    // el valor real — el mismo guard que usa `recompute()` en powerState.ts. Con el umbral
    // del ahorro a 0 (su forma de decir "desactivado") esto además deja el aviso mudo, que
    // es lo coherente: si el ahorro no se enciende nunca, su número tampoco baja la barra.
    return nivel > 0 && nivel <= umbral
  },
)
