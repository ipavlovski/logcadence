import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { today } from '../../../shared/dates.ts'
import { between } from '../../../shared/id.ts'
import type { BoardDayDTO, BoardItemDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { mediaFiles, pasteMedia } from '../../media.ts'
import { persistedStore, useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import { dayLabel } from '../Youtube/Youtube.tsx'
import { prepare } from './thumbs.ts'
import styles from './Board.module.css'

// The Images tab: a scratchpad board, like PureRef. Pasted images, gifs and videos land under today's divider,
// as tiles of one height in rows; drag a tile beside another, into the gap between rows (a new row) or to another day.
// Click selects a tile, Shift+click adds to the selection; Delete and dragging act on all of it.
// Double-click or Space opens one large, where the arrow keys step through the board.

const ITEM_TYPE = 'application/x-board-id'
const MIN_H = 80
const MAX_H = 360
const rowHeightStore = persistedStore('board.rowHeight', 160, (s) => (typeof s === 'number' && s >= MIN_H && s <= MAX_H ? s : 160))

const fail = (err: unknown) => notify(err instanceof Error ? err.message : String(err))
const isVideo = (item: BoardItemDTO) => item.mime.startsWith('video/')

interface Place {
  date: string
  row: number
  position: number
}

/** Where a drop lands: beside a tile, or in the gap between two rows of a day (either missing at the ends). */
type Target = { kind: 'tile'; id: string; after: boolean } | { kind: 'gap'; date: string; prev?: number; next?: number }

const sameTarget = (a: Target | null, b: Target) =>
  !!a &&
  a.kind === b.kind &&
  (a.kind === 'tile' ? b.kind === 'tile' && a.id === b.id && a.after === b.after : b.kind === 'gap' && a.date === b.date && a.prev === b.prev && a.next === b.next)

const byPlace = (a: BoardItemDTO, b: BoardItemDTO) => a.row - b.row || a.position - b.position

function rowsOf(items: BoardItemDTO[]): BoardItemDTO[][] {
  const rows: BoardItemDTO[][] = []
  for (const item of items) {
    const last = rows.at(-1)
    if (last?.[0]?.row === item.row) last.push(item)
    else rows.push([item])
  }
  return rows
}

/** The days with `removeId` taken out and `item` (if any) put in its place. Days left empty go, except today. */
function withItem(days: BoardDayDTO[], item: BoardItemDTO | null, removeId: string): BoardDayDTO[] {
  let out = days.map((d) => ({ ...d, items: d.items.filter((i) => i.id !== removeId) }))
  if (item) {
    if (!out.some((d) => d.date === item.date)) out = [...out, { date: item.date, items: [] }].sort((a, b) => b.date.localeCompare(a.date))
    out = out.map((d) => (d.date === item.date ? { ...d, items: [...d.items, item].sort(byPlace) } : d))
  }
  const t = today()
  return out.filter((d) => d.items.length || d.date === t)
}

/** The place a drop on `t` gives, leaving out the dragged items (`skip`), and the position after it (for several items). */
function placeFor(days: BoardDayDTO[], t: Target, skip: string[] = []): { place: Place; next?: number } | null {
  if (t.kind === 'gap') return { place: { date: t.date, row: between(t.prev, t.next), position: 1 } }
  if (skip.includes(t.id)) return null
  const day = days.find((d) => d.items.some((i) => i.id === t.id))
  const target = day?.items.find((i) => i.id === t.id)
  if (!day || !target) return null
  const row = day.items.filter((i) => i.row === target.row && !skip.includes(i.id))
  const k = row.indexOf(target)
  const [prev, next] = t.after ? [target.position, row[k + 1]?.position] : [row[k - 1]?.position, target.position]
  return { place: { date: day.date, row: target.row, position: between(prev, next) }, next }
}

export function Board() {
  const [days, setDays] = useState<BoardDayDTO[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [dragIds, setDragIds] = useState<string[] | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  /** The tile clicked last: the one Space opens. */
  const [anchor, setAnchor] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const rowHeight = useStore(rowHeightStore, (h) => h)
  const loadingMore = useRef(false)
  const more = useRef<HTMLDivElement>(null)

  const load = useCallback(async (before?: string) => {
    const page = await unwrap(api.board.$get({ query: { before } }))
    setDays((d) => (before ? [...d, ...page.days] : page.days))
    setNext(page.next)
    setLoaded(true)
  }, [])

  useEffect(() => {
    load().catch(fail)
  }, [load])

  useEffect(() => {
    const el = more.current
    if (!el || !next) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || loadingMore.current) return
        loadingMore.current = true
        load(next)
          .catch(fail)
          .finally(() => (loadingMore.current = false))
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [next, load])

  const t = today()
  const shown = days.some((d) => d.date === t) ? days : [{ date: t, items: [] }, ...days]
  const all = shown.flatMap((d) => d.items)
  const openAt = openId ? all.findIndex((i) => i.id === openId) : -1
  const open = all[openAt]

  const select = (id: string) => {
    setSelected(new Set([id]))
    setAnchor(id)
  }

  // Opened large: Escape or Space closes, the arrows go to the previous or next tile (which becomes the selection).
  useEffect(() => {
    if (openAt < 0) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === ' ' && !e.repeat)) setOpenId(null)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const to = all[openAt + (e.key === 'ArrowLeft' ? -1 : 1)]
        if (!to) return
        setOpenId(to.id)
        select(to.id)
        document.querySelector(`[data-tile="${to.id}"]`)?.scrollIntoView({ block: 'nearest' })
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openAt, all])

  /** Uploads one by one, each after the last; without a place, at the end of today's last row. */
  const upload = async (files: File[], at?: Place, nextPosition?: number) => {
    setUploading((n) => n + files.length)
    let position = at?.position
    for (const file of files) {
      try {
        const p = await prepare(file)
        const thumb = p.thumb && new File([p.thumb], 'thumb.webp', { type: p.thumb.type })
        const place = at && position !== undefined ? { row: at.row, position } : undefined
        if (place) position = between(position, nextPosition)
        const form = { file, thumb, width: String(p.width), height: String(p.height), date: at?.date ?? today(), row: place?.row, position: place?.position }
        const item = await unwrap(api.board.$post({ form }))
        setDays((d) => withItem(d, item, item.id))
      } catch (err) {
        fail(err)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const reload = (err: unknown) => {
    fail(err)
    load().catch(fail)
  }

  /** Moves the items to the drop, one after another in board order. */
  const move = (ids: string[], t: Target) => {
    const to = placeFor(days, t, ids)
    if (!to) return
    let position = to.place.position
    const moved = all
      .filter((i) => ids.includes(i.id))
      .map((item) => {
        const m = { ...item, ...to.place, position }
        position = between(position, to.next)
        return m
      })
    setDays((d) => moved.reduce((acc, m) => withItem(acc, m, m.id), d))
    Promise.all(moved.map((m) => unwrap(api.board[':id'].$patch({ param: { id: m.id }, json: { date: m.date, row: m.row, position: m.position } })))).catch(reload)
  }

  const remove = (ids: string[]) => {
    setDays((d) => ids.reduce((acc, id) => withItem(acc, null, id), d))
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))))
    Promise.all(ids.map((id) => unwrap(api.board[':id'].$delete({ param: { id } })))).catch(reload)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (openId) return
    if (e.key === ' ' || e.key === 'Enter') {
      const id = anchor && selected.has(anchor) ? anchor : [...selected][0]
      if (!id || e.repeat) return
      e.preventDefault()
      // React attaches the viewer's window listener before this keydown bubbles there, where Space would close it again.
      e.stopPropagation()
      setOpenId(id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selected.size) remove([...selected])
    } else if (e.key === 'Escape') setSelected(new Set())
  }

  const accepts = (e: DragEvent) => !!dragIds || e.dataTransfer.types.includes('Files')

  const over = (e: DragEvent, t: Target) => {
    if (!accepts(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = dragIds ? 'move' : 'copy'
    setTarget((prev) => (sameTarget(prev, t) ? prev : t))
  }

  const drop = (e: DragEvent, t: Target | null) => {
    e.preventDefault()
    e.stopPropagation()
    const ids = dragIds
    setTarget(null)
    setDragIds(null)
    if (ids) {
      if (t) move(ids, t)
      return
    }
    const files = mediaFiles(e.dataTransfer.files)
    if (!files.length) return
    const to = t ? placeFor(days, t) : null
    void upload(files, to?.place, to?.next)
  }

  const gap = (date: string, prev?: number, next?: number, empty?: boolean) => {
    const t: Target = { kind: 'gap', date, prev, next }
    return (
      <div
        key={`gap-${prev}`}
        className={[empty ? styles.empty : styles.gap, sameTarget(target, t) && styles.gapOver].filter(Boolean).join(' ')}
        onDragOver={(e) => over(e, t)}
        onDrop={(e) => drop(e, t)}
      >
        {empty && 'Paste images, gifs or videos here (Ctrl+V), or drop files'}
      </div>
    )
  }

  return (
    <div
      className={styles.frame}
      style={{ '--row-h': `${rowHeight}px` } as CSSProperties}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // A click off the tiles clears the selection.
      onClick={(e) => {
        if (!(e.target as Element).closest('[data-tile], [data-keep-selection]')) setSelected(new Set())
      }}
      onPaste={(e) => pasteMedia(e, (files) => void upload(files))}
      // Off the tiles and gaps: no marker; files dropped here go to the end of today.
      onDragOver={(e) => {
        setTarget(null)
        if (e.dataTransfer.types.includes('Files') && !dragIds) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget(null)
      }}
      onDrop={(e) => drop(e, null)}
    >
      <div className={styles.bar} data-keep-selection>
        {uploading > 0 && <span>Uploading {uploading}…</span>}
        <label title="Row height">
          <input type="range" min={MIN_H} max={MAX_H} step={10} value={rowHeight} onChange={(e) => rowHeightStore.set(() => Number(e.target.value))} />
        </label>
      </div>
      {shown.map((day) => {
        const rows = rowsOf(day.items)
        return (
          <section key={day.date} className={styles.day} data-day={day.date}>
            <h3 className={styles.divider}>{dayLabel(day.date)}</h3>
            {rows.length === 0 && loaded
              ? gap(day.date, undefined, undefined, true)
              : rows.map((row, r) => (
                  <div key={row[0]!.row} className={styles.rowWrap}>
                    {r === 0 && gap(day.date, undefined, row[0]!.row)}
                    <div className={styles.row}>
                      {row.map((item) => (
                        <Tile
                          key={item.id}
                          item={item}
                          selected={selected.has(item.id)}
                          dragging={!!dragIds?.includes(item.id)}
                          mark={target?.kind === 'tile' && target.id === item.id && !dragIds?.includes(item.id) ? (target.after ? 'after' : 'before') : undefined}
                          onClick={(e) => {
                            if (!e.shiftKey) return select(item.id)
                            setSelected((s) => {
                              const next = new Set(s)
                              if (!next.delete(item.id)) next.add(item.id)
                              return next
                            })
                            setAnchor(item.id)
                          }}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData(ITEM_TYPE, item.id)
                            // A selected tile takes the rest of the selection along; another one is dragged on its own and selected.
                            if (selected.has(item.id)) setDragIds(all.filter((i) => selected.has(i.id)).map((i) => i.id))
                            else {
                              select(item.id)
                              setDragIds([item.id])
                            }
                          }}
                          onDragEnd={() => {
                            setDragIds(null)
                            setTarget(null)
                          }}
                          onDragOver={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            over(e, { kind: 'tile', id: item.id, after: e.clientX > rect.left + rect.width / 2 })
                          }}
                          onDrop={(e) => drop(e, target)}
                          onOpen={() => {
                            select(item.id)
                            setOpenId(item.id)
                          }}
                          onRemove={() => remove([item.id])}
                        />
                      ))}
                    </div>
                    {gap(day.date, row[0]!.row, rows[r + 1]?.[0]?.row)}
                  </div>
                ))}
          </section>
        )
      })}
      {next && <div ref={more} className={styles.more} />}
      {open && (
        <div className={styles.lightbox} data-keep-selection onClick={() => setOpenId(null)}>
          {isVideo(open) ? <video key={open.id} src={open.url} controls autoPlay onClick={(e) => e.stopPropagation()} /> : <img key={open.id} src={open.url} alt="" />}
          <span className={styles.count}>
            {openAt + 1} / {all.length}
          </span>
        </div>
      )}
    </div>
  )
}

interface TileProps {
  item: BoardItemDTO
  selected: boolean
  dragging: boolean
  mark?: 'before' | 'after'
  onClick: (e: MouseEvent) => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onOpen: () => void
  onRemove: () => void
}

/** One tile: the thumbnail (or a gif as is); a video plays muted while hovered. */
function Tile({ item, selected, dragging, mark, onOpen, onRemove, ...handlers }: TileProps) {
  const [hover, setHover] = useState(false)
  const video = isVideo(item)
  return (
    <div
      className={[styles.tile, selected && styles.selected, dragging && styles.dragging, mark && styles[mark]].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${item.width} / ${item.height}` }}
      data-tile={item.id}
      draggable
      title="Click to select (Shift adds) · double-click or Space to open · drag to move · Delete removes"
      onDoubleClick={onOpen}
      onMouseEnter={() => video && setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...handlers}
    >
      {video && (hover || !item.thumbUrl) ? (
        <video src={item.url} muted loop playsInline autoPlay={hover} preload="metadata" />
      ) : (
        <img src={item.thumbUrl ?? item.url} alt="" draggable={false} loading="lazy" />
      )}
      {video && !hover && <span className={styles.play}>▶</span>}
      <button
        className={styles.delete}
        title="Remove (Delete)"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        ×
      </button>
    </div>
  )
}
