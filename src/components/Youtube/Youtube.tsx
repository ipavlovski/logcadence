import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type MouseEvent } from 'react'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import { allTagPaths, isUnder } from '../../../shared/tags.ts'
import type { UpdateYtVideoBody, YtLibraryDTO, YtVideoDTO, YtVideoSummary } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
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

/** Videos the listing shows: the filter, then the search (title, channel, tags). */
function useShown(lib: YtLibraryDTO | undefined, filter: YtFilter, query: string): YtVideoSummary[] {
  return useMemo(() => {
    let list = lib?.videos ?? []
    if (filter?.kind === 'playlist') list = list.filter((v) => v.playlistIds.includes(filter.id))
    else if (filter?.kind === 'tag') list = list.filter((v) => v.tags.some((t) => isUnder(t, filter.path)))
    else if (filter?.kind === 'untagged') list = list.filter((v) => !v.tags.length)
    else if (filter?.kind === 'notes') list = list.filter((v) => v.hasNotes)
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length) list = list.filter((v) => words.every((w) => v.title.toLowerCase().includes(w) || v.channel.toLowerCase().includes(w) || v.tags.some((t) => t.includes(w.replace(/^#/, '')))))
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
                  {perDay.get(d.date)} discovered
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

function Chips({ lib, filter }: { lib: YtLibraryDTO; filter: YtFilter }) {
  const tagPaths = useMemo(() => allTagPaths(lib.tags), [lib.tags])
  const is = (f: YtFilter) => JSON.stringify(f) === JSON.stringify(filter)
  const chip = (f: YtFilter, label: string, title?: string, cls = '') => (
    <button key={JSON.stringify(f)} className={`${styles.chip} ${cls} ${is(f) ? styles.chipOn : ''}`} title={title} onClick={() => setYtFilter(is(f) && f ? null : f)}>
      {label}
    </button>
  )
  return (
    <nav className={styles.chips}>
      {chip(null, 'All')}
      {lib.playlists.map((p) => chip({ kind: 'playlist', id: p.id }, p.title, `Playlist · ${p.count} videos`))}
      {chip({ kind: 'notes' }, 'With notes')}
      {chip({ kind: 'untagged' }, 'Untagged')}
      {tagPaths.map((t) => chip({ kind: 'tag', path: t }, `#${t}`, 'Videos with this tag or one under it', styles.tagChip))}
    </nav>
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
        <Avatar v={v} />
        <div className={styles.text}>
          <h4 className={styles.title} title={v.title}>
            {v.title}
          </h4>
          <div className={styles.meta}>{v.channel}</div>
          <div className={styles.meta}>{[v.views, v.published].filter(Boolean).join(' • ')}</div>
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

function Avatar({ v, large }: { v: YtVideoSummary; large?: boolean }) {
  const [broken, setBroken] = useState(false)
  const cls = `${styles.avatar} ${large ? styles.avatarLarge : ''}`
  if (!v.channelAvatar || broken) return <span className={`${cls} ${styles.avatarLetter}`}>{(v.channel || '?').slice(0, 1).toUpperCase()}</span>
  return <img className={cls} src={v.channelAvatar} alt="" loading="lazy" onError={() => setBroken(true)} />
}

// ── video page ─────────────────────────────────────────────────────────────

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
  const playlists = lib?.playlists.filter((p) => v?.playlistIds.includes(p.id)) ?? []

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

  const upload = async (files: File[]) => {
    for (const file of files) {
      try {
        await unwrap(api.youtube.videos[':id'].images.$post({ param: { id }, form: { file } }))
      } catch (err) {
        fail(err as Error)
      }
    }
    setBump((b) => b + 1)
    bumpYt()
  }
  const imageOp = (p: Promise<unknown>) =>
    p.catch(fail).finally(() => {
      setBump((b) => b + 1)
      bumpYt()
    })

  const remove = () => {
    if (!v || !confirm(`Remove “${v.title}” from the catalog, with its notes and tags? An import brings it back while it is still in a playlist.`)) return
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
          <Player id={v.id} title={v.title} />
          <h1 className={styles.pageTitle}>{v.title}</h1>
          <div className={styles.owner}>
            <Avatar v={v} large />
            <div>
              {v.channelUrl ? (
                <a className={styles.channel} href={v.channelUrl} target="_blank" rel="noreferrer">
                  {v.channel}
                </a>
              ) : (
                <span className={styles.channel}>{v.channel}</span>
              )}
              <div className={styles.meta}>{[v.views, v.published].filter(Boolean).join(' • ')}</div>
            </div>
            <a className={styles.watch} href={watchUrl(v.id)} target="_blank" rel="noreferrer">
              Open on YouTube ↗
            </a>
          </div>

          <section className={styles.infoBox}>
            <div className={styles.infoRow}>
              <span className={styles.label}>Discovered</span>
              <input
                type="date"
                value={v.addedDate}
                max={today()}
                onChange={(e) => e.target.value && save({ addedDate: e.target.value })}
                title="The day this video was added to a playlist (set on import; change it for videos imported later)"
              />
              <button className={styles.link} onClick={(e) => openDate(v.addedDate, { newTab: e.ctrlKey || e.metaKey })}>
                open day
              </button>
            </div>
            {playlists.length > 0 && (
              <div className={styles.infoRow}>
                <span className={styles.label}>Playlists</span>
                {playlists.map((p) => (
                  <button key={p.id} className={styles.link} onClick={() => setYtFilter({ kind: 'playlist', id: p.id })}>
                    {p.title}
                  </button>
                ))}
              </div>
            )}
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

          <Notes v={v} onSave={(notes) => save({ notes })} onUpload={upload} />
          {v.images.length > 0 && (
            <div className={styles.gallery}>
              <ImageGallery
                images={v.images}
                activeId={v.activeImageId}
                onActivate={(activeImageId) => save({ activeImageId })}
                onDelete={(imageId) => imageOp(unwrap(api.youtube.images[':id'].$delete({ param: { id: imageId } })))}
                onReorder={(ids) => imageOp(unwrap(api.youtube.videos[':id'].images.order.$post({ param: { id }, json: { ids } })))}
              />
            </div>
          )}

          <footer className={styles.pageFooter}>
            <span className={styles.muted}>Imported {new Date(v.addedAt).toLocaleString()}</span>
            <button className={styles.link} onClick={remove}>
              Remove from catalog
            </button>
          </footer>
        </>
      )}
    </div>
  )
}

/** The thumbnail, large; a click plays the video in place. */
function Player({ id, title }: { id: string; title: string }) {
  const [playing, setPlaying] = useState(false)
  // maxres isn't made for every video (YouTube answers 404): fall back to hq.
  const [src, setSrc] = useState(thumb(id, 'maxres'))
  if (playing)
    return (
      <div className={styles.player}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    )
  return (
    <button className={styles.player} onClick={() => setPlaying(true)} title="Play here">
      <img src={src} alt="" onError={() => setSrc(thumb(id))} />
      <span className={styles.play} aria-hidden>
        <PlayLogo />
      </span>
    </button>
  )
}

const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'))

/** Markdown notes: click to edit, saved when editing ends. Pasted or dropped images and gifs join the gallery. */
function Notes({ v, onSave, onUpload }: { v: YtVideoDTO; onSave: (notes: string) => void; onUpload: (files: File[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const onDrop = (e: DragEvent) => {
    const files = imageFiles(e.dataTransfer.files)
    setDragOver(false)
    if (!files.length) return
    e.preventDefault()
    onUpload(files)
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
      <h3>Notes</h3>
      {editing ? (
        <NotesEditor
          initial={v.notes}
          onDone={(notes) => {
            setEditing(false)
            if (notes !== v.notes) onSave(notes)
          }}
          onUpload={onUpload}
        />
      ) : (
        <div className={styles.notesView} onClick={open}>
          {v.notes.trim() ? <Markdown source={v.notes} /> : <span className={styles.placeholder}>Click to write notes… paste or drop images and gifs.</span>}
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

  const onPaste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData.files)
    if (!files.length) return
    e.preventDefault()
    onUpload(files)
  }
  return (
    <AutoTextarea
      className={styles.editor}
      value={draft}
      autoFocus
      spellCheck={false}
      placeholder="Write… (markdown; paste or drop images and gifs; Esc to finish)"
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
