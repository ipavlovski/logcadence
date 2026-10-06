import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type MouseEvent } from 'react'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import { allTagPaths, isUnder } from '../../../shared/tags.ts'
import type { ImageDTO, UpdateYtVideoBody, YtImageSection, YtLibraryDTO, YtVideoDTO, YtVideoSummary } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { mediaFiles, pasteMedia } from '../../media.ts'
import { openDate, panesStore } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import { bumpYt, openVideo, setYtFilter, setYtQuery, youtubeStore, ytRevision, type YtFilter } from '../../state/youtube.ts'
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
  const [importOpen, setImportOpen] = useState(false)
  const lib = useLibrary()
  // The importer sits outside the frame: the frame is a size container, which would clip a fixed-position window.
  return (
    <>
      <div className={styles.frame}>
        {videoId ? <VideoPage key={videoId} id={videoId} lib={lib.data} /> : <Listing lib={lib.data} loading={lib.loading} error={lib.error} onImport={() => setImportOpen(true)} />}
      </div>
      {importOpen && <YoutubeImport onClose={() => setImportOpen(false)} />}
    </>
  )
}

// ── listing ────────────────────────────────────────────────────────────────

function Listing({ lib, loading, error, onImport }: { lib: YtLibraryDTO | undefined; loading: boolean; error: Error | undefined; onImport: () => void }) {
  const filter = useStore(youtubeStore, (s) => s.filter)
  const query = useStore(youtubeStore, (s) => s.query)
  const shown = useShown(lib, filter, query)
  const [limit, setLimit] = useState(PAGE)
  const more = useRef<HTMLDivElement>(null)
  useEffect(() => setLimit(PAGE), [filter, query])
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
      <TopBar onImport={onImport} />
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
            <section key={d.date} className={styles.day}>
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
                  <VideoCard key={v.id} v={v} />
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

function TopBar({ onImport }: { onImport: () => void }) {
  const query = useStore(youtubeStore, (s) => s.query)
  return (
    <header className={styles.top}>
      <div className={styles.brand}>
        <PlayLogo />
        <span>YouTube</span>
      </div>
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
      <button className={styles.importLink} onClick={onImport} title="Import new videos from your playlists">
        <PlusIcon /> Import
      </button>
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

function VideoCard({ v }: { v: YtVideoSummary }) {
  return (
    <article className={styles.card} onClick={() => openVideo(v.id)}>
      <div className={styles.thumb}>
        <img src={thumb(v.id)} alt="" loading="lazy" draggable={false} />
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

  // Esc goes back to the listing (when not typing, and the canvas has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Escape' || e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable]') || panesStore.get().focus !== 'canvas') return
      openVideo(null)
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
      openVideo(null)
      bumpYt()
    }, fail)
  }

  return (
    <div className={styles.page}>
      <nav className={styles.pageNav}>
        <button onClick={() => openVideo(null)} title="Back to the videos (Esc)">
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
          <Thumbnail id={v.id} />
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

/** The thumbnail, large (maxres isn't made for every video: YouTube answers 404, so fall back to hq). */
function Thumbnail({ id }: { id: string }) {
  const [src, setSrc] = useState(thumb(id, 'maxres'))
  return (
    <div className={styles.player}>
      <img src={src} alt="" onError={() => setSrc(thumb(id))} />
    </div>
  )
}

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
