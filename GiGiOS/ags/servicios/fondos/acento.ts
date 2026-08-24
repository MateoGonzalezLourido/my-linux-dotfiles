// servicios/fondos/acento.ts
//
// Acento adaptativo: el color de acento del shell sale del fondo de escritorio.
//
// CÓMO SE APLICA SIN RECOMPILAR NADA
// ----------------------------------
// Desde que `estilos/_colores.scss` tiene las funciones `acento*()`, los ~250
// sitios del tema que llevaban un acento a mano compilan a `var(--acento…, color
// de siempre)`. Aquí solo hace falta definir esas variables: una hoja de una línea
// en un CssProvider propio, y GTK repinta el shell entero. Apagarlo es vaciar esa
// misma hoja: cada `var()` cae en su reserva y vuelven los colores de siempre.
// Nadie tiene que enumerar qué widgets llevan acento, que es justo lo que haría
// que esto se pudriera al añadir el siguiente.
//
// SON TRES ACENTOS, y ese es el arreglo del primer intento: hacer adaptativo solo
// el azul no cambiaba casi nada, porque **la barra nunca fue azul** (en su CSS el
// azul salía 2 veces frente a 4 del violeta y 3 del turquesa). Ver el reparto de
// papeles en el bloque "Acentos" de `_colores.scss`.
//
// ⚠️ NO SE USA `app.apply_css()`, Y NO ES UN CAPRICHO. Ese método CREA UN PROVIDER
// NUEVO en cada llamada y lo apila (`#cssProviders`), así que una sesión que cambie
// de fondo por franjas horarias iría acumulando providers muertos toda la tarde. Y
// su modo `reset` no sirve de escape: `reset_css()` retira TODOS los providers de
// la app, incluido el de `out.css`, o sea que dejaría el shell sin tema. Un
// provider nuestro recargado con `load_from_string()` no tiene ninguno de los dos
// problemas (comprobado en GTK 4.22: la recarga se ve al vuelo y vaciarlo devuelve
// el fallback).
//
// EL COLOR LO SACA UN SCRIPT, NO ESTE MÓDULO
// ------------------------------------------
// `ags/scripts/acento-fondo.py` (Pillow) hace la cuantización y la corrección de
// legibilidad; ahí está documentado por qué el dominante a secas no vale. Va fuera
// del proceso a propósito: son ~150 ms de CPU por fondo y en el hilo de AGS serían
// 150 ms de interfaz congelada. `execAsync` mantiene eso fuera del bucle de GTK.
//
// El extractor puede decir QUE NO HAY ACENTO (un fondo en blanco y negro, una
// captura de pantalla): sale con 1 y sin línea, y entonces el tema se queda con
// sus colores. Es deliberado que ese caso no invente una paleta.

import Gdk from "gi://Gdk"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { acentoAdaptativoEnabled } from "../../modulos/ajustes/preferences"
import { currentWallpaper } from "../../modulos/orion/data/wallpaperConfig"
import { hojaDePaleta, paletaDeSalida } from "./acentoCss"

const EXTRACTOR = `${GLib.get_user_config_dir()}/ags/scripts/acento-fondo.py`

let arrancado = false
let provider: Gtk.CssProvider | null = null

// Cada petición se numera y solo la última puede escribir. Sin esto, dos cambios
// de fondo seguidos (aplicar un grupo desde Orion es exactamente eso) pueden
// resolverse en orden inverso —son procesos distintos y no tardan lo mismo— y
// dejar puesto el acento del fondo ANTERIOR, que además no se corregiría hasta el
// siguiente cambio. El síntoma sería un acento que no pega con nada y que
// "se arregla solo" más tarde: imposible de atribuir sin este contador.
let peticion = 0

function pintar(hoja: string) {
  if (provider === null) return
  provider.load_from_string(hoja)
}

async function recalcular() {
  const token = ++peticion

  if (!acentoAdaptativoEnabled.get()) {
    pintar(hojaDePaleta(null))
    return
  }

  const fondo = currentWallpaper.get()
  // Sin fondo conocido no hay nada que extraer, pero tampoco hay que borrar el
  // acento vigente: `wallpaper.json` se reescribe entero en cada cambio y el
  // monitor puede pillarlo a medias. Un parpadeo al azul por eso sería peor que
  // conservar un instante el color anterior, que además es el mismo casi siempre.
  if (fondo === "") return

  let paleta: string[] | null = null
  try {
    paleta = paletaDeSalida(await execAsync(["python3", EXTRACTOR, fondo]))
  } catch (_) {
    // rc != 0: fondo sin color, Pillow ausente, imagen ilegible. Sin paleta.
    paleta = null
  }

  if (token !== peticion) return   // llegó tarde: manda una petición posterior
  pintar(hojaDePaleta(paleta))
}

/**
 * Arranca el acento adaptativo. Idempotente.
 *
 * Va con el resto de `init*` de fondo (el `setTimeout` de 4 s de `app.ts`): el
 * shell arranca con sus colores de reserva —que son un tema completo y válido, no
 * un estado a medias— y se tiñe cuando el extractor contesta. Adelantarlo solo
 * pondría a competir un `python3` con el pintado de las ventanas.
 */
export function initAcentoAdaptativo() {
  if (arrancado) return
  arrancado = true

  const display = Gdk.Display.get_default()
  if (display === null) return   // sin display no hay shell al que teñir

  provider = new Gtk.CssProvider()
  provider.connect("parsing-error", (_p, _s, error) => {
    console.error("[acento] CSS inválido:", error.message)
  })
  Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_USER)

  // Los dos disparos: cambiar de fondo y encender o apagar el ajuste. El segundo
  // tiene que recalcular de verdad, no solo repintar, porque al encenderlo el
  // acento del fondo que ya está puesto todavía no se ha extraído nunca.
  currentWallpaper.subscribe(() => void recalcular())
  acentoAdaptativoEnabled.subscribe(() => void recalcular())

  void recalcular()
}
