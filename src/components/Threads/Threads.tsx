import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { formatJournalDate, today } from '../../../shared/dates.ts'
import type { EntryDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { useRevision } from '../../state/bus.ts'
import { requestReveal } from '../../state/journal.ts'
import { openDate } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { setThreadScale, threadsStore, toggleThread } from '../../state/threads.ts'
import { DONE_TAG, groupThreads, threadRows } from '../../threads.ts'
import { Markdown } from '../Markdown/Markdown.tsx'
import styles from './Threads.module.css'

const ROW_H = 40
const DATE_W = 150
const COL_W = 48
const PALETTE = ['#6d9df0', '#5fb878', '#d9a25f', '#a48be0', '#e08a74', '#7fb4ad', '#d77fb0', '#e0c36b']

interface Hover {
  project: string
  date: string
  rect: DOMRect
}

/** Canvas "Threads" tab: one vertical line per project, one circle per day with "done:<project>" entries. */
export function Threads(_: CanvasPluginProps) {
  const rev = useRevision()
  const scale = useStore(threadsStore, (s) => s.scale)
  const hidden = useStore(threadsStore, (s) => s.hidden)
  const { data, error } = useFetch(`threads|${rev}`, (signal) =>
    unwrap(api.tags.entries.$get({ query: { tag: DONE_TAG, archived: '0', sub: '1' } }, { init: { signal } })),
  )

  const threads = useMemo(() => groupThreads(data?.entries ?? []), [data])
  const projects = useMemo(() => [...threads.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [threads])
  const color = (p: string) => PALETTE[projects.indexOf(p) % PALETTE.length]!
  const visible = useMemo(() => projects.filter((p) => !hidden.includes(p)), [projects, hidden])
  const activeDays = useMemo(() => new Set(visible.flatMap((p) => [...threads.get(p)!.keys()])), [threads, visible])
  const end = today()
  const rows = useMemo(() => threadRows(activeDays, end, scale), [activeDays, end, scale])
  const rowOf = useMemo(() => new Map(rows.map((d, i) => [d, i])), [rows])

  const scroller = useRef<HTMLDivElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const keepOpen = () => clearTimeout(closeTimer.current)
  const closeSoon = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setHover(null), 160)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // The lines fade out towards the top of the viewport: the mask spans exactly the visible area.
  const updateFade = () => {
    const sc = scroller.current
    const tl = timeline.current
    if (!sc || !tl) return
    tl.style.setProperty('--fade-y', `${sc.scrollTop - tl.offsetTop}px`)
    tl.style.setProperty('--fade-h', `${sc.clientHeight}px`)
  }
  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const ro = new ResizeObserver(updateFade)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [])

  // Start at the bottom, where the threads end today.
  const shownFor = useRef('')
  useLayoutEffect(() => {
    const key = `${scale}|${rows.length > 0}`
    if (!rows.length || shownFor.current === key) return
    shownFor.current = key
    const sc = scroller.current
    if (sc) sc.scrollTop = sc.scrollHeight
    updateFade()
  }, [rows, scale])

  const width = DATE_W + visible.length * COL_W
  const y = (date: string) => rowOf.get(date)! * ROW_H + ROW_H / 2
  const x = (i: number) => DATE_W + i * COL_W + COL_W / 2
  const hoverEntries = hover ? threads.get(hover.project)?.get(hover.date) : undefined

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Threads</h2>
        <div className={styles.scale} role="group" aria-label="Scale">
          <button className={scale === 'true' ? styles.on : ''} title="One row per calendar day, gaps included" onClick={() => setThreadScale('true')}>
            true scale
          </button>
          <button className={scale === 'compact' ? styles.on : ''} title="Only days with progress" onClick={() => setThreadScale('compact')}>
            compact
          </button>
        </div>
        <div className={styles.legend}>
          {projects.map((p) => (
            <button
              key={p}
              className={`${styles.project} ${hidden.includes(p) ? styles.off : ''}`}
              style={{ '--c': color(p) } as CSSProperties}
              title={hidden.includes(p) ? `Show ${p}` : `Hide ${p}`}
              onClick={() => toggleThread(p)}
            >
              <span className={styles.swatch} />
              {p}
            </button>
          ))}
        </div>
      </header>

      <div
        ref={scroller}
        className={styles.scroller}
        onScroll={() => {
          updateFade()
          setHover(null)
        }}
      >
        {error && <p className={styles.error}>{error.message}</p>}
        {data && !projects.length && (
          <p className={styles.muted}>
            No threads yet. Tag a journal entry <code>done:&lt;project&gt;</code> to mark progress on that project for the day.
          </p>
        )}
        {data && projects.length > 0 && !visible.length && <p className={styles.muted}>All projects are hidden.</p>}

        {rows.length > 0 && (
          <div ref={timeline} className={styles.timeline} style={{ height: rows.length * ROW_H, width }}>
            {rows.map((d, i) => (
              <button
                key={d}
                className={`${styles.date} ${activeDays.has(d) ? '' : styles.idle} ${d === end ? styles.today : ''}`}
                style={{ top: i * ROW_H, height: ROW_H, width: DATE_W - 16 }}
                title="Open in journal (ctrl+click: new tab)"
                onClick={(e) => openDate(d, { newTab: e.ctrlKey || e.metaKey, focus: true })}
              >
                {formatJournalDate(d)}
              </button>
            ))}

            <div className={styles.lines}>
              {visible.map((p, i) => {
                const first = [...threads.get(p)!.keys()].sort()[0]!
                const top = y(first) - ROW_H / 2
                return (
                  <div
                    key={p}
                    className={styles.line}
                    style={{ left: x(i) - 1, top, height: y(rows[rows.length - 1]!) - top, background: color(p) }}
                  />
                )
              })}
            </div>

            {visible.map((p, i) =>
              [...threads.get(p)!].map(([d, list]) => (
                <button
                  key={`${p}|${d}`}
                  className={`${styles.dot} ${hover?.project === p && hover.date === d ? styles.hot : ''}`}
                  style={{ left: x(i), top: y(d), '--c': color(p) } as CSSProperties}
                  aria-label={`${p}: ${list.length} done on ${formatJournalDate(d)}`}
                  onMouseEnter={(e) => {
                    keepOpen()
                    setHover({ project: p, date: d, rect: e.currentTarget.getBoundingClientRect() })
                  }}
                  onMouseLeave={closeSoon}
                  onClick={(e) => revealIn(list[0]!, undefined, e.ctrlKey || e.metaKey)}
                />
              )),
            )}
          </div>
        )}
      </div>

      {hover && hoverEntries && (
        <DonePopover key={`${hover.project}|${hover.date}`} hover={hover} color={color(hover.project)} entries={hoverEntries} onEnter={keepOpen} onLeave={closeSoon} />
      )}
    </div>
  )
}

function revealIn(entry: EntryDTO, nodeId?: string, newTab = false) {
  openDate(entry.date, { newTab, focus: true })
  requestReveal({ date: entry.date, entryId: entry.id, nodeId, mode: 'flash' })
}

function DonePopover({ hover, color, entries, onEnter, onLeave }: { hover: Hover; color: string; entries: EntryDTO[]; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: hover.rect.right + 10, top: hover.rect.top - 8 })

  // Keep the card on screen: flip to the dot's left side and clamp vertically.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    let left = hover.rect.right + 10
    if (left + width > window.innerWidth - pad) left = Math.max(pad, hover.rect.left - 10 - width)
    const top = Math.max(pad, Math.min(hover.rect.top - 8, window.innerHeight - pad - height))
    setPos({ left, top })
  }, [hover])

  return (
    <div ref={ref} className={styles.popover} style={{ ...pos, '--c': color } as CSSProperties} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className={styles.popHead}>
        <span className={styles.swatch} />
        <strong>{hover.project}</strong>
        <span className={styles.muted}>{formatJournalDate(hover.date)}</span>
      </div>
      {entries.map((entry) => {
        const thumb = entry.nodes.find((n) => n.images.length)?.images[0]
        const nodes = entry.nodes.filter((n) => n.content.trim())
        return (
          <article key={entry.id} className={styles.done} title="Open in journal" onClick={() => revealIn(entry)}>
            <div className={styles.doneHead}>
              <div className={styles.doneTitle}>{entry.title || <span className={styles.muted}>untitled</span>}</div>
              {thumb && <img className={styles.thumb} src={thumb.url} alt="" loading="lazy" />}
            </div>
            {nodes.length > 0 && (
              <ul className={styles.nodes}>
                {nodes.map((n) => (
                  <li
                    key={n.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      revealIn(entry, n.id)
                    }}
                  >
                    <Markdown source={n.content} />
                  </li>
                ))}
              </ul>
            )}
          </article>
        )
      })}
    </div>
  )
}
