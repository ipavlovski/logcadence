import { RetryableError, withRetry } from '../youtube/http.ts'
import { isClaudeConversation, type ClaudeConversation } from './claudeConversation.ts'

// Live sync of claude.ai chats (what Claude Desktop shows: it keeps nothing on disk). The desktop app signs in
// to claude.ai in a window of its own (electron/claudeWeb.ts) and hands the server a client for that session;
// the web server has none, so there is no live sync there. Kept free of the database: Electron imports it.
//
// claude.ai's internal API is undocumented and unversioned; the endpoints below are the ones claude.ai's own
// page calls. Shapes accepted for the conversation list: a bare array, or { data: [...] } (a paged answer).

/** The claude.ai session, as the desktop app provides it. */
export interface ClaudeWebClient {
  /** The account's active organization (claude.ai's lastActiveOrg cookie); null when signed out. */
  org(): Promise<string | null>
  /** GET https://claude.ai + path as JSON. Throws NotSignedInError (401/403) and RetryableError (429/5xx). */
  getJson(path: string): Promise<unknown>
}

export class NotSignedInError extends Error {
  constructor() {
    super('claude.ai session expired: connect claude.ai again')
  }
}

export { RetryableError }

let client: ClaudeWebClient | undefined

export function setClaudeWeb(c: ClaudeWebClient | undefined) {
  client = c
}

/** Signed in to claude.ai; undefined where there is no live sync (the web server). */
export async function claudeWebConnected(): Promise<boolean | undefined> {
  if (!client) return undefined
  return (await client.org().catch(() => null)) !== null
}

export interface ListedConversation {
  uuid: string
  name: string
  updatedAt: string
}

const PAGE = 100
const MAX_PAGES = 200

/** Every conversation of the signed-in account, newest first as claude.ai lists them; null when not connected. */
export async function listConversations(): Promise<{ org: string; list: ListedConversation[] } | null> {
  const org = client && (await client.org())
  if (!client || !org) return null
  const out = new Map<string, ListedConversation>()
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const res = await withRetry(() => client!.getJson(`/api/organizations/${org}/chat_conversations?limit=${PAGE}&offset=${offset}`))
    const items = Array.isArray(res) ? res : Array.isArray((res as { data?: unknown })?.data) ? (res as { data: unknown[] }).data : null
    if (!items) throw new Error('unexpected answer listing conversations (claude.ai’s API may have changed)')
    let fresh = 0
    for (const it of items as Record<string, unknown>[]) {
      if (typeof it?.uuid !== 'string' || out.has(it.uuid)) continue
      fresh++
      out.set(it.uuid, { uuid: it.uuid, name: typeof it.name === 'string' ? it.name : '', updatedAt: typeof it.updated_at === 'string' ? it.updated_at : '' })
    }
    offset += items.length
    // The last page: has_more says so, or else a short page; or one with nothing new (paging ignored).
    const more = (res as { has_more?: unknown }).has_more
    if (!fresh || (typeof more === 'boolean' ? !more : items.length < PAGE)) break
  }
  return { org, list: [...out.values()] }
}

/** One conversation with every message and tool call. */
export async function fetchConversation(org: string, uuid: string): Promise<ClaudeConversation> {
  if (!client) throw new NotSignedInError()
  const data = await withRetry(() => client!.getJson(`/api/organizations/${org}/chat_conversations/${uuid}?tree=true&rendering_mode=messages&render_all_tools=true`))
  if (!isClaudeConversation(data)) throw new Error('unexpected answer: no chat_messages (claude.ai’s API may have changed)')
  return data
}
