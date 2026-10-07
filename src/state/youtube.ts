import { isIsoDate } from '../../shared/dates.ts'
import { openLoc, panesStore, pluginKey } from './panes.ts'
import { createStore, persistedStore } from './store.ts'

// YouTube canvas tab: the open video (null = the listing), the listing's filter and search, and its own history:
// video and logo clicks are steps that alt+left/right (and "← Videos") walk, each listing step with its scroll position.

/** A tag path (videos with it or a tag under it), videos without tags, or one channel's videos; null = all. */
export type YtFilter = { kind: 'tag'; path: string } | { kind: 'untagged' } | { kind: 'channel'; name: string } | null

/** Where the listing is scrolled: `offset` px into a day's section, or to a video's card; null = the top. */
export type YtAnchor = { date: string; offset: number } | { video: string } | null

/** A history step: a video page, or the listing at an anchor with its filter (undefined: the one in effect). */
export interface YtEntry {
  videoId: string | null
  anchor?: YtAnchor
  filter?: YtFilter
}

export interface YtState {
  videoId: string | null
  filter: YtFilter
  query: string
  history: YtEntry[]
  hIndex: number
  /** Bumped by every navigation, so the listing knows to scroll to its step's anchor (and not on anchor saves). */
  seq: number
}

export const YOUTUBE_PLUGIN = 'youtube'
const MAX_HISTORY = 50

const reviveFilter = (f: unknown): YtFilter => {
  const o = f as { kind?: string; path?: unknown; name?: unknown } | null
  if (o?.kind === 'tag' && typeof o.path === 'string') return { kind: 'tag', path: o.path }
  if (o?.kind === 'channel' && typeof o.name === 'string') return { kind: 'channel', name: o.name }
  if (o?.kind === 'untagged') return { kind: o.kind }
  return null
}

const reviveAnchor = (a: unknown): YtAnchor => {
  const o = a as { date?: unknown; offset?: unknown; video?: unknown } | null
  if (typeof o?.video === 'string') return { video: o.video }
  if (typeof o?.date === 'string' && isIsoDate(o.date)) return { date: o.date, offset: typeof o.offset === 'number' ? o.offset : 0 }
  return null
}

const reviveEntry = (e: unknown): YtEntry | null => {
  const o = e as { videoId?: unknown; anchor?: unknown; filter?: unknown } | null
  if (!o || typeof o !== 'object') return null
  if (typeof o.videoId === 'string') return { videoId: o.videoId }
  return { videoId: null, anchor: reviveAnchor(o.anchor), ...(o.filter !== undefined && { filter: reviveFilter(o.filter) }) }
}

export function reviveYt(s: unknown): YtState {
  const o = (s ?? {}) as Partial<YtState>
  const videoId = typeof o.videoId === 'string' ? o.videoId : null
  const history = (Array.isArray(o.history) ? o.history.map(reviveEntry).filter((e) => e != null) : []).slice(-MAX_HISTORY)
  const hIndex = typeof o.hIndex === 'number' ? Math.min(Math.max(0, o.hIndex), history.length - 1) : -1
  // The step shown must be the current one; a stale or missing history starts over from it.
  const ok = hIndex >= 0 && history[hIndex]!.videoId === videoId
  return {
    videoId,
    filter: reviveFilter(o.filter),
    query: typeof o.query === 'string' ? o.query : '',
    history: ok ? history : [{ videoId }],
    hIndex: ok ? hIndex : 0,
    seq: 0,
  }
}

export const youtubeStore = persistedStore<YtState>('youtube.v1', reviveYt(null), reviveYt)

// ── history (pure steps, tested) ───────────────────────────────────────────

/** Shows a step: its video, or the listing with the step's filter. */
const show = (s: YtState, entry: YtEntry, hIndex: number): YtState => ({
  ...s,
  hIndex,
  videoId: entry.videoId,
  filter: entry.videoId === null && entry.filter !== undefined ? entry.filter : s.filter,
  seq: s.seq + 1,
})

/** Adds a step after the current one (dropping the forward ones) and shows it; a listing step records its filter. */
export function pushStep(s: YtState, entry: YtEntry): YtState {
  const step = entry.videoId === null ? { ...entry, filter: entry.filter !== undefined ? entry.filter : s.filter } : entry
  const history = [...s.history.slice(0, s.hIndex + 1), step].slice(-MAX_HISTORY)
  return show({ ...s, history }, step, history.length - 1)
}

/** Moves back (-1) or forward (1); null at either end. */
export function stepHistory(s: YtState, dir: -1 | 1): YtState | null {
  const hIndex = s.hIndex + dir
  const entry = s.history[hIndex]
  return entry ? show(s, entry, hIndex) : null
}

/** A new filter on the listing step being shown (it starts from the top). */
export function withFilter(s: YtState, filter: YtFilter): YtState {
  const cur = s.history[s.hIndex]
  const history = [...s.history]
  if (cur?.videoId === null) history[s.hIndex] = { videoId: null, anchor: null, filter }
  return { ...s, history, filter, seq: s.seq + 1 }
}

/** Records where the listing step being shown is scrolled; other steps are left alone. */
export function withAnchor(s: YtState, anchor: YtAnchor): YtState {
  const cur = s.history[s.hIndex]
  if (!cur || cur.videoId !== null || JSON.stringify(cur.anchor ?? null) === JSON.stringify(anchor)) return s
  const history = [...s.history]
  history[s.hIndex] = { ...cur, anchor }
  return { ...s, history }
}

/** "← Videos" from a video: back, when the listing is the step before (it keeps its position); else the listing at this video. */
export function toListing(s: YtState): YtState {
  if (s.videoId === null) return s
  const before = s.history[s.hIndex - 1]
  if (before?.videoId === null) return stepHistory(s, -1)!
  return pushStep(s, { videoId: null, anchor: { video: s.videoId } })
}

// ── actions ────────────────────────────────────────────────────────────────

// The mounted listing reports where it is scrolled, so a step away from it can keep its position.
let captureAnchor: (() => YtAnchor | undefined) | null = null

export function registerAnchorCapture(fn: (() => YtAnchor | undefined) | null) {
  captureAnchor = fn
}

/** Saves the listing's current position into its history step. */
export function saveAnchor() {
  const anchor = captureAnchor?.()
  if (anchor !== undefined) youtubeStore.set((s) => withAnchor(s, anchor))
}

function navigate(fn: (s: YtState) => YtState) {
  saveAnchor()
  youtubeStore.set(fn)
}

export function openVideo(videoId: string) {
  navigate((s) => (s.videoId === videoId ? s : pushStep(s, { videoId })))
  openLoc('canvas', pluginKey(YOUTUBE_PLUGIN))
}

/** The YouTube logo: the whole listing (no tag or channel filter), at the top. */
export function goYtHome() {
  navigate((s) => pushStep(s, { videoId: null, anchor: null, filter: null }))
}

export function backToListing() {
  navigate(toListing)
}

/** The listing scrolled to a day (the nearest earlier one with videos, when that day has none). */
export function jumpToDate(date: string) {
  navigate((s) => pushStep(s, { videoId: null, anchor: { date, offset: 0 } }))
}

export const isYoutubeActive = () => panesStore.get().panes.canvas.active === pluginKey(YOUTUBE_PLUGIN)

/** The back/forward buttons, and alt+left/right while the tab is shown; nothing past either end. */
export function goYtHistory(dir: -1 | 1) {
  if (!stepHistory(youtubeStore.get(), dir)) return
  saveAnchor()
  youtubeStore.set((s) => stepHistory(s, dir) ?? s)
}

/** A filter starts the listing over from the top (a new step when a video was open). */
export function setYtFilter(filter: YtFilter) {
  if (youtubeStore.get().videoId !== null) navigate((s) => pushStep(s, { videoId: null, anchor: null, filter }))
  else youtubeStore.set((s) => withFilter(s, filter))
}

/** Searching from a video shows the listing (a new step, from the top). */
export function setYtQuery(query: string) {
  if (query && youtubeStore.get().videoId !== null) navigate((s) => pushStep(s, { videoId: null, anchor: null }))
  youtubeStore.set((s) => ({ ...s, query }))
}

/** The ctrl+j "jump to date" box. */
export const ytJumpOpen = createStore(false)
export function openYtJump() {
  if (!isYoutubeActive()) return
  saveAnchor() // the box starts at the day in view
  ytJumpOpen.set(() => true)
}

/** The day the tab shows: the video's, or the one the listing is scrolled to (its newest when at the top). */
export function ytDateInView(videos: { id: string; addedDate: string }[]): string | undefined {
  const s = youtubeStore.get()
  const anchor = s.history[s.hIndex]?.anchor
  if (s.videoId) return videos.find((v) => v.id === s.videoId)?.addedDate
  if (anchor && 'date' in anchor) return anchor.date
  if (anchor && 'video' in anchor) return videos.find((v) => v.id === anchor.video)?.addedDate
  return videos[0]?.addedDate
}

// The catalog's own change counter: its edits don't touch the journal, so they don't bump the journal's revision.
export const ytRevision = createStore(0)
export const bumpYt = () => ytRevision.set((n) => n + 1)
