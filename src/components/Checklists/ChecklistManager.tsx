import { useEffect, useMemo, useRef, useState } from 'react'
import { CHECKLIST_SOURCES, EVERY_DAY, SOURCE_LABELS, spanDays, WEEKDAYS_ONLY, type ChecklistBody, type ChecklistDTO, type ChecklistSource } from '../../../shared/checklists.ts'
import { formatJournalDate, shiftDate, today } from '../../../shared/dates.ts'
import { newId } from '../../../shared/id.ts'
import { api, unwrap } from '../../api.ts'
import { bumpChecklists } from '../../state/checklists.ts'
import { Modal } from '../Modal/Modal.tsx'
import { starterBody, STARTERS } from './starters.ts'
import styles from './Checklists.module.css'

// The Manage checklists window: the checklists on the left (active, then archived), the one picked on the right
// with its items, how long it runs and on which days, and archive/delete.

interface DraftItem {
  key: string
  id?: string
  label: string
  target: string
  source: ChecklistSource | null
}

interface Draft {
  id?: string
  title: string
  startDate: string
  endDate: string | null
  weekdays: number
  archived: boolean
  items: DraftItem[]
}

const blankItem = (): DraftItem => ({ key: newId(), label: '', target: '1', source: null })
const newDraft = (): Draft => ({ title: '', startDate: today(), endDate: null, weekdays: EVERY_DAY, archived: false, items: [blankItem()] })
const toDraft = (c: ChecklistDTO): Draft => ({
  ...c,
  items: c.items.map((i) => ({ key: i.id, id: i.id, label: i.label, target: String(i.target), source: i.source })),
})

/** The draft as the server takes it, or what's missing. */
function toBody(d: Draft): ChecklistBody | string {
  if (!d.title.trim()) return 'Give it a title'
  const items = d.items.filter((i) => i.label.trim())
  if (!items.length) return 'Add at least one item'
  for (const i of items) {
    const n = Number(i.target)
    if (!Number.isInteger(n) || n < 1) return `“${i.label.trim()}” needs a target of 1 or more`
  }
  if (!d.startDate) return 'Pick a start date'
  if (d.endDate && d.endDate < d.startDate) return 'The end date is before the start date'
  if (!d.weekdays) return 'Pick at least one day of the week'
  return {
    title: d.title.trim(),
    startDate: d.startDate,
    endDate: d.endDate,
    weekdays: d.weekdays,
    items: items.map((i) => ({ ...(i.id && { id: i.id }), label: i.label.trim(), target: Number(i.target), source: i.source })),
  }
}

// Monday first, as bits of Date.getDay().
const DAYS = [1, 2, 3, 4, 5, 6, 0].map((bit) => ({ bit, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][bit]! }))

function describeDays(w: number): string {
  if (w === EVERY_DAY) return 'Every day'
  if (w === WEEKDAYS_ONLY) return 'Weekdays'
  if (w === 0b100_0001) return 'Weekends'
  return DAYS.filter((d) => w & (1 << d.bit))
    .map((d) => d.label)
    .join(', ')
}

const short = (iso: string) => formatJournalDate(iso).replace(/, \d{4}$/, '')

function describeRun(c: Pick<ChecklistDTO, 'startDate' | 'endDate'>): string {
  const t = today()
  if (c.startDate > t) return `starts ${short(c.startDate)}`
  if (!c.endDate) return 'ongoing'
  return c.endDate < t ? `ended ${short(c.endDate)}` : `until ${short(c.endDate)}`
}

export function ChecklistManager({ onClose, startNew }: { onClose: () => void; startNew?: boolean }) {
  const [lists, setLists] = useState<ChecklistDTO[]>()
  const [draft, setDraft] = useState<Draft | null>(startNew ? newDraft() : null)
  const [pristine, setPristine] = useState(() => (startNew ? JSON.stringify(newDraftShape(draft)) : ''))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const load = () =>
    unwrap(api.checklists.$get()).then(
      (r) => {
        setLists(r.checklists)
        return r.checklists
      },
      (err: Error) => {
        setError(err.message)
        return []
      },
    )

  useEffect(() => {
    void load().then((all) => {
      if (!startNew && all[0]) open(toDraft(all.find((c) => !c.archived) ?? all[0]))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = draft != null && JSON.stringify(newDraftShape(draft)) !== pristine
  const okToLeave = () => !dirty || confirm('Discard the changes to this checklist?')

  function open(d: Draft) {
    setDraft(d)
    setPristine(JSON.stringify(newDraftShape(d)))
    setError(undefined)
  }

  const close = () => okToLeave() && onClose()

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      if (!draft) return
      const body = toBody(draft)
      if (typeof body === 'string') return setError(body)
      const saved = draft.id
        ? await unwrap(api.checklists[':id'].$patch({ param: { id: draft.id }, json: body }))
        : await unwrap(api.checklists.$post({ json: body }))
      await load()
      open(toDraft(saved))
      bumpChecklists()
    })

  const setArchived = (archived: boolean) =>
    run(async () => {
      if (!draft?.id) return
      const saved = await unwrap(api.checklists[':id'].$patch({ param: { id: draft.id }, json: { archived } }))
      await load()
      // Keep unsaved edits; only the archived flag changes.
      setDraft((d) => d && { ...d, archived: saved.archived })
      setPristine((p) => JSON.stringify({ ...JSON.parse(p), archived: saved.archived }))
      bumpChecklists()
    })

  const remove = () =>
    run(async () => {
      if (!draft?.id || !confirm(`Delete “${draft.title}” and everything ticked on it? Archiving hides it and keeps its history.`)) return
      await unwrap(api.checklists[':id'].$delete({ param: { id: draft.id } }))
      const all = await load()
      const next = all.find((c) => !c.archived) ?? all[0]
      if (next) open(toDraft(next))
      else setDraft(null)
      bumpChecklists()
    })

  const move = (id: string, by: -1 | 1) =>
    run(async () => {
      if (!lists) return
      const active = lists.filter((c) => !c.archived)
      const i = active.findIndex((c) => c.id === id)
      const j = i + by
      if (i < 0 || j < 0 || j >= active.length) return
      ;[active[i], active[j]] = [active[j]!, active[i]!]
      const r = await unwrap(api.checklists.order.$put({ json: { ids: [...active, ...lists.filter((c) => c.archived)].map((c) => c.id) } }))
      setLists(r.checklists)
      bumpChecklists()
    })

  const addStarters = () =>
    run(async () => {
      for (const s of STARTERS) await unwrap(api.checklists.$post({ json: starterBody(s, today()) }))
      const all = await load()
      if (all[0]) open(toDraft(all[0]))
      bumpChecklists()
    })

  const active = lists?.filter((c) => !c.archived) ?? []
  const archived = lists?.filter((c) => c.archived) ?? []

  const navItem = (c: ChecklistDTO, i: number) => (
    <li key={c.id} className={draft?.id === c.id ? styles.selected : ''}>
      <button className={styles.navPick} onClick={() => draft?.id !== c.id && okToLeave() && open(toDraft(c))}>
        <span>{c.title}</span>
        <small>
          {c.items.length} item{c.items.length === 1 ? '' : 's'} · {describeDays(c.weekdays)} · {describeRun(c)}
        </small>
      </button>
      {!c.archived && (
        <span className={styles.move}>
          <button onClick={() => move(c.id, -1)} disabled={busy || i === 0} title="Move up" aria-label={`Move ${c.title} up`}>
            ↑
          </button>
          <button onClick={() => move(c.id, 1)} disabled={busy || i === active.length - 1} title="Move down" aria-label={`Move ${c.title} down`}>
            ↓
          </button>
        </span>
      )}
    </li>
  )

  return (
    <Modal large className={styles.manager} title="Checklists" onClose={close}>
      <header className={styles.managerHead}>
        <h2>Checklists</h2>
        <button onClick={close}>Close</button>
      </header>
      <div className={styles.managerBody}>
        <nav className={styles.managerNav} aria-label="Checklists">
          <button className={styles.newButton} onClick={() => okToLeave() && open(newDraft())}>
            + New checklist
          </button>
          {active.length > 0 && <ul>{active.map(navItem)}</ul>}
          {archived.length > 0 && (
            <>
              <h3>Archived</h3>
              <ul>{archived.map(navItem)}</ul>
            </>
          )}
          {lists && !lists.length && (
            <button className={styles.starterButton} onClick={addStarters} disabled={busy} title={STARTERS.map((s) => s.title).join(', ')}>
              Add the starter set ({STARTERS.length})
            </button>
          )}
        </nav>
        <article className={styles.editor}>
          {draft ? (
            <Editor key={draft.id ?? 'new'} draft={draft} onChange={setDraft} />
          ) : (
            <p className={styles.muted}>{lists ? 'Pick a checklist, or make a new one.' : 'Loading…'}</p>
          )}
          {draft && (
            <footer className={styles.editorFoot}>
              {draft.id && (
                <>
                  <button onClick={() => setArchived(!draft.archived)} disabled={busy} title={draft.archived ? 'Show it on the dashboard again' : 'Hide it from the dashboard, keeping its history'}>
                    {draft.archived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button data-danger onClick={remove} disabled={busy}>
                    Delete
                  </button>
                </>
              )}
              {error && <span className={styles.error}>{error}</span>}
              <span className={styles.spacer} />
              {dirty && draft.id && (
                <button onClick={() => open(toDraft(lists!.find((c) => c.id === draft.id)!))} disabled={busy}>
                  Revert
                </button>
              )}
              <button data-primary onClick={save} disabled={busy || !dirty}>
                {draft.id ? 'Save' : 'Create'}
              </button>
            </footer>
          )}
        </article>
      </div>
    </Modal>
  )
}

/** What the dirty check compares: item keys are left out, so a blank new item doesn't count as a change. */
function newDraftShape(d: Draft | null) {
  return d && { ...d, items: d.items.filter((i) => i.id || i.label.trim()).map(({ key: _, ...i }) => i) }
}

type EndMode = 'ongoing' | 'days' | 'date'

function Editor({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const setItem = (key: string, patch: Partial<DraftItem>) => set({ items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) })
  const focusKey = useRef<string | null>(null)
  // Keyed by checklist, so a different one starts over with its end shown as a number of days.
  const [endMode, setEndMode] = useState<EndMode>(draft.endDate ? 'days' : 'ongoing')
  const days = draft.endDate ? spanDays(draft.startDate, draft.endDate) : 30

  const addItem = (after?: string) => {
    const item = blankItem()
    focusKey.current = item.key
    const at = after ? draft.items.findIndex((i) => i.key === after) + 1 : draft.items.length
    set({ items: [...draft.items.slice(0, at), item, ...draft.items.slice(at)] })
  }
  const moveItem = (key: string, by: -1 | 1) => {
    const items = [...draft.items]
    const i = items.findIndex((x) => x.key === key)
    const j = i + by
    if (j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j]!, items[i]!]
    set({ items })
  }

  const range = useMemo(() => {
    if (!draft.endDate || draft.endDate < draft.startDate) return null
    const n = spanDays(draft.startDate, draft.endDate)
    return `${formatJournalDate(draft.startDate)} → ${formatJournalDate(draft.endDate)} (${n} day${n === 1 ? '' : 's'})`
  }, [draft.startDate, draft.endDate])

  return (
    <div className={styles.form}>
      <input className={styles.titleInput} value={draft.title} placeholder="Checklist title" onChange={(e) => set({ title: e.target.value })} autoFocus={!draft.id} aria-label="Title" />
      {draft.archived && <p className={styles.archivedNote}>Archived: hidden from the dashboard. Its history is kept.</p>}

      <h3>Items</h3>
      <p className={styles.hint}>A target of 1 is a checkbox; more is a counter. An item can count on its own from the app’s Reddit, Bookmarks and YouTube tabs, and +/− add to that.</p>
      <ul className={styles.itemEditor}>
        <li className={styles.itemHead} aria-hidden>
          <span>Item</span>
          <span>Target</span>
          <span>Counts</span>
        </li>
        {draft.items.map((i, idx) => (
          <li key={i.key}>
            <input
              value={i.label}
              placeholder="e.g. Save posts"
              ref={(el) => {
                if (el && focusKey.current === i.key) {
                  focusKey.current = null
                  el.focus()
                }
              }}
              onChange={(e) => setItem(i.key, { label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addItem(i.key)
                if (e.key === 'Backspace' && !i.label && draft.items.length > 1) {
                  e.preventDefault()
                  focusKey.current = draft.items[idx - 1]?.key ?? draft.items[idx + 1]?.key ?? null
                  set({ items: draft.items.filter((x) => x.key !== i.key) })
                }
              }}
              aria-label="Item"
            />
            <input className={styles.targetInput} type="number" min={1} value={i.target} onChange={(e) => setItem(i.key, { target: e.target.value })} aria-label="Target" />
            <select value={i.source ?? ''} onChange={(e) => setItem(i.key, { source: (e.target.value || null) as ChecklistSource | null })} aria-label="Counts">
              <option value="">By hand</option>
              {CHECKLIST_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            <span className={styles.itemTools}>
              <button onClick={() => moveItem(i.key, -1)} disabled={idx === 0} title="Move up" aria-label="Move up">
                ↑
              </button>
              <button onClick={() => moveItem(i.key, 1)} disabled={idx === draft.items.length - 1} title="Move down" aria-label="Move down">
                ↓
              </button>
              <button onClick={() => set({ items: draft.items.length > 1 ? draft.items.filter((x) => x.key !== i.key) : [blankItem()] })} title="Remove (days it was ticked keep it)" aria-label="Remove item">
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button className={styles.addItem} onClick={() => addItem()}>
        + Add item
      </button>

      <h3>Runs</h3>
      <div className={styles.fieldRow}>
        <label>
          <span>Starts</span>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => {
              const start = e.target.value
              if (!start) return
              // "For N days" keeps its length when the start moves.
              set({ startDate: start, endDate: endMode === 'days' && draft.endDate ? shiftDate(start, days - 1) : draft.endDate })
            }}
          />
        </label>
        <div className={styles.segmented} role="radiogroup" aria-label="Ends">
          {(
            [
              ['ongoing', 'Ongoing'],
              ['days', 'For a number of days'],
              ['date', 'Until a date'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              role="radio"
              aria-checked={endMode === mode}
              className={endMode === mode ? styles.on : ''}
              onClick={() => {
                setEndMode(mode)
                set({ endDate: mode === 'ongoing' ? null : (draft.endDate ?? shiftDate(draft.startDate, 29)) })
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {endMode === 'days' && (
          <label>
            <input className={styles.targetInput} type="number" min={1} value={days} onChange={(e) => Number(e.target.value) >= 1 && set({ endDate: shiftDate(draft.startDate, Math.floor(Number(e.target.value)) - 1) })} aria-label="Days" />
            <span>days</span>
          </label>
        )}
        {endMode === 'date' && (
          <label>
            <span>Ends</span>
            <input type="date" value={draft.endDate ?? ''} min={draft.startDate} onChange={(e) => e.target.value && set({ endDate: e.target.value })} />
          </label>
        )}
      </div>
      <p className={styles.hint}>{range ?? `From ${formatJournalDate(draft.startDate)}, with no end.`}</p>

      <h3>On</h3>
      <div className={styles.fieldRow}>
        <div className={styles.weekdays} role="group" aria-label="Days of the week">
          {DAYS.map((d) => {
            const on = (draft.weekdays & (1 << d.bit)) !== 0
            return (
              <button key={d.bit} className={on ? styles.on : ''} aria-pressed={on} onClick={() => set({ weekdays: draft.weekdays ^ (1 << d.bit) })}>
                {d.label}
              </button>
            )
          })}
        </div>
        <button className={styles.link} onClick={() => set({ weekdays: EVERY_DAY })}>
          Every day
        </button>
        <button className={styles.link} onClick={() => set({ weekdays: WEEKDAYS_ONLY })}>
          Weekdays
        </button>
      </div>
    </div>
  )
}
