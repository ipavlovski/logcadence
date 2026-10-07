import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type MouseEvent, type Ref, type RefObject } from 'react'
import { formatJournalDate, isIsoDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import { allTagPaths, isUnder } from '../../../shared/tags.ts'
import type { ImageDTO, UpdateYtVideoBody, YtImageSection, YtLibraryDTO, YtVideoDTO, YtVideoSummary } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { mediaFiles, pasteMedia } from '../../media.ts'
import { openDate, panesStore } from '../../state/panes.ts'
import { useCommand } from '../../state/commands.ts'
import { useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import {
  backToListing,
  bumpYt,
  goYtHistory,
  goYtHome,
  jumpToDate,
  openVideo,
  registerAnchorCapture,
  saveAnchor,
  setYtFilter,
  setYtQuery,
  youtubeStore,
  ytDateInView,
  ytJumpOpen,
  ytRevision,
  type YtAnchor,
  type YtFilter,
} from '../../state/youtube.ts'
import { AutoTextarea } from '../AutoTextarea/AutoTextarea.tsx'
import { ImageGallery } from '../ImageGallery/ImageGallery.tsx'
import { Markdown } from '../Markdown/Markdown.tsx'
import { TagInput } from '../TagInput/TagInput.tsx'
import { YoutubeImport } from './YoutubeImport.tsx'
import styles from './Youtube.module.css'

// Canvas "YouTube" tab: videos imported from playlists, listed like YouTube's own grid (grouped by the day they
// were discovered), and a video page with the thumbnail, notes with images/gifs, and tags of its own.

const PAGE = 48
const fail = (err: Error) => notify(err.message)

export const thumb = (id: string, size: 'hq' | 'maxres' = 'hq') => `https://i.ytimg.com/vi/${id}/${size}default.jpg`
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`

function useLibrary() {
  const rev = useStore(ytRevision, (n) => n)
  return useFetch<YtLibraryDTO>(`ytlib|${rev}`, (signal) => unwrap(api.youtube.library.$get({}, { init: { signal } })))
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
/** "@WOT_utwente" from a channel link, when it has a handle. */
const handleOf = (url: string | null) => url?.match(/\/(@[^/?#]+)/)?.[1] ?? null

/** One search word: "@name" matches the channel (its name or @handle); others the title, channel or tags. */
function matchesWord(v: YtVideoSummary, w: string): boolean {
  if (w.startsWith('@')) {
    const q = squash(w.slice(1))
    return !q || squash(v.channel).includes(q) || !!handleOf(v.channelUrl)?.toLowerCase().includes(q)
  }
  const tag = w.replace(/^#/, '')
  return v.title.toLowerCase().includes(w) || v.channel.toLowerCase().includes(w) || v.tags.some((t) => t.includes(tag))
}

/** Videos the listing shows: the filter, then the search. */
function useShown(lib: YtLibraryDTO | undefined, filter: YtFilter, query: string): YtVideoSummary[] {
  return useMemo(() => {
    let list = lib?.videos ?? []
    if (filter?.kind === 'tag') list = list.filter((v) => v.tags.some((t) => isUnder(t, filter.path)))
    else if (filter?.kind === 'untagged') list = list.filter((v) => !v.tags.length)
    else if (filter?.kind === 'channel') list = list.filter((v) => v.channel === filter.name)
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length) list = list.filter((v) => words.every((w) => matchesWord(v, w)))
    return list
  }, [lib, filter, query])
}

export function Youtube(_: CanvasPluginProps) {
  const videoId = useStore(youtubeStore, (s) => s.videoId)
  const jumpOpen = useStore(ytJumpOpen, (o) => o)
  useCommand('canvas.back', () => goYtHistory(-1))
  useCommand('canvas.forward', () => goYtHistory(1))
  const [importOpen, setImportOpen] = useState(false)
  const lib = useLibrary()
  // The top bar stays over both the listing and a video; the listing measures its scroll position from it.
  const top = useRef<HTMLElement>(null)
  // The importer and the jump box sit outside the frame: the frame is a size container, which would clip a fixed-position window.
  return (
    <>
      {jumpOpen && <JumpBox lib={lib.data} />}
      <div className={styles.frame}>
        <TopBar ref={top} onImport={() => setImportOpen(true)} />
        {videoId ? <VideoPage key={videoId} id={videoId} lib={lib.data} /> : <Listing top={top} lib={lib.data} loading={lib.loading} error={lib.error} onImport={() => setImportOpen(true)} />}
      </div>
      {importOpen && <YoutubeImport onClose={() => setImportOpen(false)} />}
    </>
  )
}

// ── listing ────────────────────────────────────────────────────────────────

interface ListingProps {
  top: RefObject<HTMLElement | null>
  lib: YtLibraryDTO | undefined
  loading: boolean
  error: Error | undefined
  onImport: () => void
}

function Listing({ top, lib, loading, error, onImport }: ListingProps) {
  const filter = useStore(youtubeStore, (s) => s.filter)
  const query = useStore(youtubeStore, (s) => s.query)
  const seq = useStore(youtubeStore, (s) => s.seq)
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
    const s = youtubeStore.get()
    const anchor = s.history[s.hIndex]?.anchor ?? null
    const need = limitFor(shown, anchor)
    if (need > limit) return setLimit(need)
    scrollTo(top.current, anchor)
    restored.current = seq
  }, [seq, lib, shown, limit])

  // Reports where the listing is scrolled: on each step away from it, and (debounced) as it scrolls, so a reload keeps it.
  useLayoutEffect(() => {
    const header = top.current
    const scroller = header && scrollParent(header)
    if (!header || !scroller) return
    registerAnchorCapture(() => (restored.current === youtubeStore.get().seq ? anchorOf(header, scroller) : undefined))
    let t: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      clearTimeout(t)
      t = setTimeout(saveAnchor, 300)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(t)
      scroller.removeEventListener('scroll', onScroll)
      saveAnchor() // leaving the tab
      registerAnchorCapture(null)
    }
  }, [])

  // Shift+click selects several videos; a click elsewhere or Esc clears the selection.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })
  useEffect(() => {
    if (!selected.size) return
    const clear = () => setSelected(new Set())
    const onDown = (e: PointerEvent) => !(e.target as HTMLElement | null)?.closest('[data-video]') && clear()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      clear()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [selected])

  // Renders the next cards as the end of the grid scrolls into view.
  useEffect(() => {
    const el = more.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setLimit((n) => n + PAGE), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown, limit])

  const days = useMemo(() => {
    const out: { date: string; videos: YtVideoSummary[] }[] = []
    for (const v of shown.slice(0, limit)) {
      const last = out.at(-1)
      if (last?.date === v.addedDate) last.videos.push(v)
      else out.push({ date: v.addedDate, videos: [v] })
    }
    return out
  }, [shown, limit])
  const perDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of shown) m.set(v.addedDate, (m.get(v.addedDate) ?? 0) + 1)
    return m
  }, [shown])

  return (
    <>
      {lib && lib.videos.length > 0 && <Chips lib={lib} filter={filter} />}
      {filter?.kind === 'tag' && lib && <TagActions path={filter.path} count={shown.length} />}
      {filter?.kind === 'channel' && lib && <ChannelBar name={filter.name} lib={lib} count={shown.length} />}
      {error && !lib ? (
        <p className={styles.empty}>{error.message}</p>
      ) : !lib ? (
        loading && <div className={styles.loading} />
      ) : !lib.videos.length ? (
        <div className={styles.empty}>
          <p>No videos yet. Import a playlist to start the catalog.</p>
          <button className={styles.primary} onClick={onImport}>
            Import a playlist…
          </button>
        </div>
      ) : !shown.length ? (
        <p className={styles.empty}>No videos match.</p>
      ) : (
        <>
          {days.map((d) => (
            <section key={d.date} className={styles.day} data-day={d.date}>
              <h3 className={styles.dayTitle}>
                <button onClick={(e) => openDate(d.date, { newTab: e.ctrlKey || e.metaKey })} title="Open this day in the journal">
                  {dayLabel(d.date)}
                </button>
                <span>
                  {perDay.get(d.date)} added
                </span>
              </h3>
              <div className={styles.grid}>
                {d.videos.map((v) => (
                  <VideoCard key={v.id} v={v} selected={selected.has(v.id)} onSelect={toggleSelected} />
                ))}
              </div>
            </section>
          ))}
          {limit < shown.length && <div ref={more} className={styles.more} />}
        </>
      )}
    </>
  )
}

function dayLabel(date: string): string {
  const t = today()
  if (date === t) return 'Today'
  if (date === shiftDate(t, -1)) return 'Yesterday'
  return `${weekday(date)}, ${formatJournalDate(date)}`
}

/** How many cards must be rendered for an anchor's place to exist, with a page below it to scroll into. */
function limitFor(shown: YtVideoSummary[], anchor: YtAnchor): number {
  if (!anchor) return PAGE
  const i = 'video' in anchor ? shown.findIndex((v) => v.id === anchor.video) : shown.findIndex((v) => v.addedDate < anchor.date)
  if (i < 0) return 'video' in anchor ? PAGE : shown.length
  return i + PAGE
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
}

// Positions are measured from the bottom of the sticky top bar: what's under it is what's in view.
const lineOf = (header: HTMLElement, scroller: HTMLElement) => scroller.getBoundingClientRect().top + header.offsetHeight
const daysUnder = (header: HTMLElement) => [...(header.parentElement?.querySelectorAll<HTMLElement>('[data-day]') ?? [])]

/** The day under the top bar, and how far into it the listing is scrolled; null at the top. */
function anchorOf(header: HTMLElement, scroller: HTMLElement): YtAnchor {
  if (scroller.scrollTop <= 0) return null
  const line = lineOf(header, scroller)
  const day = daysUnder(header).findLast((d) => d.getBoundingClientRect().top <= line + 1)
  return day ? { date: day.dataset.day!, offset: Math.round(line - day.getBoundingClientRect().top) } : null
}

/** Scrolls the listing to an anchor: a day (or the nearest earlier one), a video's card, or the top. */
function scrollTo(header: HTMLElement, anchor: YtAnchor) {
  const scroller = scrollParent(header)
  if (!scroller) return
  if (!anchor) {
    scroller.scrollTop = 0
  } else if ('video' in anchor) {
    header.parentElement?.querySelector(`[data-video="${CSS.escape(anchor.video)}"]`)?.scrollIntoView({ block: 'center' })
  } else {
    const days = daysUnder(header)
    const day = days.find((d) => d.dataset.day! <= anchor.date) ?? days.at(-1)
    if (!day) return
    const offset = day.dataset.day === anchor.date ? anchor.offset : 0
    scroller.scrollTop += day.getBoundingClientRect().top - lineOf(header, scroller) + offset
  }
}

function TopBar({ ref, onImport }: { ref: Ref<HTMLElement>; onImport: () => void }) {
  const query = useStore(youtubeStore, (s) => s.query)
  const canBack = useStore(youtubeStore, (s) => s.hIndex > 0)
  const canForward = useStore(youtubeStore, (s) => s.hIndex < s.history.length - 1)
  return (
    <header ref={ref} className={styles.top}>
      <button className={styles.brand} onClick={goYtHome} title="Back to the top (Alt+← returns)">
        <PlayLogo />
        <span>YouTube</span>
      </button>
      <div className={styles.search}>
        <input value={query} placeholder="Search" spellCheck={false} onChange={(e) => setYtQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setYtQuery('')} />
        {query && (
          <button className={styles.clear} title="Clear" onClick={() => setYtQuery('')}>
            ×
          </button>
        )}
        <span className={styles.searchIcon} aria-hidden>
          <SearchIcon />
        </span>
      </div>
      <div className={styles.actions}>
        <button className={styles.iconButton} disabled={!canBack} onClick={() => goYtHistory(-1)} title="Back (Alt+←)">
          <ArrowIcon dir={-1} />
        </button>
        <button className={styles.iconButton} disabled={!canForward} onClick={() => goYtHistory(1)} title="Forward (Alt+→)">
          <ArrowIcon dir={1} />
        </button>
        <button className={styles.iconButton} onClick={onImport} title="Import new videos from your playlists">
          <PlusIcon />
        </button>
      </div>
    </header>
  )
}

/** The tags in use (not their implied ancestors) and "untagged"; clicking the selected chip shows everything again. */
function Chips({ lib, filter }: { lib: YtLibraryDTO; filter: YtFilter }) {
  const is = (f: NonNullable<YtFilter>) => JSON.stringify(f) === JSON.stringify(filter)
  const chip = (f: NonNullable<YtFilter>, label: string, title: string, cls = '') => (
    <button key={JSON.stringify(f)} className={`${styles.chip} ${cls} ${is(f) ? styles.chipOn : ''}`} title={title} onClick={() => setYtFilter(is(f) ? null : f)}>
      {label}
    </button>
  )
  const active = lib.tags.filter((t) => t.active > 0)
  return (
    <nav className={styles.chips}>
      {chip({ kind: 'untagged' }, 'untagged', 'Videos without tags')}
      {active.map((t) => chip({ kind: 'tag', path: t.path }, `#${t.path}`, `${t.active} video${t.active === 1 ? '' : 's'} (with the tags under it, when filtering)`, styles.tagChip))}
    </nav>
  )
}

/** The channel filter: its avatar and name, and a way out. */
function ChannelBar({ name, lib, count }: { name: string; lib: YtLibraryDTO; count: number }) {
  const v = lib.videos.find((x) => x.channel === name)
  return (
    <div className={styles.channelBar}>
      {v && <Avatar v={v} large />}
      <div>
        <div className={styles.channelName}>{name}</div>
        <div className={styles.meta}>
          {handleOf(v?.channelUrl ?? null) && <>{handleOf(v!.channelUrl)} • </>}
          {count} video{count === 1 ? '' : 's'}
        </div>
      </div>
      {v?.channelUrl && (
        <a className={styles.watch} href={v.channelUrl} target="_blank" rel="noreferrer">
          Channel ↗
        </a>
      )}
      <button className={styles.clearFilter} onClick={() => setYtFilter(null)} title="Show every channel">
        ×
      </button>
    </div>
  )
}

function TagActions({ path, count }: { path: string; count: number }) {
  const rename = () => {
    const to = prompt(`Rename #${path} (and the tags under it) to:`, path)
    if (!to || to === path) return
    unwrap(api.youtube.tags.move.$post({ json: { from: path, to } })).then(() => {
      setYtFilter({ kind: 'tag', path: to.trim().toLowerCase() })
      bumpYt()
    }, fail)
  }
  const remove = () => {
    if (!confirm(`Remove #${path} and the tags under it from every video? The videos stay.`)) return
    unwrap(api.youtube.tags.delete.$post({ json: { path } })).then(() => {
      setYtFilter(null)
      bumpYt()
    }, fail)
  }
  return (
    <div className={styles.tagBar}>
      <span className={styles.tagName}>#{path}</span>
      <span className={styles.muted}>{count} videos</span>
      <button onClick={rename}>Rename / merge</button>
      <button onClick={remove}>Delete tag</button>
    </div>
  )
}

/** A click opens the video; a shift+click adds it to (or takes it out of) the selection. */
function VideoCard({ v, selected, onSelect }: { v: YtVideoSummary; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <article
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      data-video={v.id}
      aria-selected={selected}
      onMouseDown={(e) => e.shiftKey && e.preventDefault()} // no text selection on shift+click
      onClick={(e) => (e.shiftKey ? onSelect(v.id) : openVideo(v.id))}
    >
      <div className={styles.thumb}>
        <img src={v.thumbSmallUrl ?? thumb(v.id)} alt="" loading="lazy" decoding="async" draggable={false} />
        {v.duration && <span className={styles.duration}>{v.duration}</span>}
        {v.hasNotes && (
          <span className={styles.noteBadge} title="Has notes">
            ✎
          </span>
        )}
      </div>
      <div className={styles.details}>
        <Avatar v={v} onClick={() => setYtFilter({ kind: 'channel', name: v.channel })} />
        <div className={styles.text}>
          <h4 className={styles.title} title={v.title}>
            {v.title}
          </h4>
          <div className={styles.meta}>{v.channel}</div>
          <div className={styles.meta}>{[v.views, publishedText(v)].filter(Boolean).join(' • ')}</div>
          {v.tags.length > 0 && (
            <div className={styles.cardTags}>
              {v.tags.map((t) => (
                <button
                  key={t}
                  onClick={(e) => {
                    e.stopPropagation()
                    setYtFilter({ kind: 'tag', path: t })
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

/** The channel's icon; with onClick, a button that shows the channel's videos. */
function Avatar({ v, large, onClick }: { v: YtVideoSummary; large?: boolean; onClick?: () => void }) {
  const [broken, setBroken] = useState(false)
  const cls = `${styles.avatar} ${large ? styles.avatarLarge : ''}`
  const icon =
    !v.channelAvatar || broken ? (
      <span className={`${cls} ${styles.avatarLetter}`}>{(v.channel || '?').slice(0, 1).toUpperCase()}</span>
    ) : (
      <img className={cls} src={v.channelAvatar} alt="" loading="lazy" onError={() => setBroken(true)} />
    )
  if (!onClick) return icon
  return (
    <button
      className={styles.avatarButton}
      title={`All videos by ${v.channel}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {icon}
    </button>
  )
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

/** "4 years ago", from the publish date when the Data API gave one, else as YouTube's page said it. */
function publishedText(v: YtVideoSummary): string | null {
  if (!v.publishedAt) return v.published
  const ms = Date.now() - v.publishedAt
  const [unit, size] = UNITS.find(([, n]) => ms >= n) ?? UNITS.at(-1)!
  return rtf.format(-Math.max(1, Math.floor(ms / size)), unit)
}

// ── jump to date (ctrl+j) ──────────────────────────────────────────────────

/** A date field over the top of the tab: Enter scrolls the listing to that day (or the nearest earlier one with videos). */
function JumpBox({ lib }: { lib: YtLibraryDTO | undefined }) {
  const videos = lib?.videos ?? []
  const [date, setDate] = useState(() => ytDateInView(videos) ?? today())
  const close = () => ytJumpOpen.set(() => false)
  const go = () => {
    if (!isIsoDate(date)) return
    close()
    jumpToDate(date)
  }
  return (
    <div className={styles.jumpLayer}>
      <form
        className={styles.jump}
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          close()
        }}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && document.hasFocus() && close()}
      >
        <label htmlFor="yt-jump">Jump to date</label>
        <input id="yt-jump" type="date" value={date} min={videos.at(-1)?.addedDate} max={videos[0]?.addedDate} autoFocus onChange={(e) => setDate(e.target.value)} />
        <button type="submit" className={styles.primary} disabled={!isIsoDate(date)}>
          Go
        </button>
      </form>
    </div>
  )
}

// ── video page ─────────────────────────────────────────────────────────────

const fullDate = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function VideoPage({ id, lib }: { id: string; lib: YtLibraryDTO | undefined }) {
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<YtVideoDTO>(`ytv|${id}|${bump}`, (signal) => unwrap(api.youtube.videos[':id'].$get({ param: { id } }, { init: { signal } })))
  // PATCH answers replace the fetched copy at once, so a save doesn't flash the old notes.
  const [patched, setPatched] = useState<YtVideoDTO | null>(null)
  useEffect(() => setPatched(null), [data])
  const v = patched ?? data
  const filter = useStore(youtubeStore, (s) => s.filter)
  const query = useStore(youtubeStore, (s) => s.query)
  const list = useShown(lib, filter, query)
  const i = list.findIndex((x) => x.id === id)
  const prev = i > 0 ? list[i - 1] : undefined
  const next = i >= 0 ? list[i + 1] : undefined
  const tagPaths = useMemo(() => allTagPaths(lib?.tags ?? []), [lib])
  const pageRef = useRef<HTMLDivElement>(null)
  // A video opens at its top, not at the listing's scroll position.
  useLayoutEffect(() => {
    const scroller = pageRef.current && scrollParent(pageRef.current)
    if (scroller) scroller.scrollTop = 0
  }, [])

  // Esc goes back to the listing (when not typing, and the canvas has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Escape' || e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable]') || panesStore.get().focus !== 'canvas') return
      backToListing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const save = (body: UpdateYtVideoBody) =>
    unwrap(api.youtube.videos[':id'].$patch({ param: { id }, json: body })).then((r) => {
      setPatched(r)
      bumpYt()
    }, fail)
  const refresh = () => {
    setBump((b) => b + 1)
    bumpYt()
  }

  const remove = () => {
    if (!v || !confirm(`Remove “${v.title}” from the catalog, with its notes, comments and tags? An import brings it back while it is still in a playlist.`)) return
    unwrap(api.youtube.videos[':id'].$delete({ param: { id } })).then(() => {
      backToListing()
      bumpYt()
    }, fail)
  }

  return (
    <div ref={pageRef} className={styles.page}>
      <nav className={styles.pageNav}>
        <button onClick={backToListing} title="Back to the videos, where you were (Esc)">
          ← Videos
        </button>
        <span className={styles.push} />
        <button disabled={!prev} onClick={() => prev && openVideo(prev.id)} title={prev?.title}>
          ‹ Previous
        </button>
        <button disabled={!next} onClick={() => next && openVideo(next.id)} title={next?.title}>
          Next ›
        </button>
      </nav>
      {!v ? (
        error ? <p className={styles.empty}>{error.message}</p> : <div className={styles.loading} />
      ) : (
        <>
          <Thumbnail v={v} />
          <h1 className={styles.pageTitle}>{v.title}</h1>
          <div className={styles.owner}>
            <Avatar v={v} large onClick={() => setYtFilter({ kind: 'channel', name: v.channel })} />
            <div>
              {v.channelUrl ? (
                <a className={styles.channel} href={v.channelUrl} target="_blank" rel="noreferrer">
                  {v.channel}
                </a>
              ) : (
                <span className={styles.channel}>{v.channel}</span>
              )}
              <div className={styles.meta}>{[v.views, publishedText(v)].filter(Boolean).join(' • ')}</div>
            </div>
            <a className={styles.watch} href={watchUrl(v.id)} target="_blank" rel="noreferrer">
              Open on YouTube ↗
            </a>
          </div>

          <section className={styles.infoBox}>
            <div className={styles.infoRow}>
              <span className={styles.label}>Added</span>
              <button className={styles.link} onClick={(e) => openDate(v.addedDate, { newTab: e.ctrlKey || e.metaKey })} title="Open this day in the journal">
                {formatJournalDate(v.addedDate)}
              </button>
              <span className={styles.muted}>{v.addedAt === v.importedAt ? 'when it was imported (no API key)' : fullDate(v.addedAt)}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Imported</span>
              <span>{fullDate(v.importedAt)}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Tags</span>
              <TagInput
                className={styles.tags}
                value={v.tags}
                paths={tagPaths}
                onChange={(tags) => save({ tags })}
                onOpen={(path) => setYtFilter({ kind: 'tag', path })}
                placeholder="add tag… (e.g. build:well)"
              />
            </div>
          </section>

          <TextSection
            key={`notes|${v.id}`}
            videoId={v.id}
            section="notes"
            title="Notes"
            text={v.notes}
            images={v.images}
            activeId={v.activeImageId}
            empty="Click to write notes… paste or drop images, gifs and videos."
            onSave={(notes) => save({ notes })}
            onActivate={(activeImageId) => save({ activeImageId })}
            onImages={refresh}
          />
          <TextSection
            key={`comments|${v.id}`}
            videoId={v.id}
            section="comments"
            title="Comments"
            text={v.comments}
            images={v.commentImages}
            activeId={v.commentsActiveImageId}
            empty="Click to keep comments… paste or drop screenshots of them."
            onSave={(comments) => save({ comments })}
            onActivate={(commentsActiveImageId) => save({ commentsActiveImageId })}
            onImages={refresh}
          />

          <footer className={styles.pageFooter}>
            <span />
            <button className={styles.link} onClick={remove}>
              Remove from catalog
            </button>
          </footer>
        </>
      )}
    </div>
  )
}

/** The thumbnail, large: the downloaded one, or until then YouTube's (maxres isn't made for every video: on a 404, hq). */
function Thumbnail({ v }: { v: YtVideoSummary }) {
  // The downloaded copy; until it's there, YouTube's own.
  const [src, setSrc] = useState(v.thumbUrl ?? thumb(v.id, 'maxres'))
  return (
    <div className={styles.player} title={v.thumbSize ? THUMB_SIZE[v.thumbSize] : 'Thumbnail not downloaded yet'}>
      <img src={src} alt="" onError={() => setSrc(thumb(v.id))} />
    </div>
  )
}

const THUMB_SIZE = { maxres: 'Thumbnail: 1280×720 (the largest YouTube makes)', sd: 'Thumbnail: 640×480', hq: 'Thumbnail: 480×360', none: 'YouTube has no thumbnail for this video' }

interface TextSectionProps {
  videoId: string
  section: YtImageSection
  title: string
  text: string
  images: ImageDTO[]
  activeId: string | null
  empty: string
  onSave: (text: string) => void
  onActivate: (imageId: string) => void
  /** After images were added, removed or reordered. */
  onImages: () => void
}

/** Markdown text (click to edit, saved when editing ends) and its gallery: pasted or dropped images, gifs and videos join it. */
function TextSection({ videoId, section, title, text, images, activeId, empty, onSave, onActivate, onImages }: TextSectionProps) {
  const [editing, setEditing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const imageOp = (p: Promise<unknown>) => p.catch(fail).finally(onImages)
  const upload = async (files: File[]) => {
    for (const file of files) await unwrap(api.youtube.videos[':id'].images[':section'].$post({ param: { id: videoId, section }, form: { file } })).catch(fail)
    onImages()
  }
  const onDrop = (e: DragEvent) => {
    const files = mediaFiles(e.dataTransfer.files)
    setDragOver(false)
    if (!files.length) return
    e.preventDefault()
    void upload(files)
  }
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button') || window.getSelection()?.toString()) return
    setEditing(true)
  }
  return (
    <section
      className={`${styles.notes} ${dragOver ? styles.dragOver : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <h3>{title}</h3>
      {editing ? (
        <NotesEditor
          initial={text}
          onDone={(next) => {
            setEditing(false)
            if (next !== text) onSave(next)
          }}
          onUpload={(files) => void upload(files)}
        />
      ) : (
        <div className={styles.notesView} onClick={open}>
          {text.trim() ? <Markdown source={text} /> : !images.length && <span className={styles.placeholder}>{empty}</span>}
        </div>
      )}
      {images.length > 0 && (
        <div className={styles.gallery}>
          <ImageGallery
            images={images}
            activeId={activeId}
            onActivate={onActivate}
            onDelete={(imageId) => imageOp(unwrap(api.youtube.images[':id'].$delete({ param: { id: imageId } })))}
            onReorder={(ids) => imageOp(unwrap(api.youtube.videos[':id'].images[':section'].order.$post({ param: { id: videoId, section }, json: { ids } })))}
          />
        </div>
      )}
    </section>
  )
}

function NotesEditor({ initial, onDone, onUpload }: { initial: string; onDone: (notes: string) => void; onUpload: (files: File[]) => void }) {
  const [draft, setDraft] = useState(initial)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const finished = useRef(false)
  const finish = () => {
    if (finished.current) return
    finished.current = true
    doneRef.current(draftRef.current)
  }
  // Leaving the page (another video, the listing) while typing still saves.
  useEffect(() => finish, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onPaste = (e: ClipboardEvent) => pasteMedia(e, onUpload)
  return (
    <AutoTextarea
      className={styles.editor}
      value={draft}
      autoFocus
      spellCheck={false}
      placeholder="Write… (markdown; paste or drop images, gifs and videos; Esc to finish)"
      onChange={(e) => setDraft(e.target.value)}
      onPaste={onPaste}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        // Switching windows keeps the editor open; clicking elsewhere in the app closes it.
        if (document.hasFocus()) finish()
      }}
    />
  )
}

// ── icons ──────────────────────────────────────────────────────────────────

function PlayLogo() {
  return (
    <svg viewBox="0 0 28 20" width="28" height="20" aria-hidden>
      <rect width="28" height="20" rx="5" fill="#ff0033" />
      <path d="M11 5.5v9l8-4.5z" fill="#fff" />
    </svg>
  )
}

function ArrowIcon({ dir }: { dir: -1 | 1 }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir < 0 ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </svg>
  )
}
