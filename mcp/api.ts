// The running app's HTTP API (server/app.ts), as the MCP server sees it. The MCP server never opens the
// database itself: every read and write goes through the app, which validates, normalises tags and logs events.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class LogcadenceApi {
  constructor(
    readonly base: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path)
  }

  async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(this.base + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    } catch {
      throw new Error(`Logcadence isn't running (nothing answers on ${this.base}). Start it, or check the port in the extension's settings.`)
    }
    const json = (await res.json().catch(() => null)) as { error?: unknown } | null
    if (!res.ok) throw new Error(typeof json?.error === 'string' ? json.error : `${method} ${path} → HTTP ${res.status}`)
    return json as T
  }
}
