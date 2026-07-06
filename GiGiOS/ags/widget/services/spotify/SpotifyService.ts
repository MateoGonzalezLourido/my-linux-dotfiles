// widget/services/spotify/SpotifyService.ts
// Capa con efectos: habla con la Spotify Web API vía curl. Credenciales de larga
// duración en un JSON plano (config/spotify-creds.json, chmod 600); access token
// efímero en $XDG_RUNTIME_DIR.
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import { parseTrackId, isAd, tokenExpired } from "./parse"

// Reexport para que QsMedia importe todo desde un único módulo.
export { parseTrackId, isAd } from "./parse"

interface Creds { client_id: string; client_secret: string; refresh_token: string }
interface TokenCache { access_token: string; expires_at: number }

const RUNTIME_DIR = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_user_runtime_dir()
const TOKEN_CACHE = `${RUNTIME_DIR}/ags/spotify-token.json`
// Credenciales de larga duración en texto plano. Fichero personal (chmod 600),
// fuera de git. Formato: { client_id, client_secret, refresh_token }.
const CREDS_FILE = `${GLib.get_user_config_dir()}/ags/config/spotify-creds.json`

let credsCache: Creds | null = null

/** Lee las credenciales del JSON plano en config/spotify-creds.json. */
export async function getCredentials(): Promise<Creds | null> {
  if (credsCache) return credsCache
  try {
    const [ok, contents] = GLib.file_get_contents(CREDS_FILE)
    if (ok) {
      const json = JSON.parse(new TextDecoder().decode(contents))
      if (json?.client_id && json?.client_secret && json?.refresh_token) {
        credsCache = json
        return json
      }
    }
  } catch (e) { /* no configurado */ }
  return null
}

export async function isConfigured(): Promise<boolean> {
  return (await getCredentials()) !== null
}

/**
 * true solo si la cuenta es Premium. Los endpoints de biblioteca (/me/tracks)
 * devuelven 403 en cuentas free, así que el botón "Me gusta" solo tiene sentido
 * con Premium. Implica estar configurado (getAccessToken requiere credenciales).
 */
export async function isPremium(): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false
  try {
    const out = await execAsync(["curl", "-s", "https://api.spotify.com/v1/me",
      "-H", `Authorization: Bearer ${token}`,
    ])
    const json = JSON.parse(out)
    return json?.product === "premium"
  } catch (e) { return false }
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
