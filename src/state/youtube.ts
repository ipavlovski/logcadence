import { openLoc, pluginKey } from './panes.ts'
import { createStore, persistedStore } from './store.ts'

// YouTube canvas tab: the open video (null = the listing) and the listing's filter and search.

/** A playlist id, a tag path (videos under it), videos without tags, or videos with notes. */
export type YtFilter = { kind: 'playlist'; id: string } | { kind: 'tag'; path: string } | { kind: 'untagged' } | { kind: 'notes' } | null

interface YtState {
  videoId: string | null
  filter: YtFilter
  query: string
}

export const YOUTUBE_PLUGIN = 'youtube'

const reviveFilter = (f: unknown): YtFilter => {
  const o = f as { kind?: string; id?: unknown; path?: unknown } | null
  if (o?.kind === 'playlist' && typeof o.id === 'string') return { kind: 'playlist', id: o.id }
  if (o?.kind === 'tag' && typeof o.path === 'string') return { kind: 'tag', path: o.path }
  if (o?.kind === 'untagged' || o?.kind === 'notes') return { kind: o.kind }
  return null
}

export const youtubeStore = persistedStore<YtState>('youtube.v1', { videoId: null, filter: null, query: '' }, (s) => {
  const o = (s ?? {}) as Partial<YtState>
  return { videoId: typeof o.videoId === 'string' ? o.videoId : null, filter: reviveFilter(o.filter), query: typeof o.query === 'string' ? o.query : '' }
})

export function openVideo(videoId: string | null) {
  youtubeStore.set((s) => ({ ...s, videoId }))
  openLoc('canvas', pluginKey(YOUTUBE_PLUGIN))
}

export function setYtFilter(filter: YtFilter) {
  youtubeStore.set((s) => ({ ...s, filter, videoId: null }))
}

export function setYtQuery(query: string) {
  youtubeStore.set((s) => ({ ...s, query }))
}

// The catalog's own change counter: its edits don't touch the journal, so they don't bump the journal's revision.
export const ytRevision = createStore(0)
export const bumpYt = () => ytRevision.set((n) => n + 1)
