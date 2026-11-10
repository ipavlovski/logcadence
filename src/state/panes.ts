import { isIsoDate, shiftDate, today } from '../../shared/dates.ts'
import type { EntryType } from '../../shared/entryTypes.ts'
import { isEmptyQuery, normalizeQuery, parseQuery, queryToString, typeView, type Query } from '../../shared/query.ts'
import { isUnder, normalizeTag } from '../../shared/tags.ts'
import { persistedStore } from './store.ts'

// Two panes (canvas | tags), each with tabs. A tab is identified by its location key; the first tab of each pane
// is its primary tab, which always exists and cannot be closed.
// The canvas pane's tabs: Today (the primary tab, always today), the days pinned, and the preview day. Opening a day
// shows it in Today, in its pinned tab, or else in the preview day tab, which each opened day replaces until it is
// pinned (double-click). The days opened are a history of their own (alt+left/right while a day tab is active).
// The tags pane's tabs show queries (shared/query.ts): entries by type, category, tags, channel… Its primary tab is
// the preview, which every click on an entry's metadata retargets (empty: the browser of all of them); double-click
// it, or ctrl+click the metadata, for a tab of the query's own.

export type PaneId = 'canvas' | 'tags'
export const PANES: PaneId[] = ['canvas', 'tags']

export type Loc =
  | { kind: 'journal' }
  | { kind: 'day'; date: string }
  | { kind: 'preview-day' }
  | { kind: 'preview' }
  | { kind: 'query'; query: string }

export const PRIMARY: Record<PaneId, string> = { canvas: 'journal', tags: 'preview' }
/** The canvas's preview day tab. */
export const PREVIEW_DAY = 'preview-day'

export function parseKey(key: string): Loc {
  const i = key.indexOf(':')
  const kind = i < 0 ? key : key.slice(0, i)
  const value = i < 0 ? '' : key.slice(i + 1)
  switch (kind) {
    case 'preview':
      return { kind }
    case 'q':
      return { kind: 'query', query: value }
    case 'day':
      return isIsoDate(value) ? { kind, date: value } : { kind: 'journal' }
    case PREVIEW_DAY:
      return { kind: 'preview-day' }
    default:
      return { kind: 'journal' }
  }
}

/** A tags pane tab of its own for a query. */
export const queryKey = (q: Query | string) => `q:${typeof q === 'string' ? normalizeQuery(q) : queryToString(q)}`
export const tagKey = (tag: string) => queryKey({ tags: [tag] })
export const dayKey = (date: string) => `day:${date}`
/** Today, a pinned day or the preview day. */
export const isDayKey = (key: string) => ['journal', 'day', 'preview-day'].includes(parseKey(key).kind)

interface PaneState {
  /** Unused by the canvas pane (see paneTabs). */
  tabs: string[]
  active: string
  /** Visited locations for alt+left/right. */
  history: string[]
  hIndex: number
}

interface PanesState {
  panes: Record<PaneId, PaneState>
  /** Pane that receives pane-scoped shortcuts (ctrl+w, ctrl+f, delete…). */
  focus: PaneId
  /** False while the tags pane is minimized to its tab bar; the canvas is always open. */
  open: Record<PaneId, boolean>
  /** Flex-grow weights of the visible panes. */
  weights: Record<PaneId, number>
  /** The preview day tab's day; null when there is no preview tab. */
  previewDay: string | null
  /** Days with a tab of their own, in tab order. */
  pinnedDays: string[]
  /** The day tab last active (Today, a pinned day or the preview): the journal's day while a plugin tab is shown. */
  dayTab: string
  /** Days opened, for back/forward. */
  dayHistory: string[]
  dayIndex: number
  /** The tags pane's preview tab's query (queryToString); '' is the browser. */
  previewQuery: string
}

const freshPane = (id: PaneId): PaneState => ({ tabs: [PRIMARY[id]], active: PRIMARY[id], history: [PRIMARY[id]], hIndex: 0 })

const initial: PanesState = {
  panes: { canvas: freshPane('canvas'), tags: freshPane('tags') },
  focus: 'canvas',
  open: { canvas: true, tags: true },
  weights: { canvas: 2.1, tags: 1 },
  previewDay: null,
  pinnedDays: [],
  dayTab: PRIMARY.canvas,
  dayHistory: [],
  dayIndex: -1,
  previewQuery: '',
}

function validKey(pane: PaneId, key: string): boolean {
  const loc = parseKey(key)
  if (key !== PRIMARY[pane] && loc.kind === parseKey(PRIMARY[pane]).kind) return false
  switch (pane) {
    case 'canvas':
      return loc.kind === 'journal' || loc.kind === 'day' || loc.kind === 'preview-day'
    case 'tags':
      return loc.kind === 'preview' || (loc.kind === 'query' && !!loc.query)
  }
}

// Tabs saved under a former name or of a tab that's gone: the canvas's plugin tabs (YouTube, Bookmarks, Images, AI,
// and the dashboard and its like before them) became types shown in the tags pane; the tag tree became the
// preview's browser; a tag tab, a query for the tag ('/' paths since 0015_tag_slash).
const renamed = (k: unknown) => {
  if (typeof k !== 'string') return k
  if (k.startsWith('plugin:') || k === 'dashboard') return PRIMARY.canvas
  if (k === 'tree') return PRIMARY.tags
  if (k.startsWith('tag:')) return tagKey(normalizeTag(k.slice(4)))
  if (k.startsWith('q:')) return normalizeQuery(k.slice(2)) ? queryKey(k.slice(2)) : PRIMARY.tags
  return k
}

/** A saved day: null (today, as saved before day tabs) stays today. */
const toDay = (v: unknown): string | undefined => (v === null ? today() : typeof v === 'string' && isIsoDate(v) ? v : undefined)

/** The day a journal pane tab of the three-pane layout showed ('today', 'date:YYYY-MM-DD'). */
const oldJournalDay = (key: unknown): string | null => (typeof key === 'string' && key.startsWith('date:') && isIsoDate(key.slice(5)) ? key.slice(5) : null)

/** Repairs stored pane state, including the three-pane layout's and the single journal tab's. Exported for tests. */
export function revivePanes(stored: unknown): PanesState {
  const s = (stored ?? {}) as Partial<PanesState> & { day?: unknown; panes?: { journal?: { active?: unknown } } }
  const panes = { ...initial.panes }
  for (const id of PANES) {
    const p = s.panes?.[id]
    if (!p || !Array.isArray(p.tabs)) continue
    const valid = (k: unknown): k is string => typeof k === 'string' && validKey(id, k)
    const tabs = [PRIMARY[id], ...new Set(p.tabs.map(renamed).filter(valid).filter((k) => k !== PRIMARY[id]))]
    const history = Array.isArray(p.history) ? p.history.map(renamed).filter(valid).slice(-50) : []
    const active = renamed(p.active)
    panes[id] = {
      tabs,
      active: typeof active === 'string' && (id === 'canvas' ? valid(active) : tabs.includes(active)) ? active : PRIMARY[id],
      history: history.length ? history : [PRIMARY[id]],
      hIndex: Math.min(Math.max(0, p.hIndex ?? 0), Math.max(0, history.length - 1)),
    }
  }
  const open = { canvas: true, tags: typeof s.open?.tags === 'boolean' ? s.open.tags : true }
  const threePane = !!s.panes?.journal
  // The day shown before day tabs (the three-pane layout's journal pane, or the single journal tab) becomes the preview.
  const oldDay = threePane ? oldJournalDay(s.panes!.journal!.active) : 'day' in s ? (toDay(s.day) ?? null) : undefined
  const pinnedDays = Array.isArray(s.pinnedDays) ? [...new Set(s.pinnedDays.filter((d): d is string => typeof d === 'string' && isIsoDate(d)))] : []
  const previewDay = oldDay !== undefined ? (oldDay === today() ? null : oldDay) : typeof s.previewDay === 'string' && isIsoDate(s.previewDay) ? s.previewDay : null
  const dayHistory = !threePane && Array.isArray(s.dayHistory) ? s.dayHistory.map(toDay).filter((d) => d !== undefined).slice(-50) : oldDay ? [oldDay] : []
  const weight = (id: PaneId) => (!threePane && typeof s.weights?.[id] === 'number' ? s.weights[id] : initial.weights[id])
  const weights = { canvas: weight('canvas'), tags: weight('tags') }
  const next: PanesState = {
    panes,
    focus: s.focus && PANES.includes(s.focus) ? s.focus : 'canvas',
    open,
    weights,
    previewDay,
    pinnedDays,
    dayTab: oldDay !== undefined ? (previewDay ? PREVIEW_DAY : PRIMARY.canvas) : typeof s.dayTab === 'string' ? s.dayTab : PRIMARY.canvas,
    dayHistory,
    dayIndex: dayHistory.length ? Math.min(Math.max(0, s.dayIndex ?? dayHistory.length - 1), dayHistory.length - 1) : -1,
    previewQuery: typeof s.previewQuery === 'string' ? normalizeQuery(s.previewQuery) : '',
  }
  // A day tab that's gone (an unpinned day, no preview) gives way to Today.
  const exists = (key: string) => !isDayKey(key) || canvasTabsOf(next).includes(key)
  if (oldDay !== undefined && panes.canvas.active === PRIMARY.canvas && previewDay) panes.canvas = { ...panes.canvas, active: PREVIEW_DAY }
  if (!exists(panes.canvas.active)) panes.canvas = { ...panes.canvas, active: PRIMARY.canvas }
  if (!exists(next.dayTab)) next.dayTab = PRIMARY.canvas
  panes.canvas = { ...panes.canvas, history: panes.canvas.history.filter(exists) }
  if (!panes.canvas.history.length) panes.canvas.history = [PRIMARY.canvas]
  panes.canvas.hIndex = Math.min(panes.canvas.hIndex, panes.canvas.history.length - 1)
  return next
}

export const panesStore = persistedStore<PanesState>('panes.v1', initial, revivePanes)

/** Changes a pane's state; the canvas also remembers the day tab it last showed. */
function update(pane: PaneId, fn: (p: PaneState, s: PanesState) => PaneState) {
  panesStore.set((s) => {
    const next = fn(s.panes[pane], s)
    if (next === s.panes[pane]) return s
    return { ...s, panes: { ...s.panes, [pane]: next }, ...(pane === 'canvas' && isDayKey(next.active) && { dayTab: next.active }) }
  })
}

/** The canvas pane's tabs: Today, the pinned days and the preview day. */
function canvasTabsOf(s: Pick<PanesState, 'pinnedDays' | 'previewDay'>): string[] {
  return [PRIMARY.canvas, ...s.pinnedDays.map(dayKey), ...(s.previewDay ? [PREVIEW_DAY] : [])]
}

/** Tabs of a pane, in tab-bar order. */
export function paneTabs(pane: PaneId, s: PanesState = panesStore.get()): string[] {
  return pane === 'canvas' ? canvasTabsOf(s) : s.panes[pane].tabs
}

/** Shows `key`: activates its tab if open, otherwise opens it in place of the active tab (or a new one). */
function place(pane: PaneId, p: PaneState, key: string, newTab: boolean): PaneState {
  if (pane === 'canvas' || p.tabs.includes(key)) return p.active === key ? p : { ...p, active: key }
  const i = p.tabs.indexOf(p.active)
  const tabs = [...p.tabs]
  if (newTab || p.active === PRIMARY[pane]) tabs.splice(i + 1, 0, key)
  else tabs[i] = key
  return { ...p, tabs, active: key }
}

/** Records the location shown: the active tab's key, or for the tags pane's preview, its query's (`at`). */
function pushHistory(p: PaneState, at = p.active): PaneState {
  if (p.history[p.hIndex] === at) return p
  const history = [...p.history.slice(0, p.hIndex + 1), at].slice(-50)
  return { ...p, history, hIndex: history.length - 1 }
}

/** Where the tags pane's preview is, for its history. */
const previewAt = (query: string) => (query ? queryKey(query) : PRIMARY.tags)

export function setFocus(pane: PaneId) {
  panesStore.set((s) => (s.focus === pane ? s : { ...s, focus: pane }))
}

/** Navigates a pane to a location. Opens the pane if hidden. */
export function openLoc(pane: PaneId, key: string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  panesStore.set((s) => ({ ...s, open: { ...s.open, [pane]: true }, focus: opts.focus ? pane : s.focus }))
  update(pane, (p) => pushHistory(place(pane, p, key, !!opts.newTab)))
}

/** The tab that shows `date`: Today, its pinned tab, or (pinning it with `pin`) the preview. */
function showDay(s: PanesState, date: string, pin: boolean): { s: PanesState; key: string } {
  if (date === today()) return { s, key: PRIMARY.canvas }
  if (s.pinnedDays.includes(date)) return { s, key: dayKey(date) }
  if (pin) return { s: { ...s, pinnedDays: [...s.pinnedDays, date], previewDay: s.previewDay === date ? null : s.previewDay }, key: dayKey(date) }
  return { s: { ...s, previewDay: date }, key: PREVIEW_DAY }
}

function goDay(date: string, opts: { pin?: boolean; focus?: boolean; history?: (s: PanesState) => Pick<PanesState, 'dayHistory' | 'dayIndex'> }) {
  panesStore.set((s0) => {
    const { s } = showDay(s0, date, !!opts.pin)
    return { ...s, ...opts.history?.(s), focus: opts.focus ? 'canvas' : s.focus }
  })
  const key = showDay(panesStore.get(), date, false).key
  update('canvas', (p) => pushHistory({ ...p, active: key }))
}


/**
 * Shows `date`: in Today, in the day's pinned tab, or else in the preview day tab. `newTab` (ctrl+click) pins it
 * instead, in a tab of its own.
 */
export function openDate(date: string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  if (!isIsoDate(date)) return
  goDay(date, {
    pin: opts.newTab,
    focus: opts.focus,
    history: (s) => {
      if (s.dayHistory[s.dayIndex] === date) return s
      const dayHistory = [...s.dayHistory.slice(0, s.dayIndex + 1), date].slice(-50)
      return { dayHistory, dayIndex: dayHistory.length - 1 }
    },
  })
}

/** Back/forward through the days opened. */
export function goDayHistory(dir: 1 | -1) {
  const s = panesStore.get()
  const date = s.dayHistory[s.dayIndex + dir]
  if (date !== undefined) goDay(date, { history: () => ({ dayHistory: s.dayHistory, dayIndex: s.dayIndex + dir }) })
}

/** The day before or after the one shown (ctrl+[ / ctrl+]): a pinned day stays, the step goes to the preview. */
export const stepDay = (dir: 1 | -1) => openDate(shiftDate(activeJournalDate(), dir))

/** Double-click on the preview day tab: the day keeps a tab of its own. */
export function pinPreviewDay() {
  const day = panesStore.get().previewDay
  if (!day) return
  panesStore.set((s) => ({ ...s, previewDay: null, pinnedDays: [...s.pinnedDays.filter((d) => d !== day), day] }))
  update('canvas', (p) => (p.active === PREVIEW_DAY ? { ...p, active: dayKey(day), history: p.history.map((k) => (k === PREVIEW_DAY ? dayKey(day) : k)) } : p))
}

export function activateTab(pane: PaneId, key: string) {
  update(pane, (p, s) => (paneTabs(pane, s).includes(key) ? pushHistory({ ...p, active: key }, pane === 'tags' && key === PRIMARY.tags ? previewAt(s.previewQuery) : key) : p))
}

/** The canvas: closes a pinned day or the preview day; the tab before it takes over. */
function closeCanvasTab(k: string) {
  const s = panesStore.get()
  const tabs = paneTabs('canvas', s)
  const loc = parseKey(k)
  const closable = (loc.kind === 'day' && s.pinnedDays.includes(loc.date)) || (loc.kind === 'preview-day' && !!s.previewDay)
  if (!closable) return
  const gone = (key: string) => key === k
  panesStore.set((st) => ({
    ...st,
    pinnedDays: loc.kind === 'day' ? st.pinnedDays.filter((d) => d !== loc.date) : st.pinnedDays,
    previewDay: loc.kind === 'preview-day' ? null : st.previewDay,
    dayTab: gone(st.dayTab) ? PRIMARY.canvas : st.dayTab,
  }))
  update('canvas', (p) => {
    const history = p.history.filter((h) => !gone(h))
    const rest = { ...p, history: history.length ? history : [PRIMARY.canvas], hIndex: Math.min(p.hIndex, Math.max(0, history.length - 1)) }
    const before = tabs[tabs.indexOf(k) - 1] ?? PRIMARY.canvas
    return p.active === k ? pushHistory({ ...rest, active: before }) : rest
  })
}

export function closeTab(pane: PaneId, key?: string) {
  if (pane === 'canvas') return closeCanvasTab(key ?? panesStore.get().panes.canvas.active)
  update(pane, (p) => {
    const k = key ?? p.active
    if (k === PRIMARY[pane] || !p.tabs.includes(k)) return p
    const i = p.tabs.indexOf(k)
    const tabs = p.tabs.filter((t) => t !== k)
    return pushHistory({ ...p, tabs, active: p.active === k ? tabs[Math.max(0, i - 1)]! : p.active })
  })
}

/** Closes every tab that closes: the tags pane's, the canvas's day tabs (back to Today). */
export function closeAllTabs(pane: PaneId) {
  if (pane === 'canvas') panesStore.set((s) => ({ ...s, pinnedDays: [], previewDay: null, dayTab: PRIMARY.canvas }))
  update(pane, (p) => pushHistory({ ...p, tabs: [PRIMARY[pane]], active: PRIMARY[pane], ...(pane === 'canvas' && { history: [PRIMARY.canvas], hIndex: 0 }) }))
}

export function cycleTab(pane: PaneId, dir: 1 | -1) {
  update(pane, (p, s) => {
    const tabs = paneTabs(pane, s)
    const i = tabs.indexOf(p.active)
    const key = tabs[(i + dir + tabs.length) % tabs.length]!
    return pushHistory({ ...p, active: key }, pane === 'tags' && key === PRIMARY.tags ? previewAt(s.previewQuery) : key)
  })
}

export function goHistory(pane: PaneId, dir: 1 | -1) {
  const p = panesStore.get().panes[pane]
  const hIndex = p.hIndex + dir
  const key = p.history[hIndex]
  if (key == null) return
  // A query that has no tab (any more) shows in the preview.
  if (pane === 'tags' && !p.tabs.includes(key)) {
    const loc = parseKey(key)
    panesStore.set((s) => ({ ...s, previewQuery: loc.kind === 'query' ? loc.query : '' }))
    update(pane, (q) => ({ ...q, active: PRIMARY.tags, hIndex }))
    return
  }
  update(pane, (q) => ({ ...place(pane, q, key, false), hIndex }))
}

/** Minimizes the tags pane to its tab bar or restores it, optionally with new weights in the same update. */
export function setPaneOpen(pane: PaneId, isOpen: boolean, weights: Partial<Record<PaneId, number>> = {}) {
  if (pane === 'canvas' && !isOpen) return
  panesStore.set((s) => ({
    ...s,
    open: { ...s.open, [pane]: isOpen },
    weights: { ...s.weights, ...weights },
    focus: !isOpen && s.focus === pane ? 'canvas' : s.focus,
  }))
}

/** Focuses a pane (ctrl+1/2). A minimized tags pane is restored first when `restore`, otherwise left as is. */
export function focusPane(pane: PaneId, restore: boolean) {
  panesStore.set((s) => (s.open[pane] ? (s.focus === pane ? s : { ...s, focus: pane }) : restore ? { ...s, open: { ...s.open, [pane]: true }, focus: pane } : s))
}

/** Minimizes the tags pane or restores and focuses it (ctrl+t). */
export function togglePane(pane: PaneId) {
  const isOpen = !panesStore.get().open[pane]
  setPaneOpen(pane, isOpen)
  if (isOpen) setFocus(pane)
}

export function setWeights(weights: Partial<Record<PaneId, number>>) {
  panesStore.set((s) => ({ ...s, weights: { ...s.weights, ...weights } }))
}

/** The day a day tab shows (Today: today, rolling over at midnight). */
export function dayOfTab(s: PanesState, key: string): string {
  const loc = parseKey(key)
  return loc.kind === 'day' ? loc.date : loc.kind === 'preview-day' && s.previewDay ? s.previewDay : today()
}

/** The journal's day: the active day tab's, or the last one active while a plugin tab is shown. */
export const activeJournalDate = (): string => journalDateOf(panesStore.get())

/** Store selector: the journal's day. */
export function journalDateOf(s: PanesState): string {
  return dayOfTab(s, isDayKey(s.panes.canvas.active) ? s.panes.canvas.active : s.dayTab)
}

/** Store selector: whether a day tab is the canvas's active tab. */
export const journalActiveOf = (s: PanesState) => isDayKey(s.panes.canvas.active)

/** A tags pane tab's query: the preview's, or the one in its key. */
export function tabQuery(s: PanesState, key: string): string {
  const loc = parseKey(key)
  return loc.kind === 'query' ? loc.query : loc.kind === 'preview' ? s.previewQuery : ''
}

/**
 * Shows a query in the tags pane: in its tab when it has one, in a tab of its own with `newTab` (ctrl+click), else in
 * the preview. Opens the pane if hidden.
 */
export function openQuery(q: Query | string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  const query = typeof q === 'string' ? normalizeQuery(q) : queryToString(q)
  const key = query ? queryKey(query) : PRIMARY.tags
  const { tabs } = panesStore.get().panes.tags
  const inPreview = !tabs.includes(key) && !(opts.newTab && query)
  panesStore.set((s) => ({ ...s, open: { ...s.open, tags: true }, focus: opts.focus ? 'tags' : s.focus, ...(inPreview && { previewQuery: query }) }))
  update('tags', (p) => {
    if (p.tabs.includes(key)) return pushHistory({ ...p, active: key })
    if (inPreview) return pushHistory({ ...p, active: PRIMARY.tags }, previewAt(query))
    const next = [...p.tabs]
    next.splice(p.tabs.indexOf(p.active) + 1, 0, key)
    return pushHistory({ ...p, tabs: next, active: key })
  })
}

export function openTag(tag: string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  const t = normalizeTag(tag)
  if (t) openQuery({ tags: [t] }, opts)
}

/** Narrows or widens the query of a tags pane tab (removing a facet, a view's own filter): the tab shows the new one. */
export function setTabQuery(key: string, q: Query) {
  const query = queryToString(q)
  if (parseKey(key).kind === 'preview' || !query) return openQuery(query)
  const next = queryKey(query)
  if (next === key) return
  update('tags', (p) => {
    const tabs = p.tabs.includes(next) ? p.tabs.filter((t) => t !== key) : p.tabs.map((t) => (t === key ? next : t))
    return pushHistory({ ...p, tabs, active: next })
  })
}

/** Double-click on the preview: its query gets a tab of its own, next to it; the preview goes back to the browser. */
export function pinPreviewQuery() {
  const query = panesStore.get().previewQuery
  if (!query) return
  const key = queryKey(query)
  panesStore.set((s) => ({ ...s, previewQuery: '' }))
  update('tags', (p) => pushHistory({ ...p, tabs: p.tabs.includes(key) ? p.tabs : [PRIMARY.tags, key, ...p.tabs.slice(1)], active: key }))
}

/** The type whose own view the tags pane shows (the bookmarks grid…), while the pane is open; null otherwise. */
export function activeTypeView(s = panesStore.get()): EntryType | null {
  return s.open.tags ? typeView(parseQuery(tabQuery(s, s.panes.tags.active))) : null
}

/** Brings up a type's view (to show an item in it): the tags pane's when it shows that type, else the preview's. */
export function showTypeView(type: EntryType) {
  if (activeTypeView() === type) return focusPane('tags', true)
  openQuery({ types: [type] })
}

/** Rewrites the tags of every query the tags pane shows or remembers; `fn` gives a tag's new path, or null to drop it. */
function mapQueryTags(fn: (tag: string) => string | null) {
  const map = (query: string) => {
    const q = parseQuery(query)
    if (!q.tags?.length) return query
    const tags = q.tags.map(fn).filter((t): t is string => t !== null)
    return queryToString({ ...q, tags: [...new Set(tags)] })
  }
  const mapKey = (key: string) => {
    const loc = parseKey(key)
    if (loc.kind !== 'query') return key
    const query = map(loc.query)
    return query ? queryKey(query) : null
  }
  panesStore.set((s) => ({ ...s, previewQuery: map(s.previewQuery) }))
  update('tags', (p) => {
    const tabs = [...new Set(p.tabs.map(mapKey).filter((k): k is string => k !== null))]
    const history = p.history.map(mapKey).filter((k): k is string => k !== null)
    const active = mapKey(p.active)
    return {
      tabs,
      active: active && tabs.includes(active) ? active : PRIMARY.tags,
      history: history.length ? history : [PRIMARY.tags],
      hIndex: Math.min(p.hIndex, Math.max(0, history.length - 1)),
    }
  })
}

/** After a tag rename/merge: points the queries under `from` at the new path. */
export function renameTagTabs(from: string, to: string) {
  mapQueryTags((t) => (isUnder(t, from) ? to + t.slice(from.length) : t))
}

/** After a tag delete: the queries that were narrowed by it or its subtree aren't any more (a tab of only it closes). */
export function closeTagTabs(tag: string) {
  mapQueryTags((t) => (isUnder(t, tag) ? null : t))
}

export { isEmptyQuery }
