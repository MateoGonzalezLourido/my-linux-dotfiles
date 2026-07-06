# QsMedia Spotify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminar la tarjeta `QsMedia` de QuickSettings para Spotify: fondo con carátula, manejo de anuncios y botón "Me gusta" (Liked Songs vía Spotify Web API).

**Architecture:** Un módulo aislado sin GTK (`widget/services/spotify/`) con helpers puros (testeados por `node --test`) y una capa fina de efectos que habla con la Web API vía `curl`. Las credenciales de larga duración viven en el Secret Service (KWallet, `secret-tool`); el access token efímero en `$XDG_RUNTIME_DIR/ags/`. `QsMedia` consume ese servicio y añade estado reactivo para track/anuncio/like.

**Tech Stack:** TypeScript + JSX (ags/gtk4), AstalMpris, `ags/process` (`execAsync`), GLib (gio file IO), `curl`, `secret-tool` (libsecret), `python3` (solo el script de setup), Node built-in test runner.

> **Sin git:** el repositorio no está bajo control de versiones. Donde un plan normal haría `git commit`, aquí el checkpoint es **ejecutar los tests** (tareas puras) o **recargar el shell y observar** (`ags run ~/.config/ags/app.ts`). No ejecutar comandos git.

---

## File Structure

- `widget/services/spotify/parse.ts` — **nuevo**. Helpers puros: `parseTrackId`, `isAd`, `tokenExpired`. Sin imports de ags/GTK.
- `widget/services/spotify/parse.test.ts` — **nuevo**. Tests con `node:test`.
- `widget/services/spotify/SpotifyService.ts` — **nuevo**. Capa con efectos: `isConfigured`, `getCredentials`, `getAccessToken`, `isLiked`, `setLiked`. Importa `parse.ts` + `ags/process` + GLib.
- `scripts/spotify-auth.sh` — **nuevo**. Bootstrap OAuth de una sola vez (específico de ags).
- `widget/QuickSettings.tsx` — **modificar** la función `QsMedia` (aprox. líneas 773–933).
- `style.scss` — **modificar**: fondo/scrim de `.qs-media` y clase `.qs-media-like`.

---

## Task 1: Helpers puros de parsing (`parse.ts`)

**Files:**
- Create: `widget/services/spotify/parse.ts`
- Test: `widget/services/spotify/parse.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `widget/services/spotify/parse.test.ts`:

```ts
// widget/services/spotify/parse.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseTrackId, isAd, tokenExpired } from "./parse.ts"

test("parseTrackId extrae el id base62 de trackid MPRIS, URI y URL", () => {
  assert.equal(parseTrackId("/com/spotify/track/1Yk0cQdMLx5RzzFTYwmuld"), "1Yk0cQdMLx5RzzFTYwmuld")
  assert.equal(parseTrackId("spotify:track:1Yk0cQdMLx5RzzFTYwmuld"), "1Yk0cQdMLx5RzzFTYwmuld")
  assert.equal(parseTrackId("https://open.spotify.com/track/1Yk0cQdMLx5RzzFTYwmuld"), "1Yk0cQdMLx5RzzFTYwmuld")
  assert.equal(parseTrackId("https://open.spotify.com/track/1Yk0cQdMLx5RzzFTYwmuld?si=abcdef"), "1Yk0cQdMLx5RzzFTYwmuld")
})

test("parseTrackId devuelve null para anuncios, vacío o basura", () => {
  assert.equal(parseTrackId("/com/spotify/ad/0000000000000000000000"), null)
  assert.equal(parseTrackId("spotify:ad:xyz"), null)
  assert.equal(parseTrackId(""), null)
  assert.equal(parseTrackId(null), null)
  assert.equal(parseTrackId(undefined), null)
  assert.equal(parseTrackId("cosa-sin-track"), null)
})

test("isAd detecta trackids de anuncio", () => {
  assert.equal(isAd("spotify:ad:12345"), true)
  assert.equal(isAd("/com/spotify/ad/12345"), true)
  assert.equal(isAd("/com/spotify/track/1Yk0cQdMLx5RzzFTYwmuld"), false)
  assert.equal(isAd(""), false)
  assert.equal(isAd(null), false)
})

test("tokenExpired respeta el margen de 30s", () => {
  const now = 1_000_000_000_000 // ms
  // expiresAt en segundos
  assert.equal(tokenExpired(now / 1000 + 3600, now), false) // caduca en 1h -> válido
  assert.equal(tokenExpired(now / 1000 - 1, now), true)     // ya caducado
  assert.equal(tokenExpired(now / 1000 + 20, now), true)    // dentro del margen de 30s
  assert.equal(tokenExpired(0, now), true)                  // sin token
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `node --test widget/services/spotify/parse.test.ts`
Expected: FAIL — `Cannot find module './parse.ts'` (aún no existe).

- [ ] **Step 3: Implementar `parse.ts`**

Create `widget/services/spotify/parse.ts`:

```ts
// widget/services/spotify/parse.ts
// Lógica pura de Spotify — sin imports de GTK/ags para poder testear con node --test.

/** true si el trackid corresponde a un anuncio de Spotify. */
export function isAd(trackid: string | null | undefined): boolean {
  if (!trackid) return false
  return trackid.includes(":ad:") || trackid.includes("/ad/")
}

/**
 * Extrae el ID base62 de 22 caracteres de un trackid MPRIS, una URI
 * (`spotify:track:<id>`) o una URL (`https://open.spotify.com/track/<id>`).
 * Devuelve null para anuncios o cadenas sin track.
 */
export function parseTrackId(input: string | null | undefined): string | null {
  if (!input || isAd(input)) return null
  const m = input.match(/track[:/]([0-9A-Za-z]{22})/)
  return m ? m[1] : null
}

/**
 * true si el access token caducó. `expiresAt` en segundos epoch; se aplica un
 * margen de 30 s para no usar un token a punto de expirar.
 */
export function tokenExpired(expiresAt: number, nowMs: number = Date.now()): boolean {
  return nowMs >= expiresAt * 1000 - 30_000
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `node --test widget/services/spotify/parse.test.ts`
Expected: PASS — 4 tests, 0 fallos.

- [ ] **Step 5: Checkpoint**

No hay git. Deja los dos ficheros creados y los tests en verde antes de seguir.

---

## Task 2: Servicio con efectos (`SpotifyService.ts`)

**Files:**
- Create: `widget/services/spotify/SpotifyService.ts`

Esta capa tiene efectos de red/IO; no se testea con node. Se verifica que **compila** (syntax check) y funcionalmente tras el setup OAuth de la Task 3.

- [ ] **Step 1: Implementar el servicio**

Create `widget/services/spotify/SpotifyService.ts`:

```ts
// widget/services/spotify/SpotifyService.ts
// Capa con efectos: habla con la Spotify Web API vía curl. Credenciales de larga
// duración en el Secret Service (secret-tool); access token efímero en $XDG_RUNTIME_DIR.
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import { parseTrackId, isAd, tokenExpired } from "./parse"

// Reexport para que QsMedia importe todo desde un único módulo.
export { parseTrackId, isAd } from "./parse"

interface Creds { client_id: string; client_secret: string; refresh_token: string }
interface TokenCache { access_token: string; expires_at: number }

const RUNTIME_DIR = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_user_runtime_dir()
const TOKEN_CACHE = `${RUNTIME_DIR}/ags/spotify-token.json`

let credsCache: Creds | null = null

/** Lee las credenciales del keyring (una sola entrada JSON bajo service=ags-spotify). */
export async function getCredentials(): Promise<Creds | null> {
  if (credsCache) return credsCache
  try {
    const out = await execAsync(["secret-tool", "lookup", "service", "ags-spotify"])
    const json = JSON.parse(out)
    if (json?.client_id && json?.client_secret && json?.refresh_token) {
      credsCache = json
      return json
    }
  } catch (e) { /* no configurado */ }
  return null
}

export async function isConfigured(): Promise<boolean> {
  return (await getCredentials()) !== null
}

function readTokenCache(): TokenCache | null {
  try {
    const [ok, contents] = GLib.file_get_contents(TOKEN_CACHE)
    if (ok) return JSON.parse(new TextDecoder().decode(contents))
  } catch (e) { /* sin caché */ }
  return null
}

function writeTokenCache(t: TokenCache) {
  try {
    const dir = GLib.path_get_dirname(TOKEN_CACHE)
    if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) GLib.mkdir_with_parents(dir, 0o700)
    GLib.file_set_contents(TOKEN_CACHE, JSON.stringify(t))
    execAsync(["chmod", "600", TOKEN_CACHE]).catch(() => { })
  } catch (e) { /* best-effort */ }
}

/** Devuelve un access token válido, refrescándolo si hace falta. null ante fallo. */
export async function getAccessToken(): Promise<string | null> {
  const cached = readTokenCache()
  if (cached && !tokenExpired(cached.expires_at)) return cached.access_token

  const creds = await getCredentials()
  if (!creds) return null
  try {
    const out = await execAsync(["curl", "-s", "-X", "POST",
      "https://accounts.spotify.com/api/token",
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-d", "grant_type=refresh_token",
      "-d", `refresh_token=${creds.refresh_token}`,
      "-d", `client_id=${creds.client_id}`,
      "-d", `client_secret=${creds.client_secret}`,
    ])
    const json = JSON.parse(out)
    if (!json?.access_token) return null
    const cache: TokenCache = {
      access_token: json.access_token,
      expires_at: Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
    }
    writeTokenCache(cache)
    return cache.access_token
  } catch (e) { return null }
}

/** true si el track está en Liked Songs. false ante cualquier fallo. */
export async function isLiked(trackId: string): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false
  try {
    const out = await execAsync(["curl", "-s",
      `https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`,
      "-H", `Authorization: Bearer ${token}`,
    ])
    const json = JSON.parse(out)
    return Array.isArray(json) && json[0] === true
  } catch (e) { return false }
}

/** Guarda (PUT) o quita (DELETE) el track de Liked Songs. true si tuvo éxito. */
export async function setLiked(trackId: string, liked: boolean): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false
  try {
    const out = await execAsync(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
      "-X", liked ? "PUT" : "DELETE",
      `https://api.spotify.com/v1/me/tracks?ids=${trackId}`,
      "-H", `Authorization: Bearer ${token}`,
      "-H", "Content-Length: 0",
    ])
    const code = parseInt(out.trim(), 10)
    return code >= 200 && code < 300
  } catch (e) { return false }
}
```

- [ ] **Step 2: Verificar sintaxis (sin git, sin bundle completo)**

Run: `tsc --jsx preserve --module esnext --target esnext --skipLibCheck --noResolve --noEmit --allowJs widget/services/spotify/SpotifyService.ts 2>&1 | grep -E "error TS1[0-9]{3}" || echo "OK sin errores de sintaxis"`
Expected: `OK sin errores de sintaxis` (los errores de imports no resueltos por `--noResolve` no aparecen como TS1xxx).

- [ ] **Step 3: Checkpoint**

Servicio creado. La verificación funcional real llega tras la Task 3 (necesita credenciales).

---

## Task 3: Script de setup OAuth (`scripts/spotify-auth.sh`)

**Files:**
- Create: `scripts/spotify-auth.sh`

- [ ] **Step 1: Escribir el script**

Create `scripts/spotify-auth.sh`:

```bash
#!/usr/bin/env bash
# Setup único: obtiene un refresh_token de Spotify y lo guarda en el keyring
# (Secret Service, service=ags-spotify). Específico del escritorio ags.
set -euo pipefail

REDIRECT="http://127.0.0.1:8888/callback"
SCOPES="user-library-read user-library-modify"

command -v python3 >/dev/null || { echo "Falta python3"; exit 1; }
command -v secret-tool >/dev/null || { echo "Falta secret-tool (libsecret)"; exit 1; }

echo "Crea una app en https://developer.spotify.com/dashboard"
echo "y añade EXACTAMENTE este Redirect URI: ${REDIRECT}"
echo
read -rp "Spotify Client ID: " CLIENT_ID
read -rsp "Spotify Client Secret: " CLIENT_SECRET; echo

enc() { python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

AUTH_URL="https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=$(enc "$REDIRECT")&scope=$(enc "$SCOPES")"

echo "Abriendo el navegador para autorizar…"
xdg-open "$AUTH_URL" >/dev/null 2>&1 || echo "Abre manualmente: $AUTH_URL"

CODE=$(python3 - <<'PY'
import http.server, urllib.parse
result = {}
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        result['code'] = q.get('code', [''])[0]
        self.send_response(200); self.end_headers()
        self.wfile.write("Listo. Puedes cerrar esta pestana.".encode())
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 8888), H).handle_request()
print(result.get('code', ''))
PY
)

[ -n "$CODE" ] || { echo "No se recibió el code de autorización."; exit 1; }

RESP=$(curl -s -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=${CODE}" \
  -d "redirect_uri=${REDIRECT}" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}")

REFRESH=$(printf '%s' "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("refresh_token",""))')
[ -n "$REFRESH" ] || { echo "No se obtuvo refresh_token. Respuesta: $RESP"; exit 1; }

JSON=$(python3 -c 'import json,sys; print(json.dumps({"client_id":sys.argv[1],"client_secret":sys.argv[2],"refresh_token":sys.argv[3]}))' \
  "$CLIENT_ID" "$CLIENT_SECRET" "$REFRESH")

printf '%s' "$JSON" | secret-tool store --label='AGS Spotify' service ags-spotify
echo "✓ Credenciales guardadas en el keyring (service=ags-spotify)."
```

- [ ] **Step 2: Hacerlo ejecutable y validar sintaxis bash**

Run: `chmod +x scripts/spotify-auth.sh && bash -n scripts/spotify-auth.sh && echo "sintaxis OK"`
Expected: `sintaxis OK`

- [ ] **Step 3: Ejecutar el setup (manual, una vez)**

Run: `./scripts/spotify-auth.sh`
Expected: pide Client ID/Secret, abre el navegador, tras autorizar imprime `✓ Credenciales guardadas…`.

- [ ] **Step 4: Verificar que el keyring tiene la entrada**

Run: `secret-tool lookup service ags-spotify | python3 -c 'import json,sys; d=json.load(sys.stdin); print("refresh_token" in d)'`
Expected: `True`

- [ ] **Step 5: Checkpoint**

Credenciales en el keyring. El servicio de la Task 2 ya puede autenticar.

---

## Task 4: Integrar en `QsMedia` (anuncios + fondo + botón "Me gusta")

**Files:**
- Modify: `widget/QuickSettings.tsx` (función `QsMedia`, ~773–933; imports arriba del fichero)

- [ ] **Step 1: Importar el servicio**

En la zona de imports de `widget/QuickSettings.tsx` (junto a los otros `import … from "./…"`), añadir:

```ts
import * as Spotify from "./services/spotify/SpotifyService"
```

- [ ] **Step 2: Añadir estado reactivo en `QsMedia`**

Dentro de `QsMedia`, tras la línea `const [themeIdx, setThemeIdx] = createState(0)`, añadir:

```ts
  const [trackId, setTrackIdState] = createState<string | null>(null)
  const [isAdState, setIsAd] = createState(false)
  const [liked, setLiked] = createState(false)
  const [likeVisible, setLikeVisible] = createState(false)
  const [configured, setConfigured] = createState(false)
  let lastQueriedId: string | null = null

  // Se resuelve una sola vez: isConfigured() consulta el keyring (async), así que
  // se cachea aquí y luego se lee síncronamente en update().
  Spotify.isConfigured().then(setConfigured)
```

- [ ] **Step 3: Detectar anuncio y calcular título/like dentro de `update()`**

En `update()`, localizar estas dos líneas:

```ts
    setTitle(p.title || "Sin título")
    setArtist(p.artist || "Artista desconocido")
```

y reemplazarlas por:

```ts
    const rawTrackId = p.trackid || ""
    const ad = Spotify.isAd(rawTrackId)
    const id = Spotify.parseTrackId(rawTrackId)
    const isSpotify = (p.bus_name || "").includes("spotify")
    setIsAd(ad)

    if (ad) {
      setTitle("Anuncio")
      setArtist("")
    } else {
      setTitle(p.title || "Sin título")
      setArtist(p.artist || "Artista desconocido")
    }

    setLikeVisible(isSpotify && configured.get() && !ad && id !== null)

    // Consultar "liked" solo al CAMBIAR de track (no en cada tick de 1 s).
    if (!ad && id && configured.get()) {
      if (id !== lastQueriedId) {
        lastQueriedId = id
        setTrackIdState(id)
        Spotify.isLiked(id).then(setLiked)
      }
    } else {
      lastQueriedId = null
    }
```

- [ ] **Step 4: Fondo a sangre con scrim en la tarjeta**

Localizar la apertura del box raíz de la tarjeta:

```tsx
    <box
      cssClasses={["qs-media"]}
      visible={hasPlayer}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
    >
```

y reemplazarla por (añade `css` con fondo derivado de `cover`/`isAdState`):

```tsx
    <box
      cssClasses={["qs-media"]}
      visible={hasPlayer}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      css={createComputed(() => {
        const c = cover.get()
        if (!c || isAdState.get()) return ""
        // Doble background: gradiente oscuro (scrim) SOBRE la carátula → texto legible.
        return `background-image: linear-gradient(rgba(8,8,12,0.88), rgba(8,8,12,0.62)), url('${c}');`
          + ` background-size: cover; background-position: center;`
      })}
    >
```

- [ ] **Step 5: Añadir el botón "Me gusta"**

Localizar el box de controles:

```tsx
        <box spacing={2} valign={Gtk.Align.CENTER}>
          <button cssClasses={["qs-media-btn"]} onClicked={() => {
            const p = mpris.players[playerIndex.get()]
            if (p) {
              const name = p.bus_name.replace("org.mpris.MediaPlayer2.", "")
              execAsync(["playerctl", "-p", name, "previous"]).catch(() => {})
            }
          }} css={curTheme((t) => `color: ${t.accent};`)}>
            <label label="󰒮" />
          </button>
```

e insertar el botón corazón **como primer hijo** de ese box, justo después de `<box spacing={2} valign={Gtk.Align.CENTER}>` y antes del primer `<button …>󰒮`:

```tsx
          <button
            cssClasses={["qs-media-btn", "qs-media-like"]}
            visible={likeVisible}
            onClicked={() => {
              const id = trackId.get()
              if (!id) return
              const next = !liked.get()
              setLiked(next) // optimista
              Spotify.setLiked(id, next).then((ok) => { if (!ok) setLiked(!next) })
            }}
            css={createComputed(() => liked.get()
              ? "color: #f38ba8;"
              : `color: ${MEDIA_THEMES[themeIdx.get()].accent};`)}
          >
            <label label={liked((v) => v ? "󰋑" : "󰋕")} />
          </button>
```

- [ ] **Step 6: Verificar sintaxis del fichero**

Run: `tsc --jsx preserve --module esnext --target esnext --skipLibCheck --noResolve --noEmit --allowJs widget/QuickSettings.tsx 2>&1 | grep -E "error TS1[0-9]{3}" || echo "OK sin errores de sintaxis"`
Expected: `OK sin errores de sintaxis`

- [ ] **Step 7: Confirmar que `createComputed` está importado**

Run: `grep -n "createComputed" widget/QuickSettings.tsx | head -1`
Expected: aparece en la línea de import (`import { createState, For, createComputed } from "ags"`). Si no estuviera, añadirlo a ese import.

- [ ] **Step 8: Checkpoint**

`QsMedia` integrado. La verificación visual llega en la Task 5 tras el estilo.

---

## Task 5: Estilos (`style.scss`)

**Files:**
- Modify: `style.scss` (regla `.qs-media` y nueva `.qs-media-like`)

- [ ] **Step 1: Inspeccionar la regla actual de `.qs-media`**

Run: `grep -n "\.qs-media\b" style.scss | head`
Expected: localiza el bloque `.qs-media { … }` para no duplicar propiedades (especialmente `padding`/`border-radius`, que hacen que el fondo respire).

- [ ] **Step 2: Asegurar padding/redondeo en `.qs-media` y añadir `.qs-media-like`**

En el bloque `.qs-media { … }`, garantizar que existan (añadir si faltan) `border-radius: 12px;` y `padding: 10px;` para que el fondo a sangre tenga margen respecto al borde de la tarjeta y esquinas redondeadas. Justo después del cierre de `.qs-media { … }`, añadir:

```scss
.qs-media-like {
  // Hereda el tamaño/estilo de .qs-media-btn; el color lo fija el css inline
  // (rojo cuando está en "Me gusta", acento del tema cuando no).
  min-width: 24px;
}
```

- [ ] **Step 3: Recargar el shell y verificar**

Run: `ags run ~/.config/ags/app.ts`
Con Spotify sonando, abrir QuickSettings y comprobar:
- La tarjeta de media muestra la **carátula como fondo** oscurecido, con título/artista/botones legibles.
- Aparece el **corazón** a la izquierda de ⏮; al pulsarlo cambia a lleno/rojo y la canción entra en "Me gusta" de Spotify (verificar en la app de Spotify). Volver a pulsar la quita.
- Cuando Spotify reproduce un **anuncio**: título "Anuncio", sin artista, fondo al tema y **corazón oculto**.
- Con un reproductor que no sea Spotify (o sin credenciales), el corazón no aparece y el resto funciona igual.

- [ ] **Step 4: Checkpoint final**

Feature completa: fondo, anuncios y "Me gusta" funcionando.

---

## Self-Review (cobertura del spec)

- **Fondo con carátula** → Task 4 Step 4 + Task 5. ✔
- **Anuncios** → Task 4 Step 3 (título "Anuncio", corazón oculto) + Step 4 (fondo al tema si `isAdState`). ✔
- **Botón "Me gusta"** → Task 4 Steps 2/5 (estado + botón optimista) apoyado en `SpotifyService.setLiked`/`isLiked` (Task 2). ✔
- **OAuth / Secret Service / token efímero** → Task 3 (script) + Task 2 (`getCredentials` vía `secret-tool`, caché en `$XDG_RUNTIME_DIR/ags/`). ✔
- **Helpers puros testeables** → Task 1 (`parse.ts` + tests). ✔
- **Degradación segura** → Task 4 Step 3 (`likeVisible` requiere Spotify+configured+!ad+id) y capa de servicio con `.catch`→valores seguros (Task 2). ✔

Nombres consistentes entre tareas: `parseTrackId`, `isAd`, `tokenExpired`, `getCredentials`, `isConfigured`, `getAccessToken`, `isLiked`, `setLiked`; estados `trackId/isAdState/liked/likeVisible/configured` y `lastQueriedId`.
