import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import type { EntryDTO } from '../../../shared/types.ts'
import { createEntry } from '../../actions.ts'
import { matches } from '../../markdown.ts'
import { journalStore, requestReveal, setCursor } from '../../state/journal.ts'
import { openDate } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { DayContext, type DayApi, type FocusRequest, type FocusTarget } from './dayContext.ts'
import { EntryCard } from './EntryCard.tsx'
import { useDay } from './useDay.ts'
import styles from './Journal.module.css'

interface Props {
  date: string
  find: string
}

/** One journal day: entries clustered by primary tag (a gap between clusters), each with its child nodes. */
export function JournalDay({ date, find }: Props) {
  const { entries, error, actions } = useDay(date)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const reveal = useStore(journalStore, (s) => s.reveal)
  const nonce = useRef(0)
  const q = find.trim()

  const focusTo = useCallback((t: FocusRequest | null) => setFocus(t && { ...t, n: ++nonce.current }), [])

  // Filtered (ctrl+f) view; the node being edited always stays visible.
  const visible = useMemo(() => {
    if (!entries || !q) return entries ?? []
    const editingId = focus?.kind === 'node' ? focus.nodeId : null
    return entries.flatMap((e) => {
      const head = matches(e.title, q) || e.tags.some((t) => matches(t, q))
      const nodes = head ? e.nodes : e.nodes.filter((n) => n.id === editingId || matches(n.content, q))
      return head || nodes.length ? [{ ...e, nodes }] : []
    })
  }, [entries, q, focus])

  // Entries grouped by primary tag, groups in order of their first entry.
  const groups = useMemo(() => {
    const m = new Map<string, EntryDTO[]>()
    for (const e of visible) m.set(e.tags[0] ?? '', [...(m.get(e.tags[0] ?? '') ?? []), e])
    return [...m]
  }, [visible])

  const orderRef = useRef<EntryDTO[]>([])
  orderRef.current = groups.flatMap(([, list]) => list)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // Keep the journal cursor's tags current (new entries inherit them).
  useEffect(() => {
    const c = journalStore.get().cursor
    const e = c?.date === date ? entries?.find((x) => x.id === c.entryId) : undefined
    if (e) setCursor({ date, entryId: e.id, tags: e.tags })
  }, [entries, date])

  // Reveal requests: a new entry to type into, or an item to scroll to (from the tags pane / search).
  useEffect(() => {
    if (!reveal || reveal.date !== date || !entries?.some((e) => e.id === reveal.entryId)) return
    requestReveal(null)
    if (reveal.mode === 'title') focusTo({ kind: 'title', entryId: reveal.entryId, caret: 'end' })
    else if (reveal.mode === 'node' && reveal.nodeId) focusTo({ kind: 'node', nodeId: reveal.nodeId, caret: 'end' })
    else setFlashId(reveal.nodeId ?? reveal.entryId)
  }, [reveal, entries, date, focusTo])

  useEffect(() => {
    if (!flashId) return
    document.querySelector(`[data-reveal="${CSS.escape(flashId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const t = setTimeout(() => setFlashId(null), 1800)
    return () => clearTimeout(t)
  }, [flashId])

  const dayApi = useMemo<DayApi>(
    () => ({
      ...actions,
      date,
      focusTo,
      blurNode: (nodeId) => setFocus((f) => (f?.kind === 'node' && f.nodeId === nodeId ? null : f)),
      navigate(from, dir) {
        const stops: FocusRequest[] = orderRef.current.flatMap((e) => [
          { kind: 'title' as const, entryId: e.id, caret: 'end' as const },
          ...e.nodes.map((n) => ({ kind: 'node' as const, nodeId: n.id, caret: 'end' as const })),
        ])
        const i = stops.findIndex((s) => (from.nodeId ? s.kind === 'node' && s.nodeId === from.nodeId : s.kind === 'title' && s.entryId === from.entryId))
        const next = stops[i + dir]
        if (next) focusTo({ ...next, caret: dir < 0 ? 'end' : 'start' })
      },
      split(node, before, after) {
        actions.updateNode(node.id, { content: before })
        focusTo({ kind: 'node', nodeId: actions.insertNode(node.entryId, node.id, after), caret: 'start' })
      },
      backspaceAtStart(node, draft) {
        const entry = entriesRef.current?.find((e) => e.id === node.entryId)
        if (!entry || node.images.length) return false
        const i = entry.nodes.findIndex((n) => n.id === node.id)
        const prev = entry.nodes[i - 1]
        if (prev) {
          // Merge into the node above, caret at the join.
          const caret = prev.content.length
          actions.updateNode(prev.id, { content: prev.content + draft })
          actions.deleteNode(node.id)
          focusTo({ kind: 'node', nodeId: prev.id, caret })
          return true
        }
        if (!draft && entry.nodes.length > 1) actions.deleteNode(node.id)
        focusTo({ kind: 'title', entryId: entry.id, caret: 'end' })
        return !draft && entry.nodes.length > 1
      },
      touch(entryId) {
        const e = entriesRef.current?.find((x) => x.id === entryId)
        if (e) setCursor({ date, entryId, tags: e.tags })
      },
    }),
    [actions, date, focusTo],
  )

  const focusFor = (e: EntryDTO) =>
    focus && ((focus.kind === 'title' && focus.entryId === e.id) || (focus.kind === 'node' && e.nodes.some((n) => n.id === focus.nodeId))) ? focus : null

  const nav = (e: React.MouseEvent, d: string) => openDate(d, { newTab: e.ctrlKey || e.metaKey })
  const isToday = date === today()

  return (
    <DayContext.Provider value={dayApi}>
      <div className={styles.day}>
        <header className={styles.dayHeader}>
          <div>
            <h1 className={styles.dayTitle}>{formatJournalDate(date)}</h1>
            <div className={styles.dayMeta}>
              {weekday(date)}
              {isToday && ' · today'}
            </div>
          </div>
          <nav className={styles.dayNav}>
            <button title="Previous day (ctrl+click: new tab)" onClick={(e) => nav(e, shiftDate(date, -1))}>
              ‹
            </button>
            <input type="date" value={date} onChange={(e) => e.target.value && openDate(e.target.value)} aria-label="Go to date" />
            <button title="Next day (ctrl+click: new tab)" onClick={(e) => nav(e, shiftDate(date, 1))}>
              ›
            </button>
            {!isToday && (
              <button title="Today" onClick={(e) => nav(e, today())}>
                today
              </button>
            )}
          </nav>
        </header>

        {error && <p className={styles.error}>Could not load this day: {error}</p>}

        {entries && !entries.length && (
          <button className={styles.empty} onClick={() => createEntry({ date, tags: [] })}>
            No entries yet. Click here or press <kbd>Ctrl+N</kbd> / <kbd>Alt+N</kbd> to start writing.
          </button>
        )}
        {entries && entries.length > 0 && !visible.length && <p className={styles.muted}>Nothing on this day matches “{q}”.</p>}

        {groups.map(([tag, list]) => (
          <section key={tag || '_untagged'} className={styles.group}>
            {list.map((e) => (
              <EntryCard key={e.id} entry={e} focus={focusFor(e)} find={q} flashId={flashId} />
            ))}
          </section>
        ))}

        {entries && entries.length > 0 && (
          <button className={styles.newEntry} onClick={() => createEntry({ date, tags: [] })}>
            + new entry
          </button>
        )}
      </div>
    </DayContext.Provider>
  )
}
