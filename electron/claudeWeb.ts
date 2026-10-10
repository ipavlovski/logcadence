import { BrowserWindow, session, shell, type Cookie, type Session } from 'electron'
import { NotSignedInError, RetryableError, type ClaudeWebClient } from '../server/lib/ai/claudeWeb.ts'

// claude.ai sign-in for live chat sync (server/lib/ai/claudeWeb.ts). The session lives in its own partition, apart
// from the app's pages, and persists, so one sign-in lasts until claude.ai ends it. Requests go through Chromium's
// network stack (session.fetch) with that session's cookies, as claude.ai's own page would send them.

const ORIGIN = 'https://claude.ai'
const PARTITION = 'persist:claude-web'
// Where the sign-in may go inside the window; anything else opens in the browser.
const SIGN_IN_HOSTS = [/(^|\.)claude\.ai$/, /(^|\.)anthropic\.com$/, /^accounts\.google\.com$/, /^appleid\.apple\.com$/]

let ses: Session | undefined

/** The partition, with Electron and the app left out of the user agent (claude.ai and Google treat it as a browser). */
function claudeSession(): Session {
  if (ses) return ses
  ses = session.fromPartition(PARTITION)
  ses.setUserAgent(ses.getUserAgent().replace(/ (Electron|logcadence\w*)\/\S+/gi, ''))
  return ses
}

async function cookie(name: string): Promise<string | null> {
  const [c] = await claudeSession().cookies.get({ url: ORIGIN, name })
  return c?.value ? decodeURIComponent(c.value) : null
}

/** Signed in: claude.ai's session cookie, and the organization its page last used. */
async function signedInOrg(): Promise<string | null> {
  return (await cookie('sessionKey')) ? cookie('lastActiveOrg') : null
}

export const claudeWebClient: ClaudeWebClient = {
  org: signedInOrg,
  async getJson(path) {
    const res = await claudeSession().fetch(ORIGIN + path, { headers: { accept: 'application/json' } })
    if (res.headers.get('cf-mitigated') === 'challenge') throw new Error('claude.ai asked for a browser check: connect claude.ai again')
    if (res.status === 401 || res.status === 403) throw new NotSignedInError()
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`claude.ai answered HTTP ${res.status}`, Number(res.headers.get('retry-after')) || undefined)
    if (!res.ok) throw new Error(`claude.ai answered HTTP ${res.status}`)
    return res.json()
  },
}

const allowed = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && SIGN_IN_HOSTS.some((h) => h.test(u.hostname))
  } catch {
    return false
  }
}

let open: Promise<boolean> | undefined

/** Shows claude.ai's sign-in; resolves true once signed in (the window then closes), false if it is closed first. */
export function connectClaude(parent?: BrowserWindow): Promise<boolean> {
  return (open ??= signIn(parent).finally(() => (open = undefined)))
}

function signIn(parent?: BrowserWindow): Promise<boolean> {
  const s = claudeSession()
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      width: 1000,
      height: 820,
      parent,
      title: 'Connect claude.ai',
      autoHideMenuBar: true,
      backgroundColor: '#282c34',
      webPreferences: { session: s, contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      s.cookies.off('changed', onCookie)
      resolve(ok)
      if (!w.isDestroyed()) w.close()
    }
    // Signed in once claude.ai's page has picked an organization (it sets the cookie after sign-in).
    const onCookie = (_e: unknown, c: Cookie, _cause: string, removed: boolean) => {
      if (removed || c.name !== 'lastActiveOrg' || !/claude\.ai$/.test(c.domain ?? '')) return
      void signedInOrg().then((org) => org && finish(true))
    }
    s.cookies.on('changed', onCookie)
    w.on('closed', () => void signedInOrg().then((org) => finish(!!org)))

    w.webContents.on('will-navigate', (e, url) => {
      if (allowed(url)) return
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    })
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) return { action: 'allow' }
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    void w.loadURL(`${ORIGIN}/login`)
  })
}

/** Signs out: drops the partition's cookies and storage. */
export async function disconnectClaude(): Promise<void> {
  await claudeSession().clearStorageData()
}
