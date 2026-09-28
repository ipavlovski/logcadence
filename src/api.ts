import { hc } from 'hono/client'
import type { AppType } from '../server/app.ts'

export const api = hc<AppType>('/').api

/** Awaits an RPC call, throwing the server's `{ error }` message on non-2xx responses. */
export async function unwrap<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(p: Promise<R>): Promise<Awaited<ReturnType<R['json']>>> {
  const res = await p
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      // not JSON
    }
    throw new Error(message)
  }
  return res.json() as Promise<Awaited<ReturnType<R['json']>>>
}
