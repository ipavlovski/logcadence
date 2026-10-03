import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../../db/client.ts'

// Google Drive login: OAuth Authorization Code with PKCE against a Google Cloud OAuth client of type "Desktop app".
// Google still wants that client's secret on token requests (it isn't secret for installed apps). The client and
// tokens live in data/google.json, next to the databases, never in git.
//
// Google refuses sign-in inside embedded browsers (Electron included), so the login opens in the system browser
// and the callback just shows a page saying it worked; the app polls the status meanwhile.

const FILE = path.join(DATA_DIR, 'google.json')
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
// Read-only access to all of Drive: GPSLogger uploads the files, so the narrower drive.file scope can't see them.
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

export const REDIRECT_URI = `http://127.0.0.1:${Number(process.env.PORT ?? 3002)}/api/gps/drive/callback`

interface Stored {
  clientId?: string
  clientSecret?: string
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

function client(): { clientId: string; clientSecret: string } | null {
  const s = load()
  const clientId = process.env.GOOGLE_CLIENT_ID || s.clientId
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || s.clientSecret
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export const isConfigured = () => !!client()
export const isConnected = () => !!load().refreshToken

export function setClient(clientId: string, clientSecret: string) {
  // A different client invalidates the old tokens.
  save({ clientId, clientSecret })
}

/** Forgets the client and tokens (to switch to another Google Cloud project). */
export function forget() {
  rmSync(FILE, { force: true })
}

export function disconnect() {
  const { clientId, clientSecret } = load()
  if (clientId) save({ clientId, clientSecret })
  else rmSync(FILE, { force: true })
}

// ── login ──────────────────────────────────────────────────────────────────

const pending = new Map<string, { verifier: string; at: number }>()
const b64url = (b: Buffer) => b.toString('base64url')

/** Google's consent page. */
export function loginUrl(): string {
  const c = client()
  if (!c) throw new Error('Set a Google OAuth client first')
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k)
  const verifier = b64url(randomBytes(48))
  const state = b64url(randomBytes(16))
  pending.set(state, { verifier, at: Date.now() })
  const q = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
    code_challenge_method: 'S256',
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    // A refresh token, every time (Google only sends one on the first consent otherwise).
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${AUTH}?${q}`
}

/** Set when Google rejects the refresh token (revoked, or expired: 7 days for apps left in "Testing"). */
export class GoogleAuthError extends Error {}

async function tokenRequest(body: Record<string, string>): Promise<void> {
  const c = client()!
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...body }),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string }
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant' && body.grant_type === 'refresh_token') {
      disconnect()
      throw new GoogleAuthError('Google login expired or was revoked; connect again')
    }
    throw new Error(`Google login failed: ${json.error_description ?? json.error ?? res.status}`)
  }
  const s = load()
  save({
    ...s,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? s.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  })
}

/** Exchanges the callback's code for tokens. */
export async function handleCallback(code: string | undefined, state: string | undefined, error: string | undefined): Promise<void> {
  const p = state ? pending.get(state) : undefined
  if (!p) throw new Error('Google login expired; try again')
  pending.delete(state!)
  if (error || !code) throw new Error(`Google login cancelled (${error ?? 'no code'})`)
  await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: p.verifier })
}

let refreshing: Promise<void> | null = null

/** A valid access token, refreshed when about to expire; null when not connected. */
export async function accessToken(): Promise<string | null> {
  const s = load()
  if (!s.refreshToken || !client()) return null
  if (s.accessToken && (s.expiresAt ?? 0) > Date.now() + 60_000) return s.accessToken
  await (refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken }).finally(() => (refreshing = null)))
  return load().accessToken ?? null
}
