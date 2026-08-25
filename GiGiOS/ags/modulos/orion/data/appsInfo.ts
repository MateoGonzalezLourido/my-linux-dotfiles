// Caché compartida de `Gio.AppInfo.get_all()` — la lista cruda de `.desktop`
// instalados. Antes había hasta CUATRO escaneos independientes del mismo
// catálogo (el buscador en `search/handlers/apps.ts`, la rejilla de
// `AppsSection.tsx`, los iconos de favoritos en `favoritosFlow.tsx` y el
// auto-sanado de `appResolver.ts` — este último sin cachear siquiera, así que
// repetía el escaneo completo en cada favorito que necesitaba resolverse),
// cada uno parseando los mismos ~161 ficheros por separado en la misma
// sesión. Se invalida junto con el resto del catálogo (ver `catalogo.ts`),
// que es lo que hace que una app recién instalada o desinstalada se refleje
// sin reiniciar el shell.

import Gio from "gi://Gio"
import { registrarInvalidadorCatalogo } from "./catalogo"

let _cache: Gio.AppInfo[] | null = null

export function getAppInfos(): Gio.AppInfo[] {
  if (!_cache) _cache = (Gio.AppInfo.get_all() as Gio.AppInfo[]).filter(a => a.should_show())
  return _cache
}

registrarInvalidadorCatalogo(() => { _cache = null })
