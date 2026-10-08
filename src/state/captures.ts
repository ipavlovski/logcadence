import { isIsoDate } from '../../shared/dates.ts'
import type { CaptureKind } from '../../shared/types.ts'
import { openLoc, panesStore, pluginKey } from './panes.ts'
import { createStore, persistedStore, type Store } from './store.ts'

// The Reddit and Bookmarks canvas tabs (pages captured by the Chrome extension), each with its own state: the open
// capture (null = the listing), the listing's filter and search, and a history that alt+left/right walk, like the
// YouTube tab's (state/youtube.ts): capture clicks are steps, each listing step with its scroll position.

/** A tag path (captures with it or a tag under it), captures without tags, or one site's (a subreddit's) captures. */
export type CaptureFilter = { kind: 'tag'; path: string } | { kind: 'untagged' } | { kind: 'site'; site: string } | null

/** Where the listing is scrolled: `offset` px into a day's section, or to a capture's card; null = the top. */
export type CaptureAnchor = { date: string; offset: number } | { item: string } | null

export interface CaptureEntry {
  itemId: string | null
  anchor?: CaptureAnchor
  filter?: CaptureFilter
}

export interface CaptureState {
  itemId: string | null
  filter: CaptureFilter
  query: string
  history: CaptureEntry[]
  hIndex: number
  /** Bumped by every navigation, so the listing knows to scroll to its step's anchor. */
  seq: number
}

const MAX_HISTORY = 50

const reviveFilter = (f: unknown): CaptureFilter => {
  const o = f as { kind?: string; path?: unknown; site?: unknown } | null
  if (o?.kind === 'tag' && typeof o.path === 'string') return { kind: 'tag', path: o.path }
  if (o?.kind === 'site' && typeof o.site === 'string') return { kind: 'site', site: o.site }
  if (o?.kind === 'untagged') return { kind: o.kind }
  return null
}

const reviveAnchor = (a: unknown): CaptureAnchor => {
  const o = a as { date?: unknown; offset?: unknown; item?: unknown } | null
  if (typeof o?.item === 'string') return { item: o.item }
  if (typeof o?.date === 'string' && isIsoDate(o.date)) return { date: o.date, offset: typeof o.offset === 'number' ? o.offset : 0 }
  return null
}

const reviveEntry = (e: unknown): CaptureEntry | null => {
  const o = e as { itemId?: unknown; anchor?: unknown; filter?: unknown } | null
  if (!o || typeof o !== 'object') return null
  if (typeof o.itemId === 'string') return { itemId: o.itemId }
  return { itemId: null, anchor: reviveAnchor(o.anchor), ...(o.filter !== undefined && { filter: reviveFilter(o.filter) }) }
}

export function reviveCaptures(s: unknown): CaptureState {
  const o = (s ?? {}) as Partial<CaptureState>
  const itemId = typeof o.itemId === 'string' ? o.itemId : null
  const history = (Array.isArray(o.history) ? o.history.map(reviveEntry).filter((e) => e != null) : []).slice(-MAX_HISTORY)
  const hIndex = typeof o.hIndex === 'number' ? Math.min(Math.max(0, o.hIndex), history.length - 1) : -1
  const ok = hIndex >= 0 && history[hIndex]!.itemId === itemId
  return {
    itemId,
    filter: reviveFilter(o.filter),
    query: typeof o.query === 'string' ? o.query : '',
    history: ok ? history : [{ itemId }],
    hIndex: ok ? hIndex : 0,
    seq: 0,
  }
}

// ── history (pure steps, tested) ───────────────────────────────────────────

const show = (s: CaptureState, entry: CaptureEntry, hIndex: number): CaptureState => ({
  ...s,
  hIndex,
  itemId: entry.itemId,
  filter: entry.itemId === null && entry.filter !== undefined ? entry.filter : s.filter,
  seq: s.seq + 1,
})

/** Adds a step after the current one (dropping the forward ones) and shows it; a listing step records its filter. */
export function pushStep(s: CaptureState, entry: CaptureEntry): CaptureState {
  const step = entry.itemId === null ? { ...entry, filter: entry.filter !== undefined ? entry.filter : s.filter } : entry
  const history = [...s.history.slice(0, s.hIndex + 1), step].slice(-MAX_HISTORY)
  return show({ ...s, history }, step, history.length - 1)
}

/** Moves back (-1) or forward (1); null at either end. */
export function stepHistory(s: CaptureState, dir: -1 | 1): CaptureState | null {
  const hIndex = s.hIndex + dir
  const entry = s.history[hIndex]
  return entry ? show(s, entry, hIndex) : null
}

/** A new filter on the listing step being shown (it starts from the top). */
export function withFilter(s: CaptureState, filter: CaptureFilter): CaptureState {
  const history = [...s.history]
  if (s.history[s.hIndex]?.itemId === null) history[s.hIndex] = { itemId: null, anchor: null, filter }
  return { ...s, history, filter, seq: s.seq + 1 }
}

/** Records where the listing step being shown is scrolled. */
export function withAnchor(s: CaptureState, anchor: CaptureAnchor): CaptureState {
  const cur = s.history[s.hIndex]
  if (!cur || cur.itemId !== null || JSON.stringify(cur.anchor ?? null) === JSON.stringify(anchor)) return s
  const history = [...s.history]
  history[s.hIndex] = { ...cur, anchor }
  return { ...s, history }
}

/** Back to the listing from a capture: back, when the listing is the step before; else the listing at this capture. */
export function toListing(s: CaptureState): CaptureState {
  if (s.itemId === null) return s
  if (s.history[s.hIndex - 1]?.itemId === null) return stepHistory(s, -1)!
  return pushStep(s, { itemId: null, anchor: { item: s.itemId } })
}

// ── a tab's store and actions ──────────────────────────────────────────────

export interface CaptureNav {
  kind: CaptureKind
  plugin: string
  store: Store<CaptureState>
  /** The mounted listing reports where it is scrolled, so a step away can keep its position. */
  registerAnchorCapture(fn: (() => CaptureAnchor | undefined) | null): void
  saveAnchor(): void
  open(itemId: string): void
  home(): void
  backToListing(): void
  /** The listing scrolled to a day (the nearest earlier one with captures, when that day has none). */
  jumpToDate(date: string): void
  go(dir: -1 | 1): void
  setFilter(filter: CaptureFilter): void
  setQuery(query: string): void
  isActive(): boolean
  /** The tab's own change counter (its edits don't touch the journal). */
  revision: Store<number>
  bump(): void
}

function createNav(kind: CaptureKind, plugin: string): CaptureNav {
  const store = persistedStore<CaptureState>(`captures.${kind}.v1`, reviveCaptures(null), reviveCaptures)
  let capture: (() => CaptureAnchor | undefined) | null = null
  const saveAnchor = () => {
    const anchor = capture?.()
    if (anchor !== undefined) store.set((s) => withAnchor(s, anchor))
  }
  const navigate = (fn: (s: CaptureState) => CaptureState) => {
    saveAnchor()
    store.set(fn)
  }
  const revision = createStore(0)
  return {
    kind,
    plugin,
    store,
    registerAnchorCapture: (fn) => (capture = fn),
    saveAnchor,
    open(itemId) {
      navigate((s) => (s.itemId === itemId ? s : pushStep(s, { itemId })))
      openLoc('canvas', pluginKey(plugin))
    },
    home: () => navigate((s) => pushStep(s, { itemId: null, anchor: null, filter: null })),
    backToListing: () => navigate(toListing),
    jumpToDate: (date) => navigate((s) => pushStep(s, { itemId: null, anchor: { date, offset: 0 } })),
    go(dir) {
      if (!stepHistory(store.get(), dir)) return
      saveAnchor()
      store.set((s) => stepHistory(s, dir) ?? s)
    },
    setFilter(filter) {
      if (store.get().itemId !== null) navigate((s) => pushStep(s, { itemId: null, anchor: null, filter }))
      else store.set((s) => withFilter(s, filter))
    },
    setQuery(query) {
      if (query && store.get().itemId !== null) navigate((s) => pushStep(s, { itemId: null, anchor: null }))
      store.set((s) => ({ ...s, query }))
    },
    isActive: () => panesStore.get().panes.canvas.active === pluginKey(plugin),
    revision,
    bump: () => revision.set((n) => n + 1),
  }
}

export const redditNav = createNav('reddit', 'reddit')
export const bookmarksNav = createNav('bookmark', 'bookmarks')
