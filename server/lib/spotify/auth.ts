import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../../db/client.ts'

// Spotify login: Authorization Code with PKCE, so only a Client ID is needed (no secret).
// The Client ID and tokens live in data/spotify.json, next to the databases, never in git.

const FILE = path.join(DATA_DIR, 'spotify.json')
const ACCOUNTS = 'https://accounts.spotify.com'
const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
]

// Spotify only accepts loopback redirects as an explicit IP, not "localhost".
export const REDIRECT_URI = `http://127.0.0.1:${Number(process.env.PORT ?? 3002)}/api/spotify/callback`

interface Stored {
  clientId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

function load(): Stored {
  try {
    return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Stored) : {}
  } catch {
    return {}
  }
}

function save(s: Stored) {
  writeFileSync(FILE, JSON.stringify(s, null, 2))
  try {
    chmodSync(FILE, 0o600)
  } catch {
    // not supported on every filesystem
  }
}

export const clientId = () => process.env.SPOTIFY_CLIENT_ID || load().clientId || null
export const isConnected = () => !!load().refreshToken

export function setClientId(id: string) {
  // A different app invalidates the old tokens.
  save({ clientId: id })
}

/** Forgets the Client ID and tokens (to switch to another Spotify app). */
export function forget() {
  rmSync(FILE, { force: true })
}

export function disconnect() {
  const { clientId } = load()
  if (clientId) save({ clientId })
  else rmSync(FILE, { force: true })
}

// ── login ──────────────────────────────────────────────────────────────────

const pending = new Map<string, { verifier: string; returnTo: string; at: number }>()
const b64url = (b: Buffer) => b.toString('base64url')

/** Spotify's consent page; afterwards the callback sends the browser back to `returnTo`. */
export function loginUrl(returnTo: string): string {
  const id = clientId()
  if (!id) throw new Error('Set a Spotify Client ID first')
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k)
  const verifier = b64url(randomBytes(48))
  const state = b64url(randomBytes(16))
  pending.set(state, { verifier, returnTo, at: Date.now() })
  const q = new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
    code_challenge_method: 'S256',
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
  })
  return `${ACCOUNTS}/authorize?${q}`
}

async function tokenRequest(body: Record<string, string>): Promise<void> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId()!, ...body }),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string }
  if (!res.ok || !json.access_token) throw new Error(`Spotify login failed: ${json.error_description ?? json.error ?? res.status}`)
  const s = load()
  save({
    ...s,
    accessToken: json.access_token,
    // Refreshes may rotate the refresh token.
    refreshToken: json.refresh_token ?? s.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  })
}

/** Exchanges the callback's code for tokens; returns where to send the browser. */
export async function handleCallback(code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
  const p = state ? pending.get(state) : undefined
  if (!p) throw new Error('Spotify login expired; try again')
  pending.delete(state!)
  if (error || !code) throw new Error(`Spotify login cancelled (${error ?? 'no code'})`)
  await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: p.verifier })
  return p.returnTo
}

let refreshing: Promise<void> | null = null

/** A valid access token, refreshed when about to expire; null when not connected. */
export async function accessToken(): Promise<string | null> {
  const s = load()
  if (!s.refreshToken || !clientId()) return null
  if (s.accessToken && (s.expiresAt ?? 0) > Date.now() + 60_000) return s.accessToken
  await (refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken }).finally(() => (refreshing = null)))
  return load().accessToken ?? null
}
