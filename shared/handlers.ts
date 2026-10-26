import type { CaptureFields, CaptureSection, HandlerId } from './types.ts'

// Handlers: what's special about captures from some sites. A page captured with the Chrome extension goes to the
// Bookmarks tab; the first handler whose url matches decides what makes two captures the same page, what is read
// from it (fields), and how it is shown. A page no handler claims is a plain web page. The extension has its own
// list (extension/common.js: how to screenshot and read each one); this one decides, on the server.

export interface HandlerField {
  key: string
  label: string
  type: 'text' | 'number'
  /** A person's name (an author, a seller): "@name" in the search finds it. */
  person?: boolean
  /** Taken off the start of the text: "u/" of "u/alice". */
  strip?: RegExp
}

/** What a handler formats: a capture's fields and dates. */
interface Shown {
  fields: CaptureFields
  publishedAt: number | null
  capturedAt: number
}

export interface CaptureHandler {
  id: HandlerId
  name: string
  /** "post" / "posts", "listing" / "listings". */
  one: string
  many: string
  /** Shown in the Handlers view. */
  domains: string[]
  about: string
  /** How the extension captures these pages. */
  capture: string
  /** The capture's key (what makes two captures the same page) for a url this handler claims; null when it doesn't. */
  match(u: URL): string | null
  /** The page's title without the site's own decoration ("Marketplace – … | Facebook"). */
  title?(t: string): string
  /** The url kept for a capture: without what doesn't change the page. */
  canonical(u: URL, key: string): string
  /** What a capture is grouped under: a host, a subreddit, a listing's location. `given` is what the page said. */
  site(u: URL, given: string | undefined, fields: CaptureFields): string
  /** Where the site's own page is, if it has one. */
  siteLink(site: string, url: string): string | null
  /** "site", "subreddit", "location". */
  siteLabel: string
  /** "Posted", "Listed": the label of `publishedAt`; null when the handler doesn't read one. */
  published: string | null
  fields: HandlerField[]
  /** Notes always; Reddit posts also keep comments. */
  sections: CaptureSection[]
  /** The grid's thumbnails, width / height. */
  thumbRatio: number
  openLabel: string
  /** After the site, on a card: "u/alice", a seller. */
  byline(c: Shown): string
  /** A card's second line: "412 points • 87 comments • 3 days ago". */
  meta(c: Shown): string
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 864e5],
  ['month', 30 * 864e5],
  ['week', 7 * 864e5],
  ['day', 864e5],
  ['hour', 36e5],
  ['minute', 6e4],
]
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 days ago". */
export function ago(at: number, now = Date.now()): string {
  const ms = now - at
  const [unit, size] = UNITS.find(([, n]) => ms >= n) ?? UNITS.at(-1)!
  return rtf.format(-Math.max(1, Math.floor(ms / size)), unit)
}

const count = (x: string | number | undefined, one: string) => (typeof x !== 'number' ? null : `${x.toLocaleString()} ${one}${x === 1 ? '' : 's'}`)
const text = (x: string | number | undefined) => (x === undefined || x === '' ? null : String(x))
const join = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' • ')
const host = (u: URL) => u.hostname.replace(/^www\./, '')

// ── Reddit ─────────────────────────────────────────────────────────────────

/** A Reddit post's id from its url (…/comments/<id>/…, also on a comment's link, or redd.it/<id>). */
export function redditPostId(u: URL): string | null {
  if (u.hostname === 'redd.it') return u.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1]?.toLowerCase() ?? null
  if (!/(^|\.)reddit\.com$/.test(u.hostname)) return null
  return u.pathname.match(/\/comments\/([a-z0-9]+)(\/|$)/i)?.[1]?.toLowerCase() ?? null
}

const reddit: CaptureHandler = {
  id: 'reddit',
  name: 'Reddit',
  one: 'post',
  many: 'posts',
  domains: ['reddit.com', 'old.reddit.com', 'redd.it'],
  about:
    'A Reddit post is kept once, however it was opened (new or old Reddit, a comment’s link, redd.it): capturing it again replaces its screenshot and numbers and keeps your notes, comments and tags. Posts are grouped by subreddit.',
  capture:
    'The whole post, scrolled through and stitched into one screenshot, with its subreddit and icon, author, score, comment count and when it was posted. “Add as comment” in the extension adds what’s on screen to the post’s comments.',
  match: redditPostId,
  canonical(u, key) {
    // The post's link as Reddit gives it, without the query, the comment and the old/np/m host.
    const m = u.pathname.match(/^(\/r\/[^/]+)?\/comments\/[a-z0-9]+(\/[^/]+)?/i)
    return `https://www.reddit.com${m ? m[0] : `/comments/${key}`}/`
  },
  site(u, given) {
    const name = (given ?? '').trim().replace(/^\/?r\//i, '') || u.pathname.match(/^\/r\/([^/]+)/)?.[1] || ''
    return name ? `r/${name}` : ''
  },
  siteLink: (site) => (site ? `https://www.reddit.com/${site}/` : null),
  siteLabel: 'subreddit',
  published: 'Posted',
  fields: [
    { key: 'author', label: 'Author', type: 'text', person: true, strip: /^\/?u\// },
    { key: 'score', label: 'Score', type: 'number' },
    { key: 'commentCount', label: 'Comments', type: 'number' },
  ],
  sections: ['notes', 'comments'],
  thumbRatio: 4 / 3,
  openLabel: 'Open on Reddit',
  byline: (c) => (c.fields.author ? `u/${c.fields.author}` : ''),
  meta: (c) => join([count(c.fields.score, 'point'), count(c.fields.commentCount, 'comment'), c.publishedAt != null && ago(c.publishedAt)]),
}

// ── Facebook Marketplace ───────────────────────────────────────────────────

const marketplace: CaptureHandler = {
  id: 'marketplace',
  name: 'Facebook Marketplace',
  one: 'listing',
  many: 'listings',
  domains: ['facebook.com/marketplace/item/…'],
  about:
    'A listing is kept once by its id, wherever it was opened from: capturing it again replaces its screenshot and what it says (a new price, say) and keeps your notes and tags. Listings are grouped by location. Tag them to keep track (e.g. marketplace/desk, contacted). Facebook’s page changes often, so a field it couldn’t read can be filled in on the listing’s page here.',
  capture: 'What’s on screen, with the price, condition, location, seller and when it was listed, read from the listing’s text.',
  match: (u) => (/(^|\.)facebook\.com$/.test(u.hostname) ? (u.pathname.match(/^\/marketplace\/(?:[^/]+\/)?item\/(\d+)/)?.[1] ?? null) : null),
  canonical: (_u, key) => `https://www.facebook.com/marketplace/item/${key}/`,
  // "(3) Marketplace – Steel helmet | Facebook": the unread count, and Facebook's.
  title: (t) => t.replace(/^\(\d+\)\s*/, '').replace(/^Marketplace\s*[–-]\s*/, '').replace(/\s*\|\s*Facebook$/, ''),
  site: (_u, _given, fields) => text(fields.location) ?? 'Marketplace',
  siteLink: () => 'https://www.facebook.com/marketplace/',
  siteLabel: 'location',
  published: 'Listed',
  fields: [
    { key: 'price', label: 'Price', type: 'text' },
    { key: 'condition', label: 'Condition', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'seller', label: 'Seller', type: 'text', person: true },
  ],
  sections: ['notes'],
  thumbRatio: 4 / 3,
  openLabel: 'Open on Facebook',
  byline: (c) => text(c.fields.seller) ?? '',
  meta: (c) => join([text(c.fields.price), text(c.fields.condition), c.publishedAt != null && `listed ${ago(c.publishedAt)}`]),
}

// ── any other page ─────────────────────────────────────────────────────────

const page: CaptureHandler = {
  id: 'page',
  name: 'Web page',
  one: 'page',
  many: 'pages',
  domains: ['any other site'],
  about: 'Any page no other handler claims. Its url without the #fragment makes it the same page; pages are grouped by site.',
  capture: 'What’s on screen, with the page’s title and favicon.',
  match(u) {
    const v = new URL(u.href)
    v.hash = ''
    return v.href
  },
  canonical: (_u, key) => key,
  site: (u) => host(u),
  siteLink: (_site, url) => new URL(url).origin,
  siteLabel: 'site',
  published: null,
  fields: [],
  sections: ['notes'],
  thumbRatio: 16 / 9,
  openLabel: 'Open page',
  byline: () => '',
  meta: (c) => new Date(c.capturedAt).toLocaleTimeString([], { timeStyle: 'short' }),
}

/** Tried in order; `page` takes the rest. */
export const HANDLERS: CaptureHandler[] = [reddit, marketplace, page]
export const HANDLER_IDS = HANDLERS.map((h) => h.id)

export const handlerById = (id: HandlerId): CaptureHandler => HANDLERS.find((h) => h.id === id) ?? page

/** The handler that claims `u`, and the key it gives the page. */
export function handlerFor(u: URL): { handler: CaptureHandler; key: string } {
  for (const handler of HANDLERS) {
    const key = handler.match(u)
    if (key) return { handler, key }
  }
  return { handler: page, key: page.match(u)! }
}

const MAX_TEXT = 500

/** The handler's fields from what was sent: other keys are dropped, numbers rounded, text trimmed; empty ones left out. */
export function cleanFields(handler: CaptureHandler, raw: unknown): CaptureFields {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: CaptureFields = {}
  for (const f of handler.fields) {
    const v = o[f.key]
    if (f.type === 'number') {
      const n = typeof v === 'string' && v.trim() ? Number(v.replace(/[,\s]/g, '')) : v
      if (typeof n === 'number' && Number.isFinite(n)) out[f.key] = Math.round(n)
    } else if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).trim().replace(f.strip ?? /^$/, '').trim().slice(0, MAX_TEXT)
      if (t) out[f.key] = t
    }
  }
  return out
}
