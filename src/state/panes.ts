import { isIsoDate, today } from '../../shared/dates.ts'
import { isUnder, normalizeTag } from '../../shared/tags.ts'
import { persistedStore } from './store.ts'

// Three panes (canvas | journal | tags), each with tabs. A tab is identified by its location key;
// the first tab of each pane is its primary tab, which always exists and cannot be closed.

export type PaneId = 'canvas' | 'journal' | 'tags'
export const PANES: PaneId[] = ['canvas', 'journal', 'tags']

export type Loc =
  | { kind: 'dashboard' }
  | { kind: 'plugin'; type: string }
  | { kind: 'today' }
  | { kind: 'date'; date: string }
  | { kind: 'tree' }
  | { kind: 'tag'; tag: string }

export const PRIMARY: Record<PaneId, string> = { canvas: 'dashboard', journal: 'today', tags: 'tree' }

export function parseKey(key: string): Loc {
  const i = key.indexOf(':')
  const kind = i < 0 ? key : key.slice(0, i)
  const value = i < 0 ? '' : key.slice(i + 1)
  switch (kind) {
    case 'plugin':
      return { kind, type: value }
    case 'date':
      return { kind, date: value }
    case 'tag':
      return { kind, tag: value }
    case 'today':
    case 'tree':
      return { kind }
    default:
      return { kind: 'dashboard' }
  }
}

/** Today's date maps onto the pinned 'today' tab rather than a duplicate. */
export const dateKey = (date: string) => (date === today() ? 'today' : `date:${date}`)
export const tagKey = (tag: string) => `tag:${tag}`
export const pluginKey = (type: string) => `plugin:${type}`

interface PaneState {
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
  /** False while a side pane is minimized to its tab bar; the journal is always open. */
  open: Record<PaneId, boolean>
  /** Flex-grow weights of the visible panes. */
  weights: Record<PaneId, number>
}

const freshPane = (id: PaneId): PaneState => ({ tabs: [PRIMARY[id]], active: PRIMARY[id], history: [PRIMARY[id]], hIndex: 0 })

const initial: PanesState = {
  panes: { canvas: freshPane('canvas'), journal: freshPane('journal'), tags: freshPane('tags') },
  focus: 'journal',
  open: { canvas: true, journal: true, tags: true },
  weights: { canvas: 0.75, journal: 1.35, tags: 1 },
}

function validKey(pane: PaneId, key: string): boolean {
  const loc = parseKey(key)
  if (key !== PRIMARY[pane] && loc.kind === parseKey(PRIMARY[pane]).kind) return false
  switch (pane) {
    case 'canvas':
      return loc.kind === 'dashboard' || loc.kind === 'plugin'
    case 'journal':
      return loc.kind === 'today' || (loc.kind === 'date' && isIsoDate(loc.date))
    case 'tags':
      return loc.kind === 'tree' || (loc.kind === 'tag' && !!loc.tag)
  }
}

// Tabs saved under a plugin's former name.
const RENAMED: Record<string, string> = { 'plugin:threads': 'plugin:progress' }
const renamed = (k: unknown) => (typeof k === 'string' ? (RENAMED[k] ?? k) : k)

function revive(stored: unknown): PanesState {
  const s = stored as Partial<PanesState>
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
  const open = { ...initial.open, ...s.open, journal: true }
  return { panes, focus: s.focus && PANES.includes(s.focus) ? s.focus : 'journal', open, weights: { ...initial.weights, ...s.weights } }
}

export const panesStore = persistedStore<PanesState>('panes.v1', initial, revive)

function update(pane: PaneId, fn: (p: PaneState) => PaneState) {
  panesStore.set((s) => {
    const next = fn(s.panes[pane])
    return next === s.panes[pane] ? s : { ...s, panes: { ...s.panes, [pane]: next } }
  })
}

/** Shows `key`: activates its tab if open, otherwise opens it in place of the active tab (or a new one). */
function place(pane: PaneId, p: PaneState, key: string, newTab: boolean): PaneState {
  if (p.tabs.includes(key)) return p.active === key ? p : { ...p, active: key }
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

export function openDate(date: string, opts: { newTab?: boolean; focus?: boolean } = {}) {
  if (isIsoDate(date)) openLoc('journal', dateKey(date), opts)
}

export function activateTab(pane: PaneId, key: string) {
  update(pane, (p) => (p.tabs.includes(key) ? pushHistory({ ...p, active: key }) : p))
}

export function closeTab(pane: PaneId, key?: string) {
  update(pane, (p) => {
    const k = key ?? p.active
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
    const i = p.tabs.indexOf(p.active)
    return pushHistory({ ...p, active: p.tabs[(i + dir + p.tabs.length) % p.tabs.length]! })
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

/** Minimizes a side pane to its tab bar or restores it, optionally with new weights in the same update. */
export function setPaneOpen(pane: PaneId, isOpen: boolean, weights: Partial<Record<PaneId, number>> = {}) {
  if (pane === 'journal' && !isOpen) return
  panesStore.set((s) => ({
    ...s,
    open: { ...s.open, [pane]: isOpen },
    weights: { ...s.weights, ...weights },
    focus: !isOpen && s.focus === pane ? 'journal' : s.focus,
  }))
}

export function setWeights(weights: Partial<Record<PaneId, number>>) {
  panesStore.set((s) => ({ ...s, weights: { ...s.weights, ...weights } }))
}

/** Date shown by the journal pane's active tab. */
export const activeJournalDate = (): string => journalDateOf(panesStore.get())

/** Store selector: the date shown by the journal pane's active tab (today on the pinned Today tab). */
export function journalDateOf(s: PanesState): string {
  const loc = parseKey(s.panes.journal.active)
  return loc.kind === 'date' ? loc.date : today()
}

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
