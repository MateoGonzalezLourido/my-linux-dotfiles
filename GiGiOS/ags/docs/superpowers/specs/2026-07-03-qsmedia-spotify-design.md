# QsMedia — Integración Spotify (fondo, anuncios, "Me gusta")

**Fecha:** 2026-07-03
**Componente:** `widget/QuickSettings.tsx` → función `QsMedia`
**Estado previo:** la tarjeta de reproductor muestra carátula pequeña, título/artista, prev/play/next y barra de progreso, con tema de color por reproductor. Falta: fondo con carátula, manejo de anuncios y botón de "Me gusta".

## Objetivo

Terminar `QsMedia` para Spotify con tres funcionalidades:

1. **Fondo con carátula** — la carátula del track como fondo a sangre de toda la tarjeta, con scrim para legibilidad.
2. **Manejo de anuncios** — detectar cuando Spotify reproduce un anuncio y reaccionar (hoy "no va": carátula en blanco y botones mudos).
3. **Botón "Me gusta"** — un corazón que guarda/quita la canción actual de *Liked Songs* vía Spotify Web API.

No objetivos (YAGNI): añadir a playlists concretas, buscar, colas, letras, controles de shuffle/repeat.

## Arquitectura

Tres piezas, con una unidad nueva y aislada para toda la lógica de Spotify:

### A. `widget/services/SpotifyService.ts` (nuevo, sin GTK)

Módulo con dos capas:

**Helpers puros (testeables con `node --test`):**

- `parseTrackId(trackidOrUrl: string): string | null`
  Extrae el ID base62 de 22 caracteres de:
  - `/com/spotify/track/<id>` (trackid MPRIS)
  - `spotify:track:<id>`
  - `https://open.spotify.com/track/<id>` (con o sin `?si=...`)
  Devuelve `null` si no encaja (p. ej. anuncios o trackid desconocido).

- `isAd(trackid: string): boolean`
  `true` si el trackid contiene `:ad:` o `/ad/`. Los anuncios de Spotify usan trackids tipo `spotify:ad:...` / `/com/spotify/ad/...`.

- `tokenExpired(expiresAt: number, nowMs = Date.now()): boolean`
  `true` si `nowMs >= (expiresAt * 1000) - 30_000` (margen de 30 s para no usar un token a punto de caducar).

**Capa con efectos (HTTP vía `execAsync(["curl", ...])`):**

- `isConfigured(): Promise<boolean>` — `secret-tool lookup service ags-spotify` devuelve un blob no vacío.
- `getCredentials(): Promise<{client_id, client_secret, refresh_token} | null>` — `secret-tool lookup service ags-spotify` → JSON parseado. `null` si no hay entrada o falla.
- `getAccessToken(): Promise<string | null>` — lee la caché efímera `$XDG_RUNTIME_DIR/ags/spotify-token.json`; si el `access_token` no ha caducado (`tokenExpired`) lo devuelve. Si no, obtiene credenciales del keyring y hace el *refresh flow* (`POST https://accounts.spotify.com/api/token`, `grant_type=refresh_token`), reescribe la caché efímera con `access_token`/`expires_at` (mode 600) y lo devuelve. `null` ante cualquier fallo. El access token **nunca** vuelve al keyring (evita churn del wallet); solo vive en tmpfs.
- `isLiked(trackId: string): Promise<boolean>` — `GET /v1/me/tracks/contains?ids=<id>`.
- `setLiked(trackId: string, liked: boolean): Promise<boolean>` — `PUT` (guardar) o `DELETE` (quitar) `/v1/me/tracks?ids=<id>`. Devuelve `true` si la operación tuvo éxito.

Todas las funciones con efecto degradan a un valor seguro (`null`/`false`) ante error de red o token; nunca lanzan.

### B. Cambios en `QsMedia` (`QuickSettings.tsx`)

Nuevo estado reactivo:

- `const [trackId, setTrackId] = createState<string | null>(null)`
- `const [isAd, setIsAd] = createState(false)`
- `const [liked, setLiked] = createState(false)`
- `const [likeVisible, setLikeVisible] = createState(false)` — corazón visible solo si es Spotify, hay servicio configurado y no es anuncio.
- `const [configured, setConfigured] = createState(false)` — resuelto **una vez** al montar: `SpotifyService.isConfigured().then(setConfigured)`. Como `isConfigured()` es asíncrono (consulta el keyring), no se llama en cada `update()`; se cachea aquí y se lee síncronamente.

En `update()` (ya se llama al abrir el panel y cada segundo mientras está abierto):

1. Leer `p.trackid` (string) y calcular `ad = SpotifyService.isAd(trackid)`, `id = SpotifyService.parseTrackId(trackid)`. `p.trackid` basta; si algún día no viniera, el fallback `p.get_meta("xesam:url")` devuelve un `GLib.Variant` y hay que desempaquetarlo (`.get_string()[0]`) antes de pasarlo a `parseTrackId`.
2. Detección de Spotify: `p.bus_name` incluye `spotify` (o `p.identity === "Spotify"`).
3. Si es anuncio: `setTitle("Anuncio")`, `setArtist("")`, `setIsAd(true)`, ocultar corazón, fondo al tema.
4. Si `id` cambió respecto al anterior **y** no es anuncio **y** `configured.get()`: consultar `isLiked(id)` **una sola vez** (no cada segundo) y `setLiked(...)`. Guardar `lastQueriedId` para no repetir.
5. `setLikeVisible(isSpotify && configured.get() && !ad)`.

Botón corazón, a la izquierda del grupo prev/play/next:

- Icono: `󰋑` (lleno) si `liked`, `󰋕` (vacío) si no.
- `visible={likeVisible}`.
- `onClicked`: toggle **optimista** — `setLiked(!liked)` inmediato; llamar `SpotifyService.setLiked(id, nuevoValor)`; si la promesa devuelve `false`, revertir `setLiked(valorAnterior)`.

### C. `style.scss`

- `.qs-media` gana el fondo: cuando hay carátula y no es anuncio, se aplica vía `css=` inline en el box (igual que ya se hace con `background-image` del art pequeño), más una capa hija con `linear-gradient(to right/bottom, rgba(8,8,12,.92), rgba(8,8,12,.55))` como scrim para mantener el texto legible.
- Clase `.qs-media-like` para el botón corazón (mismo tamaño/estilo que `.qs-media-btn`).

## Flujo de datos

```
MPRIS (AstalMpris.Player)
   └─ p.trackid / p.get_meta("xesam:url") / p.coverArt
        └─ QsMedia.update()
             ├─ isAd? ──► UI estado "Anuncio", corazón oculto
             ├─ parseTrackId ──► trackId
             │      └─ (si cambió) SpotifyService.isLiked ──► liked
             └─ coverArt ──► fondo a sangre + scrim

Click corazón
   └─ setLiked optimista ──► SpotifyService.setLiked(PUT/DELETE) ──► revertir si falla
        └─ getAccessToken
             ├─ caché válida? ──► $XDG_RUNTIME_DIR/ags/spotify-token.json (tmpfs)
             └─ caducada ──► refresh flow con credenciales del keyring (secret-tool)
```

## Setup único de OAuth (`~/.config/ags/scripts/spotify-auth.sh`)

Los scripts específicos de este escritorio ags viven en `~/.config/ags/scripts/` (frontera clara frente a `~/.config/hypr/scripts/`, que es de nivel sistema/WM). AGS solo bundlea `.ts/.tsx`, así que un `scripts/` con bash queda fuera del runtime.

Script independiente que el usuario ejecuta **una vez**; el shell en runtime nunca hace el flujo interactivo, solo el refresh.

1. El usuario crea una app en <https://developer.spotify.com/dashboard>, obtiene `client_id` y `client_secret`, y añade `http://127.0.0.1:8888/callback` como Redirect URI.
2. El script pide `client_id`/`client_secret`, abre en el navegador la URL de autorización con scopes `user-library-read user-library-modify` y `redirect_uri=http://127.0.0.1:8888/callback`.
3. Levanta un listener loopback efímero en el puerto 8888 (python3, dependencia solo del script, no del runtime) que captura el parámetro `code`.
4. Cambia `code` → tokens (`POST /api/token`, `grant_type=authorization_code`) con `curl`.
5. Guarda el secreto en el **Secret Service** (KWallet vía `secretservicecompat`):

   ```sh
   printf '%s' "$json" | secret-tool store --label='AGS Spotify' service ags-spotify
   ```

   donde `$json` es `{"client_id":"…","client_secret":"…","refresh_token":"…"}`. Una sola entrada bajo el atributo `service=ags-spotify`; cifrada en reposo por el wallet.

### Almacenamiento de tokens

| Dato | Dónde | Por qué |
| --- | --- | --- |
| `client_id`, `client_secret`, `refresh_token` | Secret Service (`secret-tool`, atributo `service=ags-spotify`) | Secreto de larga duración; cifrado en reposo, desbloqueado con la sesión. Es la vía estándar en Linux. |
| `access_token`, `expires_at` | `$XDG_RUNTIME_DIR/ags/spotify-token.json` (mode 600) | Efímero (~1 h); tmpfs, solo el usuario, se borra al cerrar sesión. No merece cifrado ni persistencia. |

Requisito de runtime: `secret-tool` (paquete `libsecret`) — presente en el sistema. El script de setup además usa `python3` para el listener loopback (solo el setup, no el runtime).

## Errores y degradación

- Sin entrada en el keyring (`ags-spotify`), reproductor no-Spotify, o `parseTrackId` = `null` → **corazón oculto**; fondo, anuncios, título/artista y controles funcionan igual.
- Fallo de red / token inválido en `isLiked` → se asume `false` (corazón vacío), no rompe la tarjeta.
- Fallo al guardar → se revierte el estado optimista del corazón.
- Anuncio → corazón oculto, título "Anuncio", next/prev atenuados (Spotify no deja saltarlos).
- Ninguna llamada HTTP corre en bucle: `isLiked` solo se consulta al **cambiar** de track, no en cada tick del intervalo de 1 s.

## Tests (`node --test`)

`widget/services/SpotifyService.test.ts` cubre los helpers puros:

- `parseTrackId`: trackid MPRIS, URI `spotify:track:`, URL `open.spotify.com` con y sin `?si=`, y casos que devuelven `null` (anuncio, cadena vacía, basura).
- `isAd`: trackids de anuncio (`spotify:ad:`, `/com/spotify/ad/`) → `true`; track normal → `false`.
- `tokenExpired`: caducado, válido, y dentro del margen de 30 s.

La capa HTTP no se testea con red; queda como envoltorio fino alrededor de los helpers.

## Notas de integración

- No requiere tocar `state.tsx` (no es un panel nuevo, va dentro de `QsMedia`).
- `p.trackid`, `p.coverArt` y `p.get_meta(key)` confirmados en `@girs/astalmpris-0.1.d.ts`.
- El repositorio no está bajo git, así que este spec no se commitea; queda como fichero en `docs/superpowers/specs/`.
