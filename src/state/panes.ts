import { isIsoDate, today } from '../../shared/dates.ts'
import { isUnder, normalizeTag } from '../../shared/tags.ts'
import { visibleCanvasTabs } from './canvasTabs.ts'
import { persistedStore } from './store.ts'

// Two panes (canvas | tags), each with tabs. A tab is identified by its location key; the first tab of each pane
// is its primary tab, which always exists and cannot be closed.
// The canvas pane's tabs are fixed: the journal and one per plugin shown (state/canvasTabs.ts), plus a hidden
// plugin's tab while it is active. The journal tab shows one day (`day`) and keeps its own history of the days
// visited (alt+left/right while it is active).

export type PaneId = 'canvas' | 'tags'
export const PANES: PaneId[] = ['canvas', 'tags']

export type Loc = { kind: 'journal' } | { kind: 'plugin'; type: string } | { kind: 'tree' } | { kind: 'tag'; tag: string }

export const PRIMARY: Record<PaneId, string> = { canvas: 'journal', tags: 'tree' }

export function parseKey(key: string): Loc {
  const i = key.indexOf(':')
  const kind = i < 0 ? key : key.slice(0, i)
  const value = i < 0 ? '' : key.slice(i + 1)
  switch (kind) {
    case 'plugin':
      return { kind, type: value }
    case 'tag':
      return { kind, tag: value }
    case 'tree':
      return { kind }
    default:
      return { kind: 'journal' }
  }
}

export const tagKey = (tag: string) => `tag:${tag}`
export const pluginKey = (type: string) => `plugin:${type}`

interface PaneState {
  /** Unused by the canvas pane (see paneTabs). */
  tabs: string[]
  active: string
  /** Visited locations for alt+left/right. */
  history: string[]
  hIndex: number
}

/** The journal tab's day: null is today (it rolls over at midnight). */
type Day = string | null

interface PanesState {
  panes: Record<PaneId, PaneState>
  /** Pane that receives pane-scoped shortcuts (ctrl+w, ctrl+f, delete…). */
  focus: PaneId
  /** False while the tags pane is minimized to its tab bar; the canvas is always open. */
  open: Record<PaneId, boolean>
  /** Flex-grow weights of the visible panes. */
  weights: Record<PaneId, number>
  /** The day the journal tab shows. */
  day: Day
  /** Days the journal tab visited, for its back/forward. */
  dayHistory: Day[]
  dayIndex: number
}

const freshPane = (id: PaneId): PaneState => ({ tabs: [PRIMARY[id]], active: PRIMARY[id], history: [PRIMARY[id]], hIndex: 0 })

const initial: PanesState = {
  panes: { canvas: freshPane('canvas'), tags: freshPane('tags') },
  focus: 'canvas',
  open: { canvas: true, tags: true },
  weights: { canvas: 2.1, tags: 1 },
  day: null,
  dayHistory: [null],
  dayIndex: 0,
}

function validKey(pane: PaneId, key: string): boolean {
  const loc = parseKey(key)
  if (key !== PRIMARY[pane] && loc.kind === parseKey(PRIMARY[pane]).kind) return false
  switch (pane) {
    case 'canvas':
      return loc.kind === 'journal' || loc.kind === 'plugin'
    case 'tags':
      return loc.kind === 'tree' || (loc.kind === 'tag' && !!loc.tag)
  }
}

// Tabs saved under a former name or of a tab that's gone: the Shortcuts plugin became a window (ctrl+shift+?),
// Spotify moved out of the app, Reddit merged into Bookmarks, and the dashboard, Map, Progress and Activity moved to logtracker.
// Tag tabs saved while ':' separated tags (before 0015_tag_slash) take the '/' path.
const RENAMED: Record<string, string> = {
  'plugin:threads': 'journal',
  'plugin:shortcuts': 'journal',
  'plugin:spotify': 'journal',
  'plugin:reddit': 'plugin:bookmarks',
  'plugin:map': 'journal',
  'plugin:progress': 'journal',
  'plugin:activity': 'journal',
  dashboard: 'journal',
}
const renamed = (k: unknown) => (typeof k !== 'string' ? k : k.startsWith('tag:') ? tagKey(normalizeTag(k.slice(4))) : (RENAMED[k] ?? k))

const toDay = (v: unknown): Day | undefined => (v === null ? null : typeof v === 'string' && isIsoDate(v) ? (v === today() ? null : v) : undefined)

/** The day a journal pane tab of the three-pane layout showed ('today', 'date:YYYY-MM-DD'). */
const oldJournalDay = (key: unknown): Day => (typeof key === 'string' && key.startsWith('date:') ? (toDay(key.slice(5)) ?? null) : null)

/** Repairs stored pane state, including the three-pane layout's. Exported for tests. */
export function revivePanes(stored: unknown): PanesState {
  const s = stored as Partial<PanesState> & { panes?: { journal?: { active?: unknown } } }
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
      active: typeof active === 'string' && tabs.includes(active) ? active : PRIMARY[id],
      history: history.length ? history : [PRIMARY[id]],
      hIndex: Math.min(Math.max(0, p.hIndex ?? 0), Math.max(0, history.length - 1)),
    }
  }
  const open = { canvas: true, tags: typeof s.open?.tags === 'boolean' ? s.open.tags : true }
  // Saved by the three-pane layout: the journal pane's active tab becomes the journal tab's day.
  const threePane = !!s.panes?.journal
  const day = threePane ? oldJournalDay(s.panes!.journal!.active) : (toDay(s.day) ?? null)
  const dayHistory = !threePane && Array.isArray(s.dayHistory) ? s.dayHistory.map(toDay).filter((d) => d !== undefined).slice(-50) : []
  const weight = (id: PaneId) => (!threePane && typeof s.weights?.[id] === 'number' ? s.weights[id] : initial.weights[id])
  const weights = { canvas: weight('canvas'), tags: weight('tags') }
  return {
    panes,
    focus: s.focus && PANES.includes(s.focus) ? s.focus : 'canvas',
    open,
    weights,
    day,
    dayHistory: dayHistory.length ? dayHistory : [day],
    dayIndex: dayHistory.length ? Math.min(Math.max(0, s.dayIndex ?? 0), dayHistory.length - 1) : 0,
  }
}

export const panesStore = persistedStore<PanesState>('panes.v1', initial, revivePanes)

function update(pane: PaneId, fn: (p: PaneState) => PaneState) {
  panesStore.set((s) => {
    const next = fn(s.panes[pane])
    return next === s.panes[pane] ? s : { ...s, panes: { ...s.panes, [pane]: next } }
  })
}

/** The canvas pane's fixed tabs: the journal and the plugins shown. */
const canvasTabs = () => [PRIMARY.canvas, ...visibleCanvasTabs().map(pluginKey)]

/** Tabs of a pane, in tab-bar order. */
export function paneTabs(pane: PaneId, p: PaneState): string[] {
  if (pane !== 'canvas') return p.tabs
  const tabs = canvasTabs()
  return tabs.includes(p.active) ? tabs : [...tabs, p.active]
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

function pushHistory(p: PaneState): PaneState {
  if (p.history[p.hIndex] === p.active) return p
  const history = [...p.history.slice(0, p.hIndex + 1), p.active].slice(-50)
  return { ...p, history, hIndex: history.length - 1 }
}

export function setFocus(pane: PaneId) {
  panesStore.set((s) => (s.focus === pane ? s : { ...s, focus: pane }))
}

/** Navigates a pane to a location. Opens the pane if hidden. */
export function openLoc(pane: PaneId, key: string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  panesStore.set((s) => ({ ...s, open: { ...s.open, [pane]: true }, focus: opts.focus ? pane : s.focus }))
  update(pane, (p) => pushHistory(place(pane, p, key, !!opts.newTab)))
}

export function openTag(tag: string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  const t = normalizeTag(tag)
  if (t) openLoc('tags', tagKey(t), opts)
}

/** Shows `date` in the journal tab. `newTab` is accepted for the callers' ctrl+click, but there's one journal tab. */
export function openDate(date: string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  if (!isIsoDate(date)) return
  const day = date === today() ? null : date
  panesStore.set((s) => {
    if (s.day === day) return s
    const dayHistory = [...s.dayHistory.slice(0, s.dayIndex + 1), day].slice(-50)
    return { ...s, day, dayHistory, dayIndex: dayHistory.length - 1 }
  })
  openLoc('canvas', PRIMARY.canvas, { focus: opts.focus })
}

/** The journal tab's back/forward through the days it showed. */
export function goDayHistory(dir: 1 | -1) {
  panesStore.set((s) => {
    const dayIndex = s.dayIndex + dir
    const day = s.dayHistory[dayIndex]
    return day === undefined ? s : { ...s, day, dayIndex }
  })
}

export function activateTab(pane: PaneId, key: string) {
  update(pane, (p) => (paneTabs(pane, p).includes(key) ? pushHistory({ ...p, active: key }) : p))
}

export function closeTab(pane: PaneId, key?: string) {
  update(pane, (p) => {
    const k = key ?? p.active
    // Only a hidden plugin's tab closes, back to the journal.
    if (pane === 'canvas') return k === p.active && !canvasTabs().includes(k) ? pushHistory({ ...p, active: PRIMARY.canvas }) : p
    if (k === PRIMARY[pane] || !p.tabs.includes(k)) return p
    const i = p.tabs.indexOf(k)
    const tabs = p.tabs.filter((t) => t !== k)
    return pushHistory({ ...p, tabs, active: p.active === k ? tabs[Math.max(0, i - 1)]! : p.active })
  })
}

export function closeAllTabs(pane: PaneId) {
  update(pane, (p) => pushHistory({ ...p, tabs: [PRIMARY[pane]], active: PRIMARY[pane] }))
}

export function cycleTab(pane: PaneId, dir: 1 | -1) {
  update(pane, (p) => {
    const tabs = paneTabs(pane, p)
    const i = tabs.indexOf(p.active)
    return pushHistory({ ...p, active: tabs[(i + dir + tabs.length) % tabs.length]! })
  })
}

export function goHistory(pane: PaneId, dir: 1 | -1) {
  update(pane, (p) => {
    const hIndex = p.hIndex + dir
    const key = p.history[hIndex]
    if (key == null) return p
    return { ...place(pane, p, key, false), hIndex }
  })
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

/** Date shown by the journal tab. */
export const activeJournalDate = (): string => journalDateOf(panesStore.get())

/** Store selector: the date shown by the journal tab. */
export function journalDateOf(s: PanesState): string {
  return s.day ?? today()
}

/** Store selector: whether the journal tab is the canvas's active tab. */
export const journalActiveOf = (s: PanesState) => s.panes.canvas.active === PRIMARY.canvas

/** After a tag rename/merge: points open tabs (and history) under `from` at the new path. */
export function renameTagTabs(from: string, to: string) {
  const map = (key: string) => {
    const loc = parseKey(key)
    return loc.kind === 'tag' && isUnder(loc.tag, from) ? tagKey(to + loc.tag.slice(from.length)) : key
  }
  update('tags', (p) => ({ ...p, tabs: [...new Set(p.tabs.map(map))], active: map(p.active), history: p.history.map(map) }))
}

/** After a tag delete: closes tabs showing it or its subtree. */
export function closeTagTabs(tag: string) {
  const gone = (key: string) => {
    const loc = parseKey(key)
    return loc.kind === 'tag' && isUnder(loc.tag, tag)
  }
  update('tags', (p) => {
    const tabs = p.tabs.filter((k) => !gone(k))
    const history = p.history.filter((k) => !gone(k))
    return {
      tabs,
      active: gone(p.active) ? PRIMARY.tags : p.active,
      history: history.length ? history : [PRIMARY.tags],
      hIndex: Math.min(p.hIndex, Math.max(0, history.length - 1)),
    }
  })
}
