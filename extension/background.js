// Logcadence capture: screenshots the page and POSTs it, with its url, title and icon, to the Logcadence app's API
// on 127.0.0.1 (server/routes/captures.ts), for its Bookmarks tab. Pages of a site with a handler (common.js) get
// more: a Reddit post is one screenshot of the whole post (scrolled through and stitched) with its subreddit, score
// and so on; a Marketplace listing comes with its price, condition, location and seller. Any other page is what is
// on screen. "comment" adds what is on screen to the comments of a Reddit post already captured. Bookmarks of
// YouTube, TikTok and Instagram pages go to SEO Dashboard (../seo-dashboard) instead, which takes the same request.

import { appFor, getPort, handlerOf, isVideoSite } from './common.js'

// The server refuses captures without it (a web page can't send it).
const HEADER = 'x-logcadence-capture'

// Chrome allows two captureVisibleTab calls a second.
const CAPTURE_GAP_MS = 550
// Canvas limit is ~32k px; posts longer than this are cut (in device pixels).
const MAX_HEIGHT = 30000
const THUMB_WIDTH = 640
const QUALITY = 0.9

// ── talking to Logcadence ──────────────────────────────────────────────────

/** Whether the app that `url`'s captures go to is running. */
async function ping(url) {
  const app = appFor(url)
  const port = await getPort(app)
  const out = { port, name: app.ports[port], ok: false }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/capture/ping`)
    return { ...out, ok: res.ok && (await res.json()).app === app.id }
  } catch {
    return out
  }
}

async function send(body) {
  const app = appFor(body.url)
  const port = await getPort(app)
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/capture`, { method: 'POST', headers: { 'content-type': 'application/json', [HEADER]: '1' }, body: JSON.stringify(body) })
  } catch {
    throw new Error(`${app.ports[port]} isn't running (nothing on port ${port})`)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json
}

// ── capturing ──────────────────────────────────────────────────────────────

/** Captures the tab for `target` (bookmark | comment) and sends it; returns the app's answer. */
async function capture(tab, target) {
  if (!/^https?:/.test(tab.url ?? '')) throw new Error('Only web pages can be captured')
  const handler = handlerOf(tab.url)
  if (target === 'comment') {
    if (!handler?.comments) throw new Error('Comments go to a Reddit post')
    return send({ target, url: tab.url, title: tab.title ?? '', ...(await visible(tab)) })
  }
  const body =
    handler?.id === 'reddit' ? await redditPost(tab) : handler?.id === 'marketplace' ? { ...(await visible(tab, 4 / 3)), ...(await readPage(tab, readListing)) } : await visible(tab, 16 / 9)
  return send({ target, url: tab.url, ...body, title: body.title || tab.title || '' })
}

/** What's on screen; with a thumbnail ratio (a bookmark, not a comment), also a thumbnail and the favicon. */
async function visible(tab, ratio) {
  const shot = await bitmapOf(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }))
  const out = { image: await toDataUrl(shot, 0, 0, shot.width, shot.height), width: shot.width, height: shot.height }
  if (!ratio) return out
  return { ...out, thumb: await thumbOf(shot, ratio), icon: await favicon(tab.url) }
}

/** What `read` (run in the page) finds there; nothing when it fails: the screenshot is what matters. */
async function readPage(tab, read) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: read })
    return result ?? {}
  } catch {
    return {}
  }
}

/** The whole post: scrolled through a screen at a time and stitched, with what the page shows about it. */
async function redditPost(tab) {
  const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: preparePost })
  if (!page) throw new Error('Could not find the post on the page')
  try {
    const { rect, vh } = page
    const parts = []
    let scale = 1
    for (let y = rect.top; y < rect.bottom; ) {
      const [{ result: sy }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrollToY, args: [y] })
      await sleep(parts.length ? CAPTURE_GAP_MS : 250) // lazy images and the scroll settle; and Chrome's rate limit
      const shot = await bitmapOf(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }))
      scale = shot.width / page.vw
      const end = Math.min(rect.bottom, sy + vh)
      if (end <= y) break // the page can't scroll any further
      parts.push({ shot, sy, y, end })
      y = end
      if ((y - rect.top) * scale >= MAX_HEIGHT) break
    }
    if (!parts.length) throw new Error('Nothing captured')
    const width = Math.round(rect.width * scale)
    const height = Math.min(MAX_HEIGHT, Math.round((parts.at(-1).end - rect.top) * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    for (const p of parts) {
      const sx = (rect.left - page.scrollX) * scale
      const srcY = (p.y - p.sy) * scale
      const h = (p.end - p.y) * scale
      ctx.drawImage(p.shot, sx, srcY, width, h, 0, (p.y - rect.top) * scale, width, h)
    }
    const whole = canvas.transferToImageBitmap()
    return {
      image: await toDataUrl(whole, 0, 0, width, height),
      thumb: await thumbOf(whole, 4 / 3),
      width,
      height,
      title: page.post.title || tab.title,
      icon: (page.icon && (await iconDataUrl(page.icon))) || undefined,
      site: page.post.subreddit,
      fields: { author: page.post.author, score: page.post.score, commentCount: page.post.comments },
      publishedAt: page.post.postedAt,
    }
  } finally {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: restorePage, args: [page.scrollY] })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bitmapOf = async (dataUrl) => createImageBitmap(await (await fetch(dataUrl)).blob())

async function toDataUrl(bitmap, sx, sy, w, h, outW = w, outH = h) {
  const canvas = new OffscreenCanvas(outW, outH)
  canvas.getContext('2d').drawImage(bitmap, sx, sy, w, h, 0, 0, outW, outH)
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY }))
}

/** The top of the image at `ratio` (width / height), THUMB_WIDTH wide, for the grid. */
function thumbOf(bitmap, ratio) {
  const w = bitmap.width
  const h = Math.min(bitmap.height, Math.round(w / ratio))
  const outW = Math.min(THUMB_WIDTH, w)
  return toDataUrl(bitmap, 0, 0, w, h, outW, Math.round((h * outW) / w))
}

/** The favicon Chrome has for the page (from its cache: no request to the site). */
function favicon(pageUrl) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'))
  url.searchParams.set('pageUrl', pageUrl)
  url.searchParams.set('size', '64')
  return iconDataUrl(url.href)
}

/** An icon as a png (Chrome's favicons can be bmp; sites' can be ico or svg); svg is kept as is. */
async function iconDataUrl(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const blob = await res.blob()
    if (blob.type === 'image/svg+xml') return blobToDataUrl(blob)
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }))
  } catch {
    return undefined
  }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`
}

// ── run in the page (self-contained: injected with chrome.scripting) ───────

/**
 * Finds the post (new Reddit's <shreddit-post>, old Reddit's .thing), reads what the page shows about it, and gets
 * the page ready to be scrolled through: smooth scrolling off, and fixed and sticky bars (the header) hidden, so they
 * don't cover the post in every screen.
 */
function preparePost() {
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v))
  let el = document.querySelector('shreddit-post')
  let post
  let icon
  if (el) {
    const created = Date.parse(el.getAttribute('created-timestamp') ?? '')
    post = {
      title: el.getAttribute('post-title') ?? undefined,
      subreddit: el.getAttribute('subreddit-prefixed-name') ?? undefined,
      author: el.getAttribute('author') ?? undefined,
      score: num(el.getAttribute('score')),
      comments: num(el.getAttribute('comment-count')),
      postedAt: Number.isNaN(created) ? undefined : created,
    }
    const img = el.querySelector('img[src*="communityIcon"], img[src*="redditmedia.com"][class*="icon"], [slot="credit-bar"] img, faceplate-img[src*="redditmedia"]')
    icon = img?.getAttribute('src') ?? document.querySelector('shreddit-subreddit-header')?.getAttribute('icon') ?? undefined
  } else {
    el = document.querySelector('#siteTable > .thing.link, .sitetable .thing.link')
    if (!el) return null
    post = {
      title: el.querySelector('a.title')?.textContent?.trim(),
      subreddit: el.dataset.subredditPrefixed ?? (el.dataset.subreddit ? `r/${el.dataset.subreddit}` : undefined),
      author: el.dataset.author,
      score: num(el.dataset.score),
      comments: num(el.dataset.commentsCount),
      postedAt: num(el.dataset.timestamp),
    }
    // Old Reddit puts the post's text and media in the expando; the .thing covers it.
    icon = undefined
  }
  if (icon && !/^https:/.test(icon)) icon = undefined

  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important')
  for (const node of document.querySelectorAll('body *')) {
    if (el.contains(node) || node.contains(el)) continue
    const pos = getComputedStyle(node).position
    if (pos !== 'fixed' && pos !== 'sticky') continue
    node.dataset.logcadenceHidden = node.style.visibility
    node.style.setProperty('visibility', 'hidden', 'important')
  }
  const r = el.getBoundingClientRect()
  return {
    post: Object.fromEntries(Object.entries(post).filter(([, v]) => v !== undefined)),
    icon,
    rect: { left: r.left + scrollX, top: r.top + scrollY, width: r.width, bottom: r.bottom + scrollY },
    // The screenshot's width includes the scrollbar, as innerWidth does.
    vw: innerWidth,
    vh: innerHeight,
    scrollX,
    scrollY,
  }
}

/**
 * A Marketplace listing's title, price, condition, location, seller and when it was listed, read from its text:
 * Facebook's markup has no stable names, so this goes by what the page says ("Listed 3 weeks ago in Halifax, NS",
 * "Condition" then "Used - Good"). What it can't find is left out (and can be filled in, in the app).
 */
function readListing() {
  const main = document.querySelector('[role="dialog"] [role="main"], [role="main"]') ?? document.body
  const lines = (main.innerText ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const title = main.querySelector('h1')?.innerText?.trim() || document.querySelector('meta[property="og:title"]')?.content?.trim() || undefined
  const at = title ? lines.indexOf(title) : -1
  // Right below the title: "CA$4,500", "€250", "1 200 zł", "Free" (two prices when it was reduced).
  const price = at < 0 ? undefined : lines.slice(at + 1, at + 4).find((l) => l.length < 40 && /^(free\b|[^\d\s]{0,4}\s?\d)/i.test(l) && !/^listed\b/i.test(l))
  const listed = lines.map((l) => l.match(/^Listed (.+?) in (.+)$/i) ?? l.match(/^Listed (.+? ago)$/i)).find(Boolean)
  const UNITS = { minute: 6e4, hour: 36e5, day: 864e5, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 }
  const ago = listed?.[1].match(/\b(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\b/i)
  const publishedAt = ago ? Date.now() - (/^\d/.test(ago[1]) ? Number(ago[1]) : 1) * UNITS[ago[2].toLowerCase()] : undefined
  const after = (label) => {
    const i = lines.findIndex((l) => l.toLowerCase() === label)
    return i >= 0 ? lines[i + 1] : undefined
  }
  const seller = [...main.querySelectorAll('a[href*="/marketplace/profile/"]')].map((a) => a.innerText.trim()).find((t) => t && t.length < 80 && !/seller details|see more/i.test(t))
  const fields = { price, condition: after('condition'), location: listed?.[2], seller }
  return {
    title,
    fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v)),
    publishedAt,
  }
}

/** Scrolls to `y` and says where it got to (less, at the end of the page). */
function scrollToY(y) {
  window.scrollTo(scrollX, y)
  return scrollY
}

function restorePage(y) {
  for (const node of document.querySelectorAll('[data-logcadence-hidden]')) {
    node.style.visibility = node.dataset.logcadenceHidden
    delete node.dataset.logcadenceHidden
  }
  window.scrollTo(scrollX, y)
  document.documentElement.style.removeProperty('scroll-behavior')
}

// ── wiring ─────────────────────────────────────────────────────────────────

// SEO Dashboard answers with kind 'video'; Logcadence with the capture's handler.
const PLACE = { reddit: 'Bookmarks (Reddit)', marketplace: 'Bookmarks (Marketplace)' }
const describe = (r) => `${r.comment ? 'Comment added to' : r.created ? 'Saved to' : 'Updated in'} ${r.kind === 'video' ? 'SEO Dashboard' : (PLACE[r.handler] ?? 'Bookmarks')}`

// The popup asks for a capture; it runs here, so it finishes even if the popup closes.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'capture') {
    chrome.tabs.get(msg.tabId).then((tab) => capture(tab, msg.target)).then(
      (r) => reply({ ok: true, message: describe(r), result: r }),
      (err) => reply({ ok: false, message: err.message }),
    )
    return true
  }
  if (msg?.type === 'ping') {
    ping(msg.url).then(reply)
    return true
  }
})

// Alt+Shift+D: a video to SEO Dashboard, anything else to Bookmarks (as its handler captures it); the result shows on the toolbar icon.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'capture-now' || !tab) return
  const badge = (text, color, title) => {
    chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id })
    chrome.action.setBadgeText({ text, tabId: tab.id })
    chrome.action.setTitle({ title, tabId: tab.id })
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 4000)
  }
  badge('…', '#888', 'Capturing…')
  try {
    badge('✓', '#2e9d58', describe(await capture(tab, 'bookmark')))
  } catch (err) {
    badge('!', '#d33', err.message)
  }
})
