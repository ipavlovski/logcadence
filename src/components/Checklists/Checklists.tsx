import { useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { itemDone, itemTotal, listProgress, SOURCE_LABELS, type ChecklistDayDTO, type ChecklistDayItem } from '../../../shared/checklists.ts'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { bumpChecklists, checklistsVersion, writeMark } from '../../state/checklists.ts'
import { useStore } from '../../state/store.ts'
import { ChecklistManager } from './ChecklistManager.tsx'
import { starterBody, STARTERS } from './starters.ts'
import styles from './Checklists.module.css'

// The dashboard's Checklists section: the checklists due on a day (today unless stepped back), one card each, with
// the last 7 days of each as dots. Ticks are applied at once and saved in the background.

const WEEK = 7

type Lists = ChecklistDayDTO['lists']

export function ChecklistsSection({ tick }: { tick: number }) {
  const version = useStore(checklistsVersion, (v) => v)
  const t = today()
  const [picked, setPicked] = useState<string | null>(null)
  const date = picked && picked < t ? picked : t
  // The dots show the last week, or the week up to the day picked when that is further back.
  const end = date >= shiftDate(t, -(WEEK - 1)) ? t : date
  const from = shiftDate(end, -(WEEK - 1))
  const [managing, setManaging] = useState<false | 'list' | 'new'>(false)
  // Counts set here, until the page is reloaded: they stay put while a refetch is on its way.
  const [local, setLocal] = useState(() => new Map<string, number>())
  const [error, setError] = useState<string>()

  const days = useFetch(`checklist-days|${from}|${end}|${version}|${tick}`, (signal) => unwrap(api.checklists.days.$get({ query: { from, to: end } }, { init: { signal } })))
  const all = useFetch(`checklists|${version}`, (signal) => unwrap(api.checklists.$get({}, { init: { signal } })))

  const byDate = useMemo(() => {
    const out = new Map<string, Lists>()
    for (const d of days.data?.days ?? [])
      out.set(
        d.date,
        d.lists.map((l) => ({ ...l, items: l.items.map((i) => ({ ...i, count: local.get(`${i.id}|${d.date}`) ?? i.count })) })),
      )
    return out
  }, [days.data, local])
  const week = useMemo(() => Array.from({ length: WEEK }, (_, i) => shiftDate(from, i)), [from])

  const set = useCallback((itemId: string, day: string, count: number) => {
    const key = `${itemId}|${day}`
    setLocal((m) => new Map(m).set(key, count))
    setError(undefined)
    writeMark(itemId, day, count).catch((err: Error) => {
      setError(`Not saved: ${err.message}`)
      setLocal((m) => {
        const next = new Map(m)
        next.delete(key)
        return next
      })
      bumpChecklists()
    })
  }, [])

  const [adding, setAdding] = useState(false)
  const addStarters = async () => {
    setAdding(true)
    try {
      for (const s of STARTERS) await unwrap(api.checklists.$post({ json: starterBody(s, t) }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAdding(false)
      bumpChecklists()
    }
  }

  const lists = byDate.get(date)
  const doneCount = lists?.filter((l) => listProgress(l.items) >= 1).length ?? 0
  const none = all.data && !all.data.checklists.length
  const archivedOnly = all.data && all.data.checklists.length > 0 && all.data.checklists.every((c) => c.archived)

  return (
    <section className={styles.section} aria-label="Checklists">
      <header className={styles.head}>
        <h3>Checklists</h3>
        {lists && lists.length > 0 && (
          <span className={`${styles.summary} ${doneCount === lists.length ? styles.allDone : ''}`}>
            {doneCount === lists.length ? 'All done' : `${doneCount} of ${lists.length} done`}
          </span>
        )}
        {error && <span className={styles.error}>{error}</span>}
        <div className={styles.nav}>
          <button onClick={() => setPicked(shiftDate(date, -1))} title="Previous day" aria-label="Previous day">
            ‹
          </button>
          <input type="date" value={date} max={t} onChange={(e) => e.target.value && setPicked(e.target.value)} aria-label="Checklist day" title={`${weekday(date)}, ${formatJournalDate(date)}`} />
          <button onClick={() => setPicked(shiftDate(date, 1))} disabled={date >= t} title="Next day" aria-label="Next day">
            ›
          </button>
          {date !== t && (
            <button onClick={() => setPicked(null)} title="Back to today">
              Today
            </button>
          )}
          <button onClick={() => setManaging('list')} title="Create, edit, schedule, archive and delete checklists">
            Manage
          </button>
        </div>
      </header>

      {days.error ? (
        <p className={styles.error}>{days.error.message}</p>
      ) : none ? (
        <div className={styles.empty}>
          <p>Checklists you fill out every day show up here: checkboxes, and counters with a target (“save 50 posts”) that can count Reddit posts, bookmarks and YouTube videos on their own.</p>
          <div className={styles.emptyActions}>
            <button data-primary onClick={() => setManaging('new')}>
              New checklist
            </button>
            <button onClick={addStarters} disabled={adding} title={STARTERS.map((s) => s.title).join(', ')}>
              {adding ? 'Adding…' : `Add the starter set (${STARTERS.length})`}
            </button>
          </div>
        </div>
      ) : lists && !lists.length ? (
        <p className={styles.muted}>{archivedOnly ? 'Every checklist is archived.' : `No checklists are due on ${date === t ? 'today' : formatJournalDate(date)}.`}</p>
      ) : (
        <div className={styles.cards}>
          {lists?.map((l) => (
            <ListCard key={l.id} list={l} date={date} week={week} byDate={byDate} onPick={(d) => setPicked(d === t ? null : d)} onSet={set} />
          ))}
        </div>
      )}
      {managing && <ChecklistManager startNew={managing === 'new'} onClose={() => setManaging(false)} />}
    </section>
  )
}

const pct = (p: number) => `${Math.round(p * 100)}%`

function ListCard(props: { list: Lists[number]; date: string; week: string[]; byDate: Map<string, Lists>; onPick: (date: string) => void; onSet: (itemId: string, date: string, count: number) => void }) {
  const { list, date } = props
  const progress = listProgress(list.items)
  const done = progress >= 1
  const left = list.items.filter((i) => !itemDone(i)).length

  return (
    <article className={`${styles.card} ${done ? styles.cardDone : ''}`}>
      <header>
        <h4>{list.title}</h4>
        <span className={styles.status}>{done ? 'Done' : list.items.length === 1 ? pct(progress) : `${left} left`}</span>
      </header>
      <div className={styles.meter} role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-label={`${list.title} progress`}>
        <span style={{ width: pct(progress) }} />
      </div>
      <ul className={styles.items}>
        {list.items.map((i) => (
          <ItemRow key={i.id} item={i} onSet={(n) => props.onSet(i.id, date, n)} />
        ))}
      </ul>
      <div className={styles.dots} aria-label="Last 7 days">
        {props.week.map((d) => {
          const l = props.byDate.get(d)?.find((x) => x.id === list.id)
          const p = l ? listProgress(l.items) : null
          return (
            <button
              key={d}
              className={`${d === date ? styles.dotPicked : ''} ${p == null ? styles.dotOff : p >= 1 ? styles.dotFull : ''}`}
              style={p != null && p < 1 ? ({ '--p': pct(p) } as CSSProperties) : undefined}
              onClick={() => props.onPick(d)}
              title={`${weekday(d)}, ${formatJournalDate(d)}: ${p == null ? 'not due' : p >= 1 ? 'done' : `${pct(p)} done`}`}
            >
              <span />
              <i>{weekday(d).slice(0, 1)}</i>
            </button>
          )
        })}
      </div>
    </article>
  )
}

const CHECK = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
)

/** Shift-click steps by 5. */
const step = (e: MouseEvent) => (e.shiftKey ? 5 : 1)

function ItemRow({ item, onSet }: { item: ChecklistDayItem; onSet: (count: number) => void }) {
  const total = itemTotal(item)
  const done = total >= item.target
  const auto = item.auto ?? 0

  // A plain checkbox: the whole row toggles.
  if (item.target === 1 && !item.source)
    return (
      <li className={done ? styles.itemDone : ''}>
        <button className={styles.row} role="checkbox" aria-checked={done} onClick={() => onSet(done ? 0 : 1)}>
          <span className={styles.box}>{done && CHECK}</span>
          <span className={styles.label}>{item.label}</span>
        </button>
      </li>
    )

  const sourced = item.source ? `${auto} ${SOURCE_LABELS[item.source].toLowerCase()} counted on their own${item.count ? `, ${item.count} added by hand` : ''}` : undefined
  return (
    <li className={`${styles.counterItem} ${done ? styles.itemDone : ''}`} style={{ '--fill': pct(Math.min(total / item.target, 1)) } as CSSProperties}>
      <button
        className={styles.box}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Clear ${item.label}` : `Complete ${item.label}`}
        title={done ? 'Clear what was added by hand' : 'Mark it complete'}
        onClick={() => onSet(done ? 0 : Math.max(0, item.target - auto))}
      >
        {done && CHECK}
      </button>
      <span className={styles.label}>
        {item.label}
        {item.source && (
          <span className={styles.auto} title={sourced}>
            auto
          </span>
        )}
      </span>
      <span className={styles.counter}>
        <button onClick={(e) => onSet(Math.max(0, item.count - step(e)))} disabled={item.count === 0} title="One less (shift: 5)" aria-label={`One less ${item.label}`}>
          −
        </button>
        <CountInput total={total} target={item.target} title={sourced} onCommit={(n) => onSet(Math.max(0, n - auto))} />
        <button onClick={(e) => onSet(item.count + step(e))} title="One more (shift: 5)" aria-label={`One more ${item.label}`}>
          +
        </button>
      </span>
    </li>
  )
}

/** "12/25"; click to type the total. */
function CountInput({ total, target, title, onCommit }: { total: number; target: number; title?: string; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false)
  const closed = useRef(false)
  if (!editing)
    return (
      <button
        className={styles.count}
        onClick={() => {
          closed.current = false
          setEditing(true)
        }} title={title ?? 'Click to type a number'}>
        <b>{total}</b>/{target}
      </button>
    )
  const commit = (v: string) => {
    if (closed.current) return
    closed.current = true
    setEditing(false)
    const n = Number(v)
    if (v.trim() !== '' && Number.isInteger(n) && n >= 0 && n !== total) onCommit(n)
  }
  return (
    <input
      className={styles.countInput}
      type="number"
      min={0}
      defaultValue={total}
      autoFocus
      onFocus={(e) => e.target.select()}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value)
        if (e.key === 'Escape') {
          e.stopPropagation()
          closed.current = true
          setEditing(false)
        }
      }}
      aria-label="Count"
    />
  )
}
