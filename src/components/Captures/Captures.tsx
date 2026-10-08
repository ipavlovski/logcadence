import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import { allTagPaths, isUnder } from '../../../shared/tags.ts'
import type { CaptureDTO, CaptureLibraryDTO, CaptureSection, CaptureSummary, UpdateCaptureBody } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { bookmarksNav, redditNav, type CaptureAnchor, type CaptureFilter, type CaptureNav } from '../../state/captures.ts'
import { useFollowJournal } from '../../state/canvasDay.ts'
import { useCommand } from '../../state/commands.ts'
import { openDate, panesStore } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import { TagInput } from '../TagInput/TagInput.tsx'
import { ArrowIcon, dayLabel, scrollParent, SearchIcon, TextSection } from '../Youtube/Youtube.tsx'
import yt from '../Youtube/Youtube.module.css'
import styles from './Captures.module.css'

// Canvas "Reddit" and "Bookmarks" tabs: pages captured by the Chrome extension (extension/), listed like the
// YouTube tab (grouped by the day they were captured), and a page per capture with its screenshot, tags and notes
// (and for Reddit posts, comments). Both are this component with a different config; the look is the YouTube tab's.

const PAGE = 48
// How often an open tab checks for captures sent by the extension.
const POLL_MS = 3000
const fail = (err: Error) => notify(err.message)

interface Config {
  nav: CaptureNav
  name: string
  /** "post" / "posts", "bookmark" / "bookmarks". */
  one: string
  many: string
  Logo: () => ReactNode
  /** Reddit posts keep comments (screenshots the extension sends, or pasted ones). */
  comments: boolean
  /** "Open on Reddit", "Open page". */
  openLabel: string
}

const REDDIT: Config = { nav: redditNav, name: 'Reddit', one: 'post', many: 'posts', Logo: RedditLogo, comments: true, openLabel: 'Open on Reddit' }
const BOOKMARKS: Config = { nav: bookmarksNav, name: 'Bookmarks', one: 'bookmark', many: 'bookmarks', Logo: BookmarkLogo, comments: false, openLabel: 'Open page' }

export const Reddit = (_: CanvasPluginProps) => <CapturesTab config={REDDIT} />
export const Bookmarks = (_: CanvasPluginProps) => <CapturesTab config={BOOKMARKS} />

function useLibrary(nav: CaptureNav) {
  const rev = useStore(nav.revision, (n) => n)
  return useFetch<CaptureLibraryDTO>(`caplib|${nav.kind}|${rev}`, (signal) => unwrap(api.captures[':kind'].library.$get({ param: { kind: nav.kind } }, { init: { signal } })))
}

/** Reloads the tab when the extension sends a capture: checked every few seconds, and when the window gets focus. */
function useCaptureUpdates(nav: CaptureNav) {
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
  }, [nav])
}

/** One search word: "@name" matches the site (subreddit, host) or the author; others the title, site, url or tags. */
function matchesWord(c: CaptureSummary, w: string): boolean {
  if (w.startsWith('@')) {
    const q = w.slice(1).replace(/^r\//, '')
    return !q || c.site.toLowerCase().includes(q) || !!c.author?.toLowerCase().includes(q)
  }
  const tag = w.replace(/^#/, '')
  return c.title.toLowerCase().includes(w) || c.site.toLowerCase().includes(w) || c.url.toLowerCase().includes(w) || c.tags.some((t) => t.includes(tag))
}

function useShown(lib: CaptureLibraryDTO | undefined, filter: CaptureFilter, query: string): CaptureSummary[] {
  return useMemo(() => {
    let list = lib?.items ?? []
    if (filter?.kind === 'tag') list = list.filter((c) => c.tags.some((t) => isUnder(t, filter.path)))
    else if (filter?.kind === 'untagged') list = list.filter((c) => !c.tags.length)
    else if (filter?.kind === 'site') list = list.filter((c) => c.site === filter.site)
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length) list = list.filter((c) => words.every((w) => matchesWord(c, w)))
    return list
  }, [lib, filter, query])
}

function CapturesTab({ config }: { config: Config }) {
  const { nav } = config
  const itemId = useStore(nav.store, (s) => s.itemId)
  useCommand('canvas.back', () => nav.go(-1))
  useCommand('canvas.forward', () => nav.go(1))
  useCaptureUpdates(nav)
  // Following the journal's day (ctrl+l): the listing scrolls to it, leaving an open capture alone.
  useFollowJournal((d) => nav.store.get().itemId === null && nav.jumpToDate(d), { key: nav.plugin })
  const lib = useLibrary(nav)
  const top = useRef<HTMLElement>(null)
  return (
    <div className={yt.frame}>
      <TopBar ref={top} config={config} />
      {itemId ? <ItemPage key={itemId} id={itemId} config={config} lib={lib.data} /> : <Listing top={top} config={config} lib={lib.data} loading={lib.loading} error={lib.error} />}
    </div>
  )
}

// ── listing ────────────────────────────────────────────────────────────────

interface ListingProps {
  top: RefObject<HTMLElement | null>
  config: Config
  lib: CaptureLibraryDTO | undefined
  loading: boolean
  error: Error | undefined
}

function Listing({ top, config, lib, loading, error }: ListingProps) {
  const { nav } = config
  const filter = useStore(nav.store, (s) => s.filter)
  const query = useStore(nav.store, (s) => s.query)
  const seq = useStore(nav.store, (s) => s.seq)
  const shown = useShown(lib, filter, query)
  const [limit, setLimit] = useState(PAGE)
  const more = useRef<HTMLDivElement>(null)
  const listed = useRef({ filter, query })
  useEffect(() => {
    if (listed.current.filter === filter && listed.current.query === query) return
    listed.current = { filter, query }
    setLimit(PAGE)
  }, [filter, query])

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
  }, [nav])

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
      {lib && lib.items.length > 0 && <Chips nav={nav} lib={lib} filter={filter} many={config.many} />}
      {filter?.kind === 'tag' && lib && <TagActions config={config} path={filter.path} count={shown.length} />}
      {filter?.kind === 'site' && lib && <SiteBar config={config} site={filter.site} lib={lib} count={shown.length} />}
      {error && !lib ? (
        <p className={yt.empty}>{error.message}</p>
      ) : !lib ? (
        loading && <div className={yt.loading} />
      ) : !lib.items.length ? (
        <div className={yt.empty}>
          <p>
            No {config.many} yet. Capture {config.nav.kind === 'reddit' ? 'a Reddit post' : 'a page'} with the Logcadence Chrome extension (in the repo’s <code>extension/</code> folder):
            its toolbar button, or Alt+Shift+S.
          </p>
        </div>
      ) : !shown.length ? (
        <p className={yt.empty}>No {config.many} match.</p>
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
              <div className={`${yt.grid} ${config.nav.kind === 'reddit' ? styles.postGrid : ''}`}>
                {d.items.map((c) => (
                  <Card key={c.id} c={c} config={config} />
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

function TopBar({ ref, config }: { ref: Ref<HTMLElement>; config: Config }) {
  const { nav, Logo } = config
  const query = useStore(nav.store, (s) => s.query)
  const canBack = useStore(nav.store, (s) => s.hIndex > 0)
  const canForward = useStore(nav.store, (s) => s.hIndex < s.history.length - 1)
  return (
    <header ref={ref} className={yt.top}>
      <button className={yt.brand} onClick={nav.home} title="Back to the top (Alt+← returns)">
        <Logo />
        <span>{config.name}</span>
      </button>
      <div className={yt.search}>
        <input value={query} placeholder={config.nav.kind === 'reddit' ? 'Search (@subreddit, @author)' : 'Search (@site)'} spellCheck={false} onChange={(e) => nav.setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && nav.setQuery('')} />
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

function Chips({ nav, lib, filter, many }: { nav: CaptureNav; lib: CaptureLibraryDTO; filter: CaptureFilter; many: string }) {
  const is = (f: NonNullable<CaptureFilter>) => JSON.stringify(f) === JSON.stringify(filter)
  const chip = (f: NonNullable<CaptureFilter>, label: string, title: string, cls = '') => (
    <button key={JSON.stringify(f)} className={`${yt.chip} ${cls} ${is(f) ? yt.chipOn : ''}`} title={title} onClick={() => nav.setFilter(is(f) ? null : f)}>
      {label}
    </button>
  )
  return (
    <nav className={yt.chips}>
      {chip({ kind: 'untagged' }, 'untagged', `${many[0]!.toUpperCase()}${many.slice(1)} without tags`)}
      {lib.tags.filter((t) => t.active > 0).map((t) => chip({ kind: 'tag', path: t.path }, `#${t.path}`, `${t.active} tagged (with the tags under it, when filtering)`, yt.tagChip))}
    </nav>
  )
}

/** The site (subreddit) filter: its icon and name, and a way out. */
function SiteBar({ config, site, lib, count }: { config: Config; site: string; lib: CaptureLibraryDTO; count: number }) {
  const c = lib.items.find((x) => x.site === site)
  const link = config.nav.kind === 'reddit' ? `https://www.reddit.com/${site}/` : c && new URL(c.url).origin
  return (
    <div className={yt.channelBar}>
      {c && <SiteIcon c={c} large />}
      <div>
        <div className={yt.channelName}>{site}</div>
        <div className={yt.meta}>
          {count} {count === 1 ? config.one : config.many}
        </div>
      </div>
      {link && (
        <a className={yt.watch} href={link} target="_blank" rel="noreferrer">
          {config.nav.kind === 'reddit' ? 'Subreddit' : 'Site'} ↗
        </a>
      )}
      <button className={yt.clearFilter} onClick={() => config.nav.setFilter(null)} title={`Show every ${config.nav.kind === 'reddit' ? 'subreddit' : 'site'}`}>
        ×
      </button>
    </div>
  )
}

function TagActions({ config, path, count }: { config: Config; path: string; count: number }) {
  const { nav } = config
  const rename = () => {
    const to = prompt(`Rename #${path} (and the tags under it) to:`, path)
    if (!to || to === path) return
    unwrap(api.captures[':kind'].tags.move.$post({ param: { kind: nav.kind }, json: { from: path, to } })).then(() => {
      nav.setFilter({ kind: 'tag', path: to.trim().toLowerCase() })
      nav.bump()
    }, fail)
  }
  const remove = () => {
    if (!confirm(`Remove #${path} and the tags under it from every ${config.one}? The ${config.many} stay.`)) return
    unwrap(api.captures[':kind'].tags.delete.$post({ param: { kind: nav.kind }, json: { path } })).then(() => {
      nav.setFilter(null)
      nav.bump()
    }, fail)
  }
  return (
    <div className={yt.tagBar}>
      <span className={yt.tagName}>#{path}</span>
      <span className={yt.muted}>
        {count} {config.many}
      </span>
      <button onClick={rename}>Rename / merge</button>
      <button onClick={remove}>Delete tag</button>
    </div>
  )
}

/** A click opens the capture's page; ctrl+click opens the page itself in the browser. */
function Card({ c, config }: { c: CaptureSummary; config: Config }) {
  const { nav } = config
  return (
    <article
      className={yt.card}
      data-capture={c.id}
      title={`${c.title}\n${c.url}\n(Ctrl+click opens the page)`}
      onClick={(e) => (e.ctrlKey || e.metaKey ? window.open(c.url, '_blank', 'noreferrer') : nav.open(c.id))}
    >
      <div className={`${yt.thumb} ${styles.shotThumb}`}>
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
          <div className={yt.meta}>{[c.site, c.author && `u/${c.author}`].filter(Boolean).join(' • ')}</div>
          <div className={yt.meta}>{metaLine(c)}</div>
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

/** "412 points • 87 comments • 3 days ago" for a post; when a bookmark was captured. */
function metaLine(c: CaptureSummary): string {
  if (c.kind === 'bookmark') return new Date(c.capturedAt).toLocaleTimeString([], { timeStyle: 'short' })
  const n = (x: number | null, one: string) => (x === null ? null : `${x.toLocaleString()} ${one}${x === 1 ? '' : 's'}`)
  return [n(c.score, 'point'), n(c.commentCount, 'comment'), c.postedAt && ago(c.postedAt)].filter(Boolean).join(' • ')
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

function ago(at: number): string {
  const ms = Date.now() - at
  const [unit, size] = UNITS.find(([, n]) => ms >= n) ?? UNITS.at(-1)!
  return rtf.format(-Math.max(1, Math.floor(ms / size)), unit)
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

function ItemPage({ id, config, lib }: { id: string; config: Config; lib: CaptureLibraryDTO | undefined }) {
  const { nav } = config
  const [bump, setBump] = useState(0)
  // A capture sent again (or a comment screenshot) bumps the tab's revision: reload the page too.
  const rev = useStore(nav.revision, (n) => n)
  const { data, error } = useFetch<CaptureDTO>(`cap|${id}|${bump}|${rev}`, (signal) => unwrap(api.captures.items[':id'].$get({ param: { id } }, { init: { signal } })))
  const [patched, setPatched] = useState<CaptureDTO | null>(null)
  useEffect(() => setPatched(null), [data])
  const c = patched ?? data
  const filter = useStore(nav.store, (s) => s.filter)
  const query = useStore(nav.store, (s) => s.query)
  const list = useShown(lib, filter, query)
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
  }, [nav])

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
    if (!c || !confirm(`Delete “${c.title}”, with its screenshot, notes${config.comments ? ', comments' : ''} and tags?`)) return
    unwrap(api.captures.items[':id'].$delete({ param: { id } })).then(() => {
      nav.backToListing()
      nav.bump()
    }, fail)
  }

  return (
    <div ref={pageRef} className={yt.page}>
      <nav className={yt.pageNav}>
        <button onClick={nav.backToListing} title={`Back to the ${config.many}, where you were (Esc)`}>
          ← {config.name}
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
              <div className={yt.meta}>{c.kind === 'reddit' ? [c.author && `u/${c.author}`, metaLine(c)].filter(Boolean).join(' • ') : <span className={styles.url}>{c.url}</span>}</div>
            </div>
            <a className={yt.watch} href={c.url} target="_blank" rel="noreferrer">
              {config.openLabel} ↗
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
            {c.postedAt && (
              <div className={yt.infoRow}>
                <span className={yt.label}>Posted</span>
                <span>{fullDate(c.postedAt)}</span>
              </div>
            )}
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
          {config.comments && (
            <TextSection
              key={`comments|${c.id}`}
              title="Comments"
              {...imageOps(c.id, 'comments')}
              text={c.comments}
              images={c.commentImages}
              activeId={c.commentsActiveImageId}
              empty="Click to keep comments… paste or drop screenshots, or use “Add as comment” in the extension on the post."
              onSave={(comments) => save({ comments })}
              onActivate={(commentsActiveImageId) => save({ commentsActiveImageId })}
              onImages={refresh}
            />
          )}

          <footer className={yt.pageFooter}>
            <span />
            <button className={yt.link} onClick={remove}>
              Delete {config.one}
            </button>
          </footer>
        </>
      )}
    </div>
  )
}

// ── icons ──────────────────────────────────────────────────────────────────

function RedditLogo() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
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
