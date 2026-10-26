import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import { HANDLERS, handlerById, type CaptureHandler } from '../../../shared/handlers.ts'
import { allTagPaths, isUnder } from '../../../shared/tags.ts'
import type { CaptureDTO, CaptureLibraryDTO, CaptureSection, CaptureSummary, HandlerId, UpdateCaptureBody } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { bookmarksNav as nav, type CaptureAnchor, type CaptureFilter } from '../../state/captures.ts'
import { useFollowJournal } from '../../state/canvasDay.ts'
import { useCommand } from '../../state/commands.ts'
import { openDate, panesStore } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import { TagInput } from '../TagInput/TagInput.tsx'
import { ArrowIcon, dayLabel, scrollParent, SearchIcon, TextSection } from '../Youtube/Youtube.tsx'
import yt from '../Youtube/Youtube.module.css'
import styles from './Captures.module.css'

// Canvas "Bookmarks" tab: pages captured by the Chrome extension (extension/), listed like the YouTube tab (grouped
// by the day they were captured), and a page per capture with its screenshot, tags and notes. What's special about
// some sites comes from the capture's handler (shared/handlers.ts): a Reddit post's subreddit, score and comments, a
// Marketplace listing's price and seller. The Handlers view lists them. The look is the YouTube tab's.

const PAGE = 48
// How often an open tab checks for captures sent by the extension.
const POLL_MS = 3000
const fail = (err: Error) => notify(err.message)

export const Bookmarks = (_: CanvasPluginProps) => <CapturesTab />

function useLibrary() {
  const rev = useStore(nav.revision, (n) => n)
  return useFetch<CaptureLibraryDTO>(`caplib|${rev}`, (signal) => unwrap(api.captures.library.$get({}, { init: { signal } })))
}

/** Reloads the tab when the extension sends a capture: checked every few seconds, and when the window gets focus. */
function useCaptureUpdates() {
  useEffect(() => {
    let last: string | undefined
    const check = () => {
      if (document.visibilityState !== 'visible') return
      unwrap(api.captures.revision.$get()).then(({ revision }) => {
        if (last !== undefined && revision !== last) nav.bump()
        last = revision
      }, () => {})
    }
    check()
    const t = setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', check)
    }
  }, [])
}

/** One search word: "@name" matches the site (host, subreddit, location) or a person (author, seller); others the title, site, url or tags. */
function matchesWord(c: CaptureSummary, w: string): boolean {
  if (w.startsWith('@')) {
    const q = w.slice(1).replace(/^[ru]\//, '')
    const people = handlerById(c.handler).fields.filter((f) => f.person)
    return !q || c.site.toLowerCase().includes(q) || people.some((f) => String(c.fields[f.key] ?? '').toLowerCase().includes(q))
  }
  const tag = w.replace(/^#/, '')
  return c.title.toLowerCase().includes(w) || c.site.toLowerCase().includes(w) || c.url.toLowerCase().includes(w) || c.tags.some((t) => t.includes(tag))
}

function useShown(lib: CaptureLibraryDTO | undefined, filter: CaptureFilter, handler: HandlerId | null, query: string): CaptureSummary[] {
  return useMemo(() => {
    let list = lib?.items ?? []
    if (handler) list = list.filter((c) => c.handler === handler)
    if (filter?.kind === 'tag') list = list.filter((c) => c.tags.some((t) => isUnder(t, filter.path)))
    else if (filter?.kind === 'untagged') list = list.filter((c) => !c.tags.length)
    else if (filter?.kind === 'site') list = list.filter((c) => c.site === filter.site)
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length) list = list.filter((c) => words.every((w) => matchesWord(c, w)))
    return list
  }, [lib, filter, handler, query])
}

function CapturesTab() {
  const itemId = useStore(nav.store, (s) => s.itemId)
  const handlers = useStore(nav.store, (s) => s.handlers)
  useCommand('canvas.back', () => nav.go(-1))
  useCommand('canvas.forward', () => nav.go(1))
  useCaptureUpdates()
  // Following the journal's day (ctrl+l): the listing scrolls to it, leaving an open capture alone.
  useFollowJournal((d) => nav.store.get().itemId === null && nav.jumpToDate(d), { key: nav.plugin })
  const lib = useLibrary()
  const top = useRef<HTMLElement>(null)
  return (
    <div className={yt.frame}>
      <TopBar ref={top} />
      {itemId ? (
        <ItemPage key={itemId} id={itemId} lib={lib.data} />
      ) : handlers ? (
        <HandlersView lib={lib.data} />
      ) : (
        <Listing top={top} lib={lib.data} loading={lib.loading} error={lib.error} />
      )}
    </div>
  )
}

// ── listing ────────────────────────────────────────────────────────────────

interface ListingProps {
  top: RefObject<HTMLElement | null>
  lib: CaptureLibraryDTO | undefined
  loading: boolean
  error: Error | undefined
}

function Listing({ top, lib, loading, error }: ListingProps) {
  const filter = useStore(nav.store, (s) => s.filter)
  const handler = useStore(nav.store, (s) => s.handler)
  const query = useStore(nav.store, (s) => s.query)
  const seq = useStore(nav.store, (s) => s.seq)
  const shown = useShown(lib, filter, handler, query)
  const [limit, setLimit] = useState(PAGE)
  const more = useRef<HTMLDivElement>(null)
  const listed = useRef({ filter, handler, query })
  useEffect(() => {
    const l = listed.current
    if (l.filter === filter && l.handler === handler && l.query === query) return
    listed.current = { filter, handler, query }
    setLimit(PAGE)
  }, [filter, handler, query])

  // Each history step (and each mount) scrolls to its step's anchor, once the cards up to it are rendered.
  const restored = useRef(-1)
  useLayoutEffect(() => {
    if (restored.current === seq || !lib || !top.current) return
    const s = nav.store.get()
    const anchor = s.history[s.hIndex]?.anchor ?? null
    const need = limitFor(shown, anchor)
    if (need > limit) return setLimit(need)
    scrollTo(top.current, anchor)
    restored.current = seq
  }, [seq, lib, shown, limit])

  // Reports where the listing is scrolled: on each step away from it, and (debounced) as it scrolls.
  useLayoutEffect(() => {
    const header = top.current
    const scroller = header && scrollParent(header)
    if (!header || !scroller) return
    nav.registerAnchorCapture(() => (restored.current === nav.store.get().seq ? anchorOf(header, scroller) : undefined))
    let t: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      clearTimeout(t)
      t = setTimeout(nav.saveAnchor, 300)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(t)
      scroller.removeEventListener('scroll', onScroll)
      nav.saveAnchor()
      nav.registerAnchorCapture(null)
    }
  }, [])

  useEffect(() => {
    const el = more.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setLimit((n) => n + PAGE), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown, limit])

  const days = useMemo(() => {
    const out: { date: string; items: CaptureSummary[] }[] = []
    for (const c of shown.slice(0, limit)) {
      const last = out.at(-1)
      if (last?.date === c.capturedDate) last.items.push(c)
      else out.push({ date: c.capturedDate, items: [c] })
    }
    return out
  }, [shown, limit])
  const perDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of shown) m.set(c.capturedDate, (m.get(c.capturedDate) ?? 0) + 1)
    return m
  }, [shown])

  return (
    <>
      {lib && lib.items.length > 0 && <Chips lib={lib} filter={filter} handler={handler} />}
      {filter?.kind === 'tag' && lib && <TagActions path={filter.path} count={shown.length} />}
      {filter?.kind === 'site' && lib && <SiteBar site={filter.site} lib={lib} count={shown.length} />}
      {error && !lib ? (
        <p className={yt.empty}>{error.message}</p>
      ) : !lib ? (
        loading && <div className={yt.loading} />
      ) : !lib.items.length ? (
        <div className={yt.empty}>
          <p>
            No bookmarks yet. Capture a page with the Logcadence Chrome extension (in the repo’s <code>extension/</code> folder): its toolbar button, or Alt+Shift+S. Some
            sites get more than a screenshot:{' '}
            <button className={yt.link} onClick={() => nav.showHandlers(true)}>
              see the handlers
            </button>
            .
          </p>
        </div>
      ) : !shown.length ? (
        <p className={yt.empty}>No bookmarks match.</p>
      ) : (
        <>
          {days.map((d) => (
            <section key={d.date} className={yt.day} data-day={d.date}>
              <h3 className={yt.dayTitle}>
                <button onClick={(e) => openDate(d.date, { newTab: e.ctrlKey || e.metaKey })} title="Open this day in the journal">
                  {dayLabel(d.date)}
                </button>
                <span>{perDay.get(d.date)} captured</span>
              </h3>
              <div className={yt.grid}>
                {d.items.map((c) => (
                  <Card key={c.id} c={c} />
                ))}
              </div>
            </section>
          ))}
          {limit < shown.length && <div ref={more} className={yt.more} />}
        </>
      )}
    </>
  )
}

/** How many cards must be rendered for an anchor's place to exist, with a page below it to scroll into. */
function limitFor(shown: CaptureSummary[], anchor: CaptureAnchor): number {
  if (!anchor) return PAGE
  const i = 'item' in anchor ? shown.findIndex((c) => c.id === anchor.item) : shown.findIndex((c) => c.capturedDate < anchor.date)
  if (i < 0) return 'item' in anchor ? PAGE : shown.length
  return i + PAGE
}

// Positions are measured from the bottom of the sticky top bar: what's under it is what's in view.
const lineOf = (header: HTMLElement, scroller: HTMLElement) => scroller.getBoundingClientRect().top + header.offsetHeight
const daysUnder = (header: HTMLElement) => [...(header.parentElement?.querySelectorAll<HTMLElement>('[data-day]') ?? [])]

function anchorOf(header: HTMLElement, scroller: HTMLElement): CaptureAnchor {
  if (scroller.scrollTop <= 0) return null
  const line = lineOf(header, scroller)
  const day = daysUnder(header).findLast((d) => d.getBoundingClientRect().top <= line + 1)
  return day ? { date: day.dataset.day!, offset: Math.round(line - day.getBoundingClientRect().top) } : null
}

function scrollTo(header: HTMLElement, anchor: CaptureAnchor) {
  const scroller = scrollParent(header)
  if (!scroller) return
  if (!anchor) {
    scroller.scrollTop = 0
  } else if ('item' in anchor) {
    header.parentElement?.querySelector(`[data-capture="${CSS.escape(anchor.item)}"]`)?.scrollIntoView({ block: 'center' })
  } else {
    const days = daysUnder(header)
    const day = days.find((d) => d.dataset.day! <= anchor.date) ?? days.at(-1)
    if (!day) return
    const offset = day.dataset.day === anchor.date ? anchor.offset : 0
    scroller.scrollTop += day.getBoundingClientRect().top - lineOf(header, scroller) + offset
  }
}

function TopBar({ ref }: { ref: Ref<HTMLElement> }) {
  const handlers = useStore(nav.store, (s) => s.handlers)
  const query = useStore(nav.store, (s) => s.query)
  const canBack = useStore(nav.store, (s) => s.hIndex > 0)
  const canForward = useStore(nav.store, (s) => s.hIndex < s.history.length - 1)
  return (
    <header ref={ref} className={yt.top}>
      <button className={yt.brand} onClick={nav.home} title="Back to the top (Alt+← returns)">
        <BookmarkLogo />
        <span>Bookmarks</span>
      </button>
      <div className={yt.search}>
        <input value={query} placeholder="Search (@site, @author, @seller)" spellCheck={false} onChange={(e) => nav.setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && nav.setQuery('')} />
        {query && (
          <button className={yt.clear} title="Clear" onClick={() => nav.setQuery('')}>
            ×
          </button>
        )}
        <span className={yt.searchIcon} aria-hidden>
          <SearchIcon />
        </span>
      </div>
      <div className={yt.actions}>
        <button className={`${styles.handlersButton} ${handlers ? styles.handlersOn : ''}`} onClick={() => nav.showHandlers(!handlers)} title="What’s special about captures from Reddit, Facebook Marketplace…">
          Handlers
        </button>
        <button className={yt.iconButton} disabled={!canBack} onClick={() => nav.go(-1)} title="Back (Alt+←)">
          <ArrowIcon dir={-1} />
        </button>
        <button className={yt.iconButton} disabled={!canForward} onClick={() => nav.go(1)} title="Forward (Alt+→)">
          <ArrowIcon dir={1} />
        </button>
      </div>
    </header>
  )
}

/** Each handler with captures (when there's more than one), then the tags. */
function Chips({ lib, filter, handler }: { lib: CaptureLibraryDTO; filter: CaptureFilter; handler: HandlerId | null }) {
  const counts = useMemo(() => handlerCounts(lib), [lib])
  const used = HANDLERS.filter((h) => counts.get(h.id))
  const is = (f: NonNullable<CaptureFilter>) => JSON.stringify(f) === JSON.stringify(filter)
  const chip = (f: NonNullable<CaptureFilter>, label: string, title: string, cls = '') => (
    <button key={JSON.stringify(f)} className={`${yt.chip} ${cls} ${is(f) ? yt.chipOn : ''}`} title={title} onClick={() => nav.setFilter(is(f) ? null : f)}>
      {label}
    </button>
  )
  return (
    <nav className={yt.chips}>
      {(used.length > 1 || handler) &&
        used.map((h) => (
          <button key={h.id} className={`${yt.chip} ${styles.handlerChip} ${handler === h.id ? yt.chipOn : ''}`} title={`Only ${h.many} (${counts.get(h.id)})`} onClick={() => nav.setHandler(handler === h.id ? null : h.id)}>
            <HandlerMark id={h.id} />
            {h.id === 'page' ? 'Web pages' : h.name}
          </button>
        ))}
      {(used.length > 1 || handler) && <span className={styles.chipGap} />}
      {chip({ kind: 'untagged' }, 'untagged', 'Bookmarks without tags')}
      {lib.tags.filter((t) => t.active > 0).map((t) => chip({ kind: 'tag', path: t.path }, `#${t.path}`, `${t.active} tagged (with the tags under it, when filtering)`, yt.tagChip))}
    </nav>
  )
}

/** The site (subreddit, location) filter: its icon and name, and a way out. */
function SiteBar({ site, lib, count }: { site: string; lib: CaptureLibraryDTO; count: number }) {
  const c = lib.items.find((x) => x.site === site)
  const h = handlerById(c?.handler ?? 'page')
  const link = c && h.siteLink(site, c.url)
  return (
    <div className={yt.channelBar}>
      {c && <SiteIcon c={c} large />}
      <div>
        <div className={yt.channelName}>{site}</div>
        <div className={yt.meta}>
          {count} {count === 1 ? h.one : h.many}
        </div>
      </div>
      {link && (
        <a className={yt.watch} href={link} target="_blank" rel="noreferrer">
          {h.siteLabel[0]!.toUpperCase() + h.siteLabel.slice(1)} ↗
        </a>
      )}
      <button className={yt.clearFilter} onClick={() => nav.setFilter(null)} title={`Show every ${h.siteLabel}`}>
        ×
      </button>
    </div>
  )
}

function TagActions({ path, count }: { path: string; count: number }) {
  const rename = () => {
    const to = prompt(`Rename #${path} (and the tags under it) to:`, path)
    if (!to || to === path) return
    unwrap(api.captures.tags.move.$post({ json: { from: path, to } })).then(() => {
      nav.setFilter({ kind: 'tag', path: to.trim().toLowerCase() })
      nav.bump()
    }, fail)
  }
  const remove = () => {
    if (!confirm(`Remove #${path} and the tags under it from every bookmark? The bookmarks stay.`)) return
    unwrap(api.captures.tags.delete.$post({ json: { path } })).then(() => {
      nav.setFilter(null)
      nav.bump()
    }, fail)
  }
  return (
    <div className={yt.tagBar}>
      <span className={yt.tagName}>#{path}</span>
      <span className={yt.muted}>
        {count} {count === 1 ? 'bookmark' : 'bookmarks'}
      </span>
      <button onClick={rename}>Rename / merge</button>
      <button onClick={remove}>Delete tag</button>
    </div>
  )
}

/** A click opens the capture's page; ctrl+click opens the page itself in the browser. */
function Card({ c }: { c: CaptureSummary }) {
  const h = handlerById(c.handler)
  return (
    <article
      className={yt.card}
      data-capture={c.id}
      title={`${c.title}\n${c.url}\n(Ctrl+click opens the page)`}
      onClick={(e) => (e.ctrlKey || e.metaKey ? window.open(c.url, '_blank', 'noreferrer') : nav.open(c.id))}
    >
      <div className={`${yt.thumb} ${styles.shotThumb}`} style={{ aspectRatio: h.thumbRatio }}>
        <img src={c.thumbUrl ?? c.screenshotUrl} alt="" loading="lazy" decoding="async" draggable={false} />
        {(c.hasNotes || c.hasComments) && (
          <span className={`${yt.noteBadge} ${styles.badge}`} title={[c.hasNotes && 'Has notes', c.hasComments && 'Has comments'].filter(Boolean).join(', ')}>
            {c.hasNotes && '✎'}
            {c.hasComments && <CommentIcon />}
          </span>
        )}
      </div>
      <div className={yt.details}>
        <SiteIcon c={c} onClick={() => nav.setFilter({ kind: 'site', site: c.site })} />
        <div className={yt.text}>
          <h4 className={yt.title}>{c.title}</h4>
          <div className={`${yt.meta} ${styles.byline}`}>
            {c.handler !== 'page' && <HandlerMark id={c.handler} />}
            <span>{[c.site, h.byline(c)].filter(Boolean).join(' • ')}</span>
          </div>
          <div className={yt.meta}>{h.meta(c)}</div>
          {c.tags.length > 0 && (
            <div className={yt.cardTags}>
              {c.tags.map((t) => (
                <button
                  key={t}
                  onClick={(e) => {
                    e.stopPropagation()
                    nav.setFilter({ kind: 'tag', path: t })
                  }}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/** The favicon or subreddit icon (a letter without one); with onClick, a button that filters by the site. */
function SiteIcon({ c, large, onClick }: { c: CaptureSummary; large?: boolean; onClick?: () => void }) {
  const [broken, setBroken] = useState(false)
  const cls = `${yt.avatar} ${styles.siteIcon} ${large ? yt.avatarLarge : ''}`
  const letter = (c.site.replace(/^r\//, '') || '?').slice(0, 1).toUpperCase()
  const icon = !c.iconUrl || broken ? <span className={`${cls} ${yt.avatarLetter}`}>{letter}</span> : <img className={cls} src={c.iconUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
  if (!onClick) return icon
  return (
    <button
      className={yt.avatarButton}
      title={`Everything from ${c.site}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {icon}
    </button>
  )
}

// ── a capture's page ───────────────────────────────────────────────────────

const fullDate = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

const imageOps = (id: string, section: CaptureSection) => ({
  upload: (file: File) => unwrap(api.captures.items[':id'].images[':section'].$post({ param: { id, section }, form: { file } })),
  deleteImage: (imageId: string) => unwrap(api.captures.images[':id'].$delete({ param: { id: imageId } })),
  reorder: (ids: string[]) => unwrap(api.captures.items[':id'].images[':section'].order.$post({ param: { id, section }, json: { ids } })),
})

function ItemPage({ id, lib }: { id: string; lib: CaptureLibraryDTO | undefined }) {
  const [bump, setBump] = useState(0)
  // A capture sent again (or a comment screenshot) bumps the tab's revision: reload the page too.
  const rev = useStore(nav.revision, (n) => n)
  const { data, error } = useFetch<CaptureDTO>(`cap|${id}|${bump}|${rev}`, (signal) => unwrap(api.captures.items[':id'].$get({ param: { id } }, { init: { signal } })))
  const [patched, setPatched] = useState<CaptureDTO | null>(null)
  useEffect(() => setPatched(null), [data])
  const c = patched ?? data
  const filter = useStore(nav.store, (s) => s.filter)
  const handlerFilter = useStore(nav.store, (s) => s.handler)
  const query = useStore(nav.store, (s) => s.query)
  const list = useShown(lib, filter, handlerFilter, query)
  const i = list.findIndex((x) => x.id === id)
  const prev = i > 0 ? list[i - 1] : undefined
  const next = i >= 0 ? list[i + 1] : undefined
  const tagPaths = useMemo(() => allTagPaths(lib?.tags ?? []), [lib])
  const pageRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroller = pageRef.current && scrollParent(pageRef.current)
    if (scroller) scroller.scrollTop = 0
  }, [])

  // Esc goes back to the listing (when not typing, and the canvas has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Escape' || e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable]') || panesStore.get().focus !== 'canvas') return
      nav.backToListing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const h = handlerById(c?.handler ?? 'page')
  const save = (body: UpdateCaptureBody) =>
    unwrap(api.captures.items[':id'].$patch({ param: { id }, json: body })).then((r) => {
      setPatched(r)
      nav.bump()
    }, fail)
  const refresh = () => {
    setBump((b) => b + 1)
    nav.bump()
  }
  const remove = () => {
    if (!c || !confirm(`Delete “${c.title}”, with its screenshot, notes${h.sections.includes('comments') ? ', comments' : ''} and tags?`)) return
    unwrap(api.captures.items[':id'].$delete({ param: { id } })).then(() => {
      nav.backToListing()
      nav.bump()
    }, fail)
  }

  return (
    <div ref={pageRef} className={yt.page}>
      <nav className={yt.pageNav}>
        <button onClick={nav.backToListing} title="Back to the bookmarks, where you were (Esc)">
          ← Bookmarks
        </button>
        <span className={yt.push} />
        <button disabled={!prev} onClick={() => prev && nav.open(prev.id)} title={prev?.title}>
          ‹ Previous
        </button>
        <button disabled={!next} onClick={() => next && nav.open(next.id)} title={next?.title}>
          Next ›
        </button>
      </nav>
      {!c ? (
        error ? <p className={yt.empty}>{error.message}</p> : <div className={yt.loading} />
      ) : (
        <>
          <h1 className={yt.pageTitle}>{c.title}</h1>
          <div className={yt.owner}>
            <SiteIcon c={c} large onClick={() => nav.setFilter({ kind: 'site', site: c.site })} />
            <div className={styles.ownerText}>
              <span className={yt.channel}>{c.site}</span>
              <div className={yt.meta}>{c.handler === 'page' ? <span className={styles.url}>{c.url}</span> : [h.byline(c), h.meta(c)].filter(Boolean).join(' • ')}</div>
            </div>
            <a className={yt.watch} href={c.url} target="_blank" rel="noreferrer">
              {h.openLabel} ↗
            </a>
          </div>

          <a className={styles.shot} href={c.screenshotUrl} target="_blank" rel="noreferrer" title="Open the screenshot full size">
            <img src={c.screenshotUrl} alt="" width={c.width ?? undefined} height={c.height ?? undefined} />
          </a>

          <section className={yt.infoBox}>
            <div className={yt.infoRow}>
              <span className={yt.label}>Captured</span>
              <button className={yt.link} onClick={(e) => openDate(c.capturedDate, { newTab: e.ctrlKey || e.metaKey })} title="Open this day in the journal">
                {formatJournalDate(c.capturedDate)}
              </button>
              <span className={yt.muted}>{fullDate(c.capturedAt)}</span>
            </div>
            {h.published && c.publishedAt !== null && (
              <div className={yt.infoRow}>
                <span className={yt.label}>{h.published}</span>
                <span>{fullDate(c.publishedAt)}</span>
              </div>
            )}
            {h.id !== 'page' && (
              <div className={yt.infoRow}>
                <span className={yt.label}>Handler</span>
                <button className={`${yt.link} ${styles.byline}`} onClick={() => nav.showHandlers(true)} title="What the handler does">
                  <HandlerMark id={h.id} />
                  {h.name}
                </button>
              </div>
            )}
            {h.fields.map((f) => (
              <div key={f.key} className={yt.infoRow}>
                <span className={yt.label}>{f.label}</span>
                <FieldInput
                  key={`${f.key}|${c.fields[f.key] ?? ''}`}
                  value={c.fields[f.key]}
                  numeric={f.type === 'number'}
                  onSave={(v) => {
                    const { [f.key]: _, ...rest } = c.fields
                    save({ fields: v === '' ? rest : { ...rest, [f.key]: v } })
                  }}
                />
              </div>
            ))}
            <div className={yt.infoRow}>
              <span className={yt.label}>Tags</span>
              <TagInput className={yt.tags} value={c.tags} paths={tagPaths} onChange={(tags) => save({ tags })} onOpen={(path) => nav.setFilter({ kind: 'tag', path })} placeholder="add tag… (e.g. homelab:nas)" />
            </div>
          </section>

          <TextSection
            key={`notes|${c.id}`}
            title="Notes"
            {...imageOps(c.id, 'notes')}
            text={c.notes}
            images={c.images}
            activeId={c.activeImageId}
            empty="Click to write notes… paste or drop images, gifs and videos."
            onSave={(notes) => save({ notes })}
            onActivate={(activeImageId) => save({ activeImageId })}
            onImages={refresh}
          />
          {h.sections.includes('comments') && (
            <TextSection
              key={`comments|${c.id}`}
              title="Comments"
              {...imageOps(c.id, 'comments')}
              text={c.comments}
              images={c.commentImages}
              activeId={c.commentsActiveImageId}
              empty={`Click to keep comments… paste or drop screenshots, or use “Add as comment” in the extension on the ${h.one}.`}
              onSave={(comments) => save({ comments })}
              onActivate={(commentsActiveImageId) => save({ commentsActiveImageId })}
              onImages={refresh}
            />
          )}

          <footer className={yt.pageFooter}>
            <span />
            <button className={yt.link} onClick={remove}>
              Delete {h.one}
            </button>
          </footer>
        </>
      )}
    </div>
  )
}

/** A field the handler read from the page, editable: saved on Enter or when left (empty removes it). */
function FieldInput({ value, numeric, onSave }: { value: string | number | undefined; numeric: boolean; onSave: (v: string) => void }) {
  const initial = value === undefined ? '' : String(value)
  const [v, setV] = useState(initial)
  return (
    <input
      className={styles.fieldInput}
      value={v}
      inputMode={numeric ? 'numeric' : undefined}
      placeholder="—"
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== initial && onSave(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setV(initial)
      }}
    />
  )
}

// ── handlers ───────────────────────────────────────────────────────────────

function handlerCounts(lib: CaptureLibraryDTO): Map<HandlerId, number> {
  const m = new Map<HandlerId, number>()
  for (const c of lib.items) m.set(c.handler, (m.get(c.handler) ?? 0) + 1)
  return m
}

const reads = (h: CaptureHandler) => [...h.fields.map((f) => f.label.toLowerCase()), h.published && `when ${h.published.toLowerCase()}`].filter(Boolean).join(', ')

/** What each handler does: the sites it claims, how they're captured, what's read from them. */
function HandlersView({ lib }: { lib: CaptureLibraryDTO | undefined }) {
  const counts = useMemo(() => (lib ? handlerCounts(lib) : new Map<HandlerId, number>()), [lib])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Escape' || e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable]') || panesStore.get().focus !== 'canvas') return
      nav.showHandlers(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={yt.page}>
      <nav className={yt.pageNav}>
        <button onClick={() => nav.showHandlers(false)} title="Back to the bookmarks (Esc)">
          ← Bookmarks
        </button>
      </nav>
      <h1 className={yt.pageTitle}>Handlers</h1>
      <div className={styles.intro}>
        <p>
          Every page captured with the Chrome extension lands in Bookmarks. A <b>handler</b> is what’s special about some sites: when you capture a page, the handler whose site
          matches its url decides how the extension captures it, what it reads from the page, what makes two captures the same page (capturing it again updates the one you
          have, keeping your notes and tags), and how it shows here. A page no handler claims is kept as a plain web page.
        </p>
        <p className={yt.muted}>
          Videos (YouTube, TikTok, Instagram) go to SEO Dashboard instead. Handlers are built into the app (<code>shared/handlers.ts</code>, and{' '}
          <code>extension/common.js</code> for reading the page): another site gets one in code.
        </p>
      </div>
      {HANDLERS.map((h) => {
        const n = counts.get(h.id) ?? 0
        return (
          <section key={h.id} className={styles.handler}>
            <header>
              <HandlerMark id={h.id} large />
              <div>
                <h2>{h.name}</h2>
                <div className={yt.muted}>{h.domains.join(' · ')}</div>
              </div>
              <button className={yt.watch} disabled={!n} onClick={() => nav.setHandler(h.id)} title={n ? `Show only ${h.many}` : `No ${h.many} yet`}>
                {n} {n === 1 ? h.one : h.many} →
              </button>
            </header>
            <p>{h.about}</p>
            <dl>
              <dt>Captures</dt>
              <dd>{h.capture}</dd>
              {reads(h) && (
                <>
                  <dt>Reads</dt>
                  <dd>{reads(h)} (editable on its page)</dd>
                </>
              )}
              <dt>Grouped by</dt>
              <dd>{h.siteLabel}</dd>
              <dt>Keeps</dt>
              <dd>{h.sections.join(' and ')}, tags</dd>
            </dl>
          </section>
        )
      })}
    </div>
  )
}

/** A handler's logo: Reddit's, Marketplace's, a globe for any page. */
function HandlerMark({ id, large }: { id: HandlerId; large?: boolean }) {
  const size = large ? 28 : 14
  if (id === 'reddit') return <RedditLogo size={size} />
  if (id === 'marketplace') return <MarketplaceLogo size={size} />
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" />
    </svg>
  )
}

// ── icons ──────────────────────────────────────────────────────────────────

function RedditLogo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#ff4500" />
      <ellipse cx="12" cy="14" rx="6.2" ry="4.3" fill="#fff" />
      <circle cx="17.6" cy="10.2" r="1.5" fill="#fff" />
      <circle cx="6.4" cy="10.2" r="1.5" fill="#fff" />
      <circle cx="16" cy="5.6" r="1.3" fill="#fff" />
      <path d="M12 9.7 13 5.2l3 .4" stroke="#fff" strokeWidth="1" fill="none" />
      <circle cx="9.8" cy="13.4" r="1" fill="#ff4500" />
      <circle cx="14.2" cy="13.4" r="1" fill="#ff4500" />
    </svg>
  )
}

function MarketplaceLogo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <rect width="24" height="24" rx="6" fill="#0866ff" />
      <path d="M5.5 10.5 7 6h10l1.5 4.5a2.2 2.2 0 0 1-4.3.6 2.2 2.2 0 0 1-4.4 0 2.2 2.2 0 0 1-4.3-.6z" fill="#fff" />
      <path d="M7 13v5h10v-5" stroke="#fff" strokeWidth="1.6" fill="none" />
    </svg>
  )
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  )
}

function BookmarkLogo() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" fill="var(--accent)" />
    </svg>
  )
}
